/**
 * Site24x7 HTTP client.
 *
 * Responsibilities:
 *   - Build the right URL from the tenant's zone.
 *   - Set `Authorization: Zoho-oauthtoken <access-token>` (refresh on 401).
 *   - Set `Accept: application/json; version=2.0` (or override per-call).
 *   - Inject `Cookie: zaaid=<id>` whenever a zaaid is in scope.
 *   - Refuse MSP/BU-only operations without a zaaid (MissingZaaidError).
 *   - Retry once on 429 with backoff.
 *   - Surface scope-aware 403s using the operation's requiredScopes.
 */

import { fetch as undiciFetch } from 'undici';
import type { ZohoOAuthClient } from '../auth/zoho-oauth.js';
import { resolveZoneEndpoints } from '../types/zones.js';
import { MissingZaaidError, type TenantContext } from '../types/tenant.js';
import type { Site24x7RequestParams, Site24x7Response } from './types.js';

export class Site24x7HttpError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  public readonly requiredScopes?: string[];
  public override readonly name = 'Site24x7HttpError';
  constructor(
    message: string,
    opts: { status: number; body?: unknown; requiredScopes?: string[] },
  ) {
    super(`[site24x7.HttpError] ${message}`);
    this.status = opts.status;
    if (opts.body !== undefined) this.body = opts.body;
    if (opts.requiredScopes !== undefined) this.requiredScopes = opts.requiredScopes;
  }
}

export interface Site24x7HttpClient {
  request<T = unknown>(
    ctx: TenantContext,
    params: Site24x7RequestParams,
  ): Promise<Site24x7Response<T>>;
}

export interface Site24x7HttpClientOptions {
  oauth: ZohoOAuthClient;
  fetch?: typeof undiciFetch;
  apiBaseUrlOverride?: (zone: TenantContext['zone']) => string;
  /** Retry budget for 429 (default 1). */
  rateLimitRetries?: number;
}

export function createSite24x7HttpClient(opts: Site24x7HttpClientOptions): Site24x7HttpClient {
  const fetchImpl = opts.fetch ?? undiciFetch;
  const rateLimitRetries = opts.rateLimitRetries ?? 1;

  function apiHost(zone: TenantContext['zone']): string {
    return opts.apiBaseUrlOverride
      ? opts.apiBaseUrlOverride(zone)
      : resolveZoneEndpoints(zone).apiBaseUrl;
  }

  function buildUrl(ctx: TenantContext, params: Site24x7RequestParams): string {
    let path = params.path;
    if (params.pathParams) {
      for (const [k, v] of Object.entries(params.pathParams)) {
        path = path.replaceAll(`:${k}`, encodeURIComponent(String(v)));
      }
    }
    const url = new URL(path.startsWith('/') ? path : `/${path}`, apiHost(ctx.zone));
    if (params.query) {
      for (const [k, v] of Object.entries(params.query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v)
            url.searchParams.append(k, typeof item === 'string' ? item : String(item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }

  function buildHeaders(
    ctx: TenantContext,
    params: Site24x7RequestParams,
    accessToken: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: `application/json; version=${params.version ?? '2.0'}`,
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    };
    const effectiveZaaid = params.zaaid ?? ctx.zaaid;
    if (effectiveZaaid !== undefined && effectiveZaaid.length > 0) {
      headers['Cookie'] = `zaaid=${effectiveZaaid}`;
    }
    if (params.body !== undefined) {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
    }
    return headers;
  }

  function enforceZaaid(ctx: TenantContext, params: Site24x7RequestParams): void {
    const effectiveZaaid = params.zaaid ?? ctx.zaaid;
    if (effectiveZaaid !== undefined && effectiveZaaid.length > 0) return;
    const op = params.operation;
    if (!op) return;
    if (op.mspOnly) throw new MissingZaaidError(op.operationId, ctx.accountType, 'msp');
    if (op.buOnly) throw new MissingZaaidError(op.operationId, ctx.accountType, 'bu');
  }

  async function attempt(
    ctx: TenantContext,
    params: Site24x7RequestParams,
    accessToken: string,
  ): Promise<Response429Or<Site24x7Response>> {
    const url = buildUrl(ctx, params);
    const headers = buildHeaders(ctx, params, accessToken);
    const res = await fetchImpl(url, {
      method: params.method,
      headers,
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await safeText(res);
    let parsed: unknown = text;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const responseHeaders = headersToRecord(res.headers);
    if (res.status === 429) {
      return {
        kind: 'rate-limited',
        status: 429,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) ?? 1_000,
        raw: parsed,
        headers: responseHeaders,
      };
    }
    return {
      kind: 'ok',
      value: {
        status: res.status,
        data: extractData(parsed),
        raw: parsed,
        headers: responseHeaders,
      },
    };
  }

  return {
    async request<T = unknown>(
      ctx: TenantContext,
      params: Site24x7RequestParams,
    ): Promise<Site24x7Response<T>> {
      enforceZaaid(ctx, params);

      let accessToken = await opts.oauth.getAccessToken(ctx);
      let attemptResult = await attempt(ctx, params, accessToken);

      // 429 → polite retry with backoff.
      let rateLimitAttempts = 0;
      while (attemptResult.kind === 'rate-limited' && rateLimitAttempts < rateLimitRetries) {
        await sleep(attemptResult.retryAfterMs);
        rateLimitAttempts += 1;
        attemptResult = await attempt(ctx, params, accessToken);
      }
      if (attemptResult.kind === 'rate-limited') {
        throw new Site24x7HttpError(
          `HTTP 429 (rate limited after ${String(rateLimitAttempts)} retries)`,
          { status: 429, body: attemptResult.raw },
        );
      }

      let resp = attemptResult.value;

      // One automatic 401 retry: presumably the cached access token expired
      // exactly between the cache check and the API call. Invalidate and
      // try once more with a fresh token before surfacing as an error.
      if (resp.status === 401) {
        opts.oauth.invalidate(ctx);
        accessToken = await opts.oauth.getAccessToken(ctx);
        const retry = await attempt(ctx, params, accessToken);
        if (retry.kind === 'rate-limited') {
          throw new Site24x7HttpError(`HTTP 429 on 401-retry (rate limited)`, {
            status: 429,
            body: retry.raw,
          });
        }
        resp = retry.value;
      }

      if (resp.status >= 400) {
        const detail = describeError(resp.raw);
        const scopes = params.operation?.requiredScopes ?? [];
        const scopeNote =
          resp.status === 403 && scopes.length > 0
            ? ` (operation requires scope(s) ${scopes.map((s) => `\`${s}\``).join(', ')} — confirm your refresh token grants them)`
            : '';
        throw new Site24x7HttpError(
          `HTTP ${String(resp.status)} ${params.method} ${params.path}${detail ? ` — ${detail}` : ''}${scopeNote}`,
          { status: resp.status, body: resp.raw, requiredScopes: scopes },
        );
      }

      return resp as Site24x7Response<T>;
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

type Response429Or<T> =
  | { kind: 'ok'; value: T }
  | {
      kind: 'rate-limited';
      status: 429;
      retryAfterMs: number;
      raw: unknown;
      headers: Record<string, string>;
    };

function headersToRecord(h: {
  forEach(cb: (value: string, key: string) => void): void;
}): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt * 1000;
  const asDate = new Date(header).getTime();
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) return delta;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function extractData(parsed: unknown): unknown {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed) {
    return parsed.data;
  }
  return parsed;
}

function describeError(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 200);
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o['error_code'] === 'string' || typeof o['error_code'] === 'number') {
      parts.push(`error_code=${String(o['error_code'])}`);
    }
    if (typeof o['message'] === 'string') parts.push(o['message']);
    if (typeof o['error_description'] === 'string') parts.push(o['error_description']);
    if (parts.length > 0) return parts.join(' | ').slice(0, 400);
  }
  try {
    return JSON.stringify(body).slice(0, 400);
  } catch {
    return '';
  }
}
