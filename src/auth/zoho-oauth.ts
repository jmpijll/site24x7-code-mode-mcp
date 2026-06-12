/**
 * Zoho OAuth 2.0 — per-tenant refresh-token → access-token cache.
 *
 * Site24x7 uses Zoho's `accounts.<dc>` host to mint short-lived
 * (≈ 1 h) access tokens from a permanent refresh token. We cache the
 * access token in-memory keyed by `tenantCacheKey(ctx)` so the same
 * caller hitting the same identity reuses one token until it expires.
 *
 * Cache shape is intentionally per-process and in-memory — restarting
 * the server discards everything. The refresh token (the long-lived
 * secret) never goes to disk from this module.
 */

import { fetch as undiciFetch } from 'undici';
import { tenantCacheKey } from '../tenant/context.js';
import { resolveZoneEndpoints, type Site24x7Zone } from '../types/zones.js';
import type { TenantContext } from '../types/tenant.js';

const TOKEN_BUFFER_MS = 60_000;

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
  /** Cached promise of an in-flight refresh — coalesces concurrent callers. */
  refreshing?: Promise<CachedAccessToken>;
}

export class ZohoOAuthError extends Error {
  public readonly status?: number;
  public readonly body?: string;
  public override readonly name = 'ZohoOAuthError';
  constructor(message: string, opts: { status?: number; body?: string } = {}) {
    super(`[site24x7.ZohoOAuthError] ${message}`);
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.body !== undefined) this.body = opts.body;
  }
}

export interface ZohoOAuthClient {
  /**
   * Return a usable access token for `ctx`. May reuse a cached value or
   * fetch a new one. Concurrent calls for the same tenant share one
   * in-flight refresh.
   */
  getAccessToken(ctx: TenantContext): Promise<string>;
  /**
   * Discard the cached access token for `ctx` (call after a 401 on a
   * presumably-still-valid token).
   */
  invalidate(ctx: TenantContext): void;
  /** Drop everything (used in tests). */
  clearAll(): void;
}

export interface ZohoOAuthClientOptions {
  /**
   * Override for the fetch implementation (lets tests inject a mock).
   * Defaults to `undici.fetch`.
   */
  fetch?: typeof undiciFetch;
  /**
   * Override the accounts URL host. Useful for tests; production code
   * always derives the host from the tenant's zone.
   */
  accountsBaseUrlOverride?: (zone: Site24x7Zone) => string;
  /**
   * Optional callback so the server can log refreshes without coupling
   * this module to a logger.
   */
  onRefresh?: (info: { zone: Site24x7Zone; clientId: string; expiresIn: number }) => void;
}

export function createZohoOAuthClient(opts: ZohoOAuthClientOptions = {}): ZohoOAuthClient {
  const fetchImpl = opts.fetch ?? undiciFetch;
  const cache = new Map<string, CachedAccessToken>();

  const accountsHost = (zone: Site24x7Zone): string =>
    opts.accountsBaseUrlOverride
      ? opts.accountsBaseUrlOverride(zone)
      : resolveZoneEndpoints(zone).accountsBaseUrl;

  async function refresh(ctx: TenantContext): Promise<CachedAccessToken> {
    const url = new URL('/oauth/v2/token', accountsHost(ctx.zone));
    url.searchParams.set('client_id', ctx.clientId);
    url.searchParams.set('client_secret', ctx.clientSecret);
    url.searchParams.set('refresh_token', ctx.refreshToken);
    url.searchParams.set('grant_type', 'refresh_token');

    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const bodyText = await safeText(res);
    if (!res.ok) {
      throw new ZohoOAuthError(
        `refresh token exchange failed: HTTP ${String(res.status)} ${res.statusText} — ${bodyText.slice(0, 256)}`,
        { status: res.status, body: bodyText },
      );
    }
    let parsed: { access_token?: unknown; expires_in?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(bodyText) as typeof parsed;
    } catch {
      throw new ZohoOAuthError(`refresh token exchange returned non-JSON body: ${bodyText.slice(0, 256)}`, {
        status: res.status,
        body: bodyText,
      });
    }
    if (typeof parsed.error === 'string') {
      throw new ZohoOAuthError(`refresh token exchange returned error: ${parsed.error}`, {
        status: res.status,
        body: bodyText,
      });
    }
    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      throw new ZohoOAuthError(
        `refresh token exchange returned no access_token: ${bodyText.slice(0, 256)}`,
        { status: res.status, body: bodyText },
      );
    }
    const expiresIn = typeof parsed.expires_in === 'number' && parsed.expires_in > 0 ? parsed.expires_in : 3600;
    const cached: CachedAccessToken = {
      accessToken: parsed.access_token,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_BUFFER_MS,
    };
    opts.onRefresh?.({ zone: ctx.zone, clientId: ctx.clientId, expiresIn });
    return cached;
  }

  return {
    async getAccessToken(ctx: TenantContext): Promise<string> {
      const key = tenantCacheKey(ctx);
      const existing = cache.get(key);
      const now = Date.now();
      if (existing && existing.expiresAt > now && !existing.refreshing) {
        return existing.accessToken;
      }
      if (existing?.refreshing) {
        const refreshed = await existing.refreshing;
        return refreshed.accessToken;
      }
      const refreshing = refresh(ctx)
        .then((fresh) => {
          cache.set(key, fresh);
          return fresh;
        })
        .catch((err: unknown) => {
          cache.delete(key);
          throw err;
        });
      cache.set(key, { accessToken: existing?.accessToken ?? '', expiresAt: now, refreshing });
      const fresh = await refreshing;
      return fresh.accessToken;
    },
    invalidate(ctx: TenantContext): void {
      cache.delete(tenantCacheKey(ctx));
    },
    clearAll(): void {
      cache.clear();
    },
  };
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
