/**
 * Tenant resolution.
 *
 * Two builders:
 *   - `buildContextFromEnv(config)`      single-user (stdio)
 *   - `buildContextFromHeaders(headers)` multi-tenant HTTP request
 *
 * Both produce a `TenantContext` or throw `MissingCredentialsError`. The
 * zone is validated against `KNOWN_SITE24X7_ZONES` so a typo at the
 * boundary surfaces immediately instead of as an opaque 401.
 */

import type { AppConfig } from '../config.js';
import { isSite24x7Zone } from '../types/zones.js';
import { MissingCredentialsError, type AccountType, type TenantContext } from '../types/tenant.js';

function validateRequired(partial: Partial<TenantContext>): TenantContext {
  const missing: string[] = [];
  if (!partial.clientId) missing.push('clientId');
  if (!partial.clientSecret) missing.push('clientSecret');
  if (!partial.refreshToken) missing.push('refreshToken');
  if (!partial.zone) missing.push('zone');
  if (missing.length > 0) throw new MissingCredentialsError(missing);
  // After the missing check above, the four fields are guaranteed truthy.
  const ctx: TenantContext = {
    clientId: partial.clientId as string,
    clientSecret: partial.clientSecret as string,
    refreshToken: partial.refreshToken as string,
    zone: partial.zone as TenantContext['zone'],
    accountType: partial.accountType ?? 'standard',
  };
  if (partial.zaaid) ctx.zaaid = partial.zaaid;
  return ctx;
}

export function buildContextFromEnv(config: AppConfig): TenantContext {
  return validateRequired({
    clientId: config.envClientId,
    clientSecret: config.envClientSecret,
    refreshToken: config.envRefreshToken,
    zone: config.envZone,
    accountType: config.envAccountType,
    ...(config.envZaaid ? { zaaid: config.envZaaid } : {}),
  });
}

const HEADER_NAMES = {
  clientId: 'x-site24x7-client-id',
  clientSecret: 'x-site24x7-client-secret',
  refreshToken: 'x-site24x7-refresh-token',
  zone: 'x-site24x7-zone',
  zaaid: 'x-site24x7-zaaid',
  accountType: 'x-site24x7-account-type',
} as const;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

export function buildContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallback?: Partial<TenantContext>,
): TenantContext {
  const zoneRaw = header(headers, HEADER_NAMES.zone) ?? fallback?.zone;
  if (zoneRaw !== undefined && typeof zoneRaw === 'string' && !isSite24x7Zone(zoneRaw)) {
    throw new MissingCredentialsError([`zone (unknown value "${zoneRaw}")`]);
  }
  const zone = zoneRaw;

  const accountTypeRaw = header(headers, HEADER_NAMES.accountType) ?? fallback?.accountType;
  let accountType: AccountType = 'standard';
  if (accountTypeRaw === 'msp' || accountTypeRaw === 'bu' || accountTypeRaw === 'standard') {
    accountType = accountTypeRaw;
  }

  return validateRequired({
    clientId: header(headers, HEADER_NAMES.clientId) ?? fallback?.clientId,
    clientSecret: header(headers, HEADER_NAMES.clientSecret) ?? fallback?.clientSecret,
    refreshToken: header(headers, HEADER_NAMES.refreshToken) ?? fallback?.refreshToken,
    zone,
    accountType,
    ...((header(headers, HEADER_NAMES.zaaid) ?? fallback?.zaaid)
      ? { zaaid: header(headers, HEADER_NAMES.zaaid) ?? fallback?.zaaid }
      : {}),
  });
}

/**
 * Stable cache key for the per-tenant access-token cache.
 *
 * Includes refresh token, client id, and zone. `zaaid` is intentionally
 * NOT included — the access token is issued against the OAuth identity,
 * not the customer, and is reusable across customers.
 */
export function tenantCacheKey(ctx: TenantContext): string {
  return `${ctx.zone}|${ctx.clientId}|${ctx.refreshToken}`;
}
