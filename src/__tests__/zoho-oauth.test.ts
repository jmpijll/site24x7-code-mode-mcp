import { describe, it, expect, vi } from 'vitest';
import { createZohoOAuthClient, ZohoOAuthError } from '../auth/zoho-oauth.js';
import type { TenantContext } from '../types/tenant.js';

function tenant(over: Partial<TenantContext> = {}): TenantContext {
  return {
    clientId: 'cid',
    clientSecret: 'sec',
    refreshToken: 'rt',
    zone: 'com',
    accountType: 'standard',
    ...over,
  };
}

function makeFetch(response: { status?: number; body?: unknown; text?: string }): typeof fetch {
  return vi.fn(async () => {
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      text: async (): Promise<string> => {
        if (response.text !== undefined) return response.text;
        return JSON.stringify(response.body ?? {});
      },
    };
  }) as unknown as typeof fetch;
}

describe('Zoho OAuth refresh-token client', () => {
  it('caches access tokens per tenant cache key', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async (): Promise<string> =>
        JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }),
    }));
    const oauth = createZohoOAuthClient({ fetch: fetchSpy as unknown as typeof fetch });
    const t = tenant();
    const a = await oauth.getAccessToken(t);
    const b = await oauth.getAccessToken(t);
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('refreshes again after invalidation', async () => {
    let n = 0;
    const oauth = createZohoOAuthClient({
      fetch: (async () => {
        n += 1;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async (): Promise<string> =>
            JSON.stringify({ access_token: `tok-${String(n)}`, expires_in: 3600 }),
        };
      }) as unknown as typeof fetch,
    });
    const t = tenant();
    expect(await oauth.getAccessToken(t)).toBe('tok-1');
    oauth.invalidate(t);
    expect(await oauth.getAccessToken(t)).toBe('tok-2');
  });

  it('routes to the right accounts host per zone', async () => {
    const seen: string[] = [];
    const fetchSpy = (async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async (): Promise<string> => JSON.stringify({ access_token: 'tok', expires_in: 60 }),
      };
    }) as unknown as typeof fetch;
    const oauth = createZohoOAuthClient({ fetch: fetchSpy });
    await oauth.getAccessToken(tenant({ zone: 'eu', refreshToken: 'rt-eu' }));
    await oauth.getAccessToken(tenant({ zone: 'in', refreshToken: 'rt-in' }));
    expect(seen.some((u) => u.startsWith('https://accounts.zoho.eu'))).toBe(true);
    expect(seen.some((u) => u.startsWith('https://accounts.zoho.in'))).toBe(true);
  });

  it('surfaces a structured error on non-200 refresh', async () => {
    const oauth = createZohoOAuthClient({
      fetch: makeFetch({ status: 400, text: '{"error":"invalid_grant"}' }),
    });
    await expect(oauth.getAccessToken(tenant())).rejects.toBeInstanceOf(ZohoOAuthError);
  });

  it('surfaces a structured error when the body has no access_token', async () => {
    const oauth = createZohoOAuthClient({
      fetch: makeFetch({ status: 200, body: { error: 'invalid_client' } }),
    });
    await expect(oauth.getAccessToken(tenant())).rejects.toBeInstanceOf(ZohoOAuthError);
  });
});
