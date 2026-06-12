import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';
import { buildContextFromEnv, buildContextFromHeaders, tenantCacheKey } from '../tenant/context.js';
import { MissingCredentialsError } from '../types/tenant.js';

describe('tenant context', () => {
  it('builds from env in single-user mode', () => {
    const config = loadConfig({
      SITE24X7_CLIENT_ID: 'cid',
      SITE24X7_CLIENT_SECRET: 'sec',
      SITE24X7_REFRESH_TOKEN: 'rt',
      SITE24X7_ZONE: 'eu',
      SITE24X7_ACCOUNT_TYPE: 'msp',
      SITE24X7_ZAAID: 'z123',
    });
    const ctx = buildContextFromEnv(config);
    expect(ctx).toEqual({
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'rt',
      zone: 'eu',
      accountType: 'msp',
      zaaid: 'z123',
    });
  });

  it('throws MissingCredentialsError when env is empty', () => {
    const config = loadConfig({});
    expect(() => buildContextFromEnv(config)).toThrow(MissingCredentialsError);
  });

  it('builds from headers in multi-tenant mode', () => {
    const ctx = buildContextFromHeaders({
      'x-site24x7-client-id': 'cid',
      'x-site24x7-client-secret': 'sec',
      'x-site24x7-refresh-token': 'rt',
      'x-site24x7-zone': 'in',
      'x-site24x7-zaaid': 'cust42',
      'x-site24x7-account-type': 'bu',
    });
    expect(ctx.zone).toBe('in');
    expect(ctx.zaaid).toBe('cust42');
    expect(ctx.accountType).toBe('bu');
  });

  it('rejects unknown zones at the boundary', () => {
    expect(() =>
      buildContextFromHeaders({
        'x-site24x7-client-id': 'cid',
        'x-site24x7-client-secret': 'sec',
        'x-site24x7-refresh-token': 'rt',
        'x-site24x7-zone': 'mars',
      }),
    ).toThrow(MissingCredentialsError);
  });

  it('falls back to provided fallback when headers are absent', () => {
    const ctx = buildContextFromHeaders({}, {
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      zone: 'com',
      accountType: 'standard',
    });
    expect(ctx.zone).toBe('com');
    expect(ctx.zaaid).toBeUndefined();
  });

  it('cache key omits zaaid', () => {
    const base = {
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'rt',
      zone: 'com' as const,
      accountType: 'standard' as const,
    };
    expect(tenantCacheKey({ ...base, zaaid: 'a' })).toBe(tenantCacheKey({ ...base, zaaid: 'b' }));
    expect(tenantCacheKey({ ...base, zone: 'eu' })).not.toBe(tenantCacheKey(base));
  });
});
