/**
 * End-to-end integration test: HTTP client + OAuth refresh against the
 * in-process mock upstream, including a `withCustomer` round-trip.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { startMockUpstream, type MockServerHandle } from './mock-server.js';
import { createZohoOAuthClient } from '../../auth/zoho-oauth.js';
import { createSite24x7HttpClient } from '../../client/http.js';
import { ExecuteExecutor } from '../../sandbox/execute-executor.js';
import { buildOperationIndex } from '../../spec/index-builder.js';
import type { TenantContext } from '../../types/tenant.js';
import type { BundledSpec } from '../../types/spec.js';

const RAW_SPEC: BundledSpec = {
  sourceUrl: 'test',
  generatedAt: '2026-06-12T00:00:00Z',
  scraperVersion: 't',
  title: 'Site24x7 REST API',
  operations: [
    {
      operationId: 'get_current_status',
      method: 'GET',
      path: '/api/current_status',
      summary: 'Current status',
      tag: 'current_status',
      requiredScopes: ['Site24x7.Reports.Read'],
      mspOnly: false,
      buOnly: false,
      params: [],
      docUrl: '',
    },
  ],
};

let mock: MockServerHandle;

beforeAll(async () => {
  mock = await startMockUpstream();
});

afterAll(async () => {
  await mock.close();
});

describe('integration: http roundtrip', () => {
  it('refreshes a token and reaches the API host derived from the zone', async () => {
    const oauth = createZohoOAuthClient({ accountsBaseUrlOverride: () => mock.url });
    const client = createSite24x7HttpClient({ oauth, apiBaseUrlOverride: () => mock.url });
    const tenant: TenantContext = {
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'rt',
      zone: 'com',
      accountType: 'msp',
    };
    const res = await client.request(tenant, { method: 'GET', path: '/api/current_status' });
    expect(res.status).toBe(200);
    expect(mock.lastHeaders['authorization']).toBe('Zoho-oauthtoken mock-token');
    expect(mock.lastHeaders['accept']).toBe('application/json; version=2.0');
  });

  it('runs the full sandbox path with site24x7.listCustomers + withCustomer', async () => {
    const oauth = createZohoOAuthClient({ accountsBaseUrlOverride: () => mock.url });
    const client = createSite24x7HttpClient({ oauth, apiBaseUrlOverride: () => mock.url });
    const tenant: TenantContext = {
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'rt',
      zone: 'com',
      accountType: 'msp',
    };
    const spec = buildOperationIndex(RAW_SPEC);
    const ex = new ExecuteExecutor({ tenant, spec, client });
    const res = await ex.execute(`
      var customers = site24x7.listCustomers();
      var out = [];
      for (var i = 0; i < customers.length; i++) {
        var c = customers[i];
        var s = site24x7.withCustomer(c.zaaid, function(api) {
          return api.request({ method: 'GET', path: '/api/current_status' });
        });
        out.push({ name: c.name, zaaid: c.zaaid, echo: s.zaaid_echo });
      }
      out;
    `);
    expect(res.ok).toBe(true);
    const data = res.data as Array<{ name: string; zaaid: string; echo: string }>;
    expect(data.map((d) => d.zaaid)).toEqual(['111', '222']);
    expect(data[1]?.echo).toContain('zaaid=222');
  });
});
