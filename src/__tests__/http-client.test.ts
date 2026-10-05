import { describe, it, expect, vi } from 'vitest';
import { createSite24x7HttpClient, Site24x7HttpError } from '../client/http.js';
import type { ZohoOAuthClient } from '../auth/zoho-oauth.js';
import type { TenantContext } from '../types/tenant.js';
import { MissingZaaidError } from '../types/tenant.js';
import type { IndexedOperation } from '../types/spec.js';

const tenant = (over: Partial<TenantContext> = {}): TenantContext => ({
  clientId: 'cid',
  clientSecret: 'sec',
  refreshToken: 'rt',
  zone: 'com',
  accountType: 'standard',
  ...over,
});

function fakeOauth(token = 'tok'): ZohoOAuthClient {
  return {
    getAccessToken: vi.fn(async () => token),
    invalidate: vi.fn(),
    clearAll: vi.fn(),
  };
}

function fakeFetchOk(headers: Record<string, string> = {}): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async (): Promise<string> =>
      JSON.stringify({ code: 0, message: 'ok', data: { ok: true } }),
    headers: {
      forEach(cb: (v: string, k: string) => void): void {
        for (const [k, v] of Object.entries(headers)) cb(v, k);
      },
      get(): null {
        return null;
      },
    },
  })) as unknown as typeof fetch;
}

describe('HTTP client', () => {
  it('uses Zoho-oauthtoken auth and version=2.0 Accept by default', async () => {
    const captured: { url: string; init: RequestInit } = { url: '', init: {} };
    const spyFetch = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async (): Promise<string> => JSON.stringify({ data: 'x' }),
        headers: {
          forEach() {},
          get(): null {
            return null;
          },
        },
      };
    }) as unknown as typeof fetch;
    const client = createSite24x7HttpClient({ oauth: fakeOauth('TOK'), fetch: spyFetch });
    await client.request(tenant(), { method: 'GET', path: '/api/current_status' });
    const headers = (captured.init.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Zoho-oauthtoken TOK');
    expect(headers['Accept']).toBe('application/json; version=2.0');
    expect(headers['Cookie']).toBeUndefined();
    expect(captured.url).toContain('https://www.site24x7.com/api/current_status');
  });

  it('injects Cookie: zaaid when ambient zaaid is set', async () => {
    const captured: { init: RequestInit } = { init: {} };
    const spyFetch = (async (_url: string, init: RequestInit) => {
      captured.init = init;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async (): Promise<string> => '{}',
        headers: {
          forEach() {},
          get(): null {
            return null;
          },
        },
      };
    }) as unknown as typeof fetch;
    const client = createSite24x7HttpClient({ oauth: fakeOauth(), fetch: spyFetch });
    await client.request(tenant({ zaaid: 'cust-1' }), {
      method: 'GET',
      path: '/api/current_status',
    });
    const headers = (captured.init.headers ?? {}) as Record<string, string>;
    expect(headers['Cookie']).toBe('zaaid=cust-1');
  });

  it('per-call zaaid overrides ambient zaaid', async () => {
    const captured: { init: RequestInit } = { init: {} };
    const spyFetch = (async (_url: string, init: RequestInit) => {
      captured.init = init;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async (): Promise<string> => '{}',
        headers: {
          forEach() {},
          get(): null {
            return null;
          },
        },
      };
    }) as unknown as typeof fetch;
    const client = createSite24x7HttpClient({ oauth: fakeOauth(), fetch: spyFetch });
    await client.request(tenant({ zaaid: 'amb' }), {
      method: 'GET',
      path: '/api/x',
      zaaid: 'override',
    });
    const headers = (captured.init.headers ?? {}) as Record<string, string>;
    expect(headers['Cookie']).toBe('zaaid=override');
  });

  it('throws MissingZaaidError when an mspOnly op is called without zaaid', async () => {
    const op: IndexedOperation = {
      operationId: 'get_short_msp_customers',
      method: 'GET',
      path: '/api/short/msp/customers',
      summary: 's',
      tag: 'msp',
      requiredScopes: [],
      mspOnly: true,
      buOnly: false,
      params: [],
      docUrl: '',
      haystack: '',
    };
    const client = createSite24x7HttpClient({ oauth: fakeOauth(), fetch: fakeFetchOk() });
    await expect(
      client.request(tenant({ accountType: 'msp' }), {
        method: 'GET',
        path: op.path,
        operation: op,
      }),
    ).rejects.toBeInstanceOf(MissingZaaidError);
  });

  it('retries once on 401 with a refreshed token', async () => {
    let calls = 0;
    const oauth = {
      getAccessToken: vi.fn(async () => `tok-${String(++calls)}`),
      invalidate: vi.fn(),
      clearAll: vi.fn(),
    };
    let attempt = 0;
    const spyFetch = (async () => {
      attempt += 1;
      const ok = attempt > 1;
      return {
        ok,
        status: ok ? 200 : 401,
        statusText: ok ? 'OK' : 'Unauthorized',
        text: async (): Promise<string> => (ok ? '{"data":1}' : '{"error":"unauthorized"}'),
        headers: {
          forEach() {},
          get(): null {
            return null;
          },
        },
      };
    }) as unknown as typeof fetch;
    const client = createSite24x7HttpClient({ oauth, fetch: spyFetch });
    const res = await client.request(tenant(), { method: 'GET', path: '/api/x' });
    expect(res.status).toBe(200);
    expect(oauth.invalidate).toHaveBeenCalled();
  });

  it('formats scope-aware 403 messages', async () => {
    const op: IndexedOperation = {
      operationId: 'put_users_user_id',
      method: 'PUT',
      path: '/api/users/:user_id',
      summary: 's',
      tag: 'users',
      requiredScopes: ['Site24x7.Admin.Update'],
      mspOnly: false,
      buOnly: false,
      params: [],
      docUrl: '',
      haystack: '',
    };
    const spyFetch = (async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async (): Promise<string> => '{"error":"forbidden","message":"insufficient scope"}',
      headers: {
        forEach() {},
        get(): null {
          return null;
        },
      },
    })) as unknown as typeof fetch;
    const client = createSite24x7HttpClient({ oauth: fakeOauth(), fetch: spyFetch });
    await expect(
      client.request(tenant(), {
        method: 'PUT',
        path: op.path,
        operation: op,
        pathParams: { user_id: '1' },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Site24x7.Admin.Update'),
    });
  });

  it('substitutes path params and serialises queries', async () => {
    const captured: { url: string } = { url: '' };
    const spyFetch = (async (url: string) => {
      captured.url = url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async (): Promise<string> => '{}',
        headers: {
          forEach() {},
          get(): null {
            return null;
          },
        },
      };
    }) as unknown as typeof fetch;
    const client = createSite24x7HttpClient({ oauth: fakeOauth(), fetch: spyFetch });
    await client.request(tenant(), {
      method: 'GET',
      path: '/api/monitors/:id',
      pathParams: { id: 'abc' },
      query: { limit: 5, tags: ['a', 'b'] },
    });
    expect(captured.url).toContain('/api/monitors/abc');
    expect(captured.url).toContain('limit=5');
    expect(captured.url).toContain('tags=a');
    expect(captured.url).toContain('tags=b');
  });
});
