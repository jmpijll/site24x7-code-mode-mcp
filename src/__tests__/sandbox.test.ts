import { describe, it, expect, vi } from 'vitest';
import { SearchExecutor } from '../sandbox/search-executor.js';
import { ExecuteExecutor } from '../sandbox/execute-executor.js';
import { buildOperationIndex } from '../spec/index-builder.js';
import type { Site24x7HttpClient } from '../client/http.js';
import type { BundledSpec } from '../types/spec.js';
import type { TenantContext } from '../types/tenant.js';

const SPEC_RAW: BundledSpec = {
  sourceUrl: 'test',
  generatedAt: '2026-06-12T00:00:00Z',
  scraperVersion: 'test',
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
    {
      operationId: 'get_short_msp_customers',
      method: 'GET',
      path: '/api/short/msp/customers',
      summary: 'List MSP customers',
      tag: 'msp',
      requiredScopes: ['Site24x7.Msp.Read'],
      mspOnly: true,
      buOnly: false,
      params: [],
      docUrl: '',
    },
  ],
};

const SPEC = buildOperationIndex(SPEC_RAW);

const tenant: TenantContext = {
  clientId: 'cid',
  clientSecret: 'sec',
  refreshToken: 'rt',
  zone: 'com',
  accountType: 'msp',
};

function fakeClient(handler: (path: string, zaaid?: string) => unknown): Site24x7HttpClient {
  return {
    request: vi.fn(async (_ctx: TenantContext, params: { path: string; zaaid?: string }) => {
      const data = handler(params.path, params.zaaid);
      return { status: 200, data, raw: { data }, headers: {} };
    }),
  };
}

describe('search executor', () => {
  it('returns spec metadata and supports searchOperations', async () => {
    const ex = new SearchExecutor({ spec: SPEC });
    const res = await ex.execute('searchOperations("msp")');
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('exposes findOperationsByTag', async () => {
    const ex = new SearchExecutor({ spec: SPEC });
    const res = await ex.execute('findOperationsByTag("current_status").length');
    expect(res.ok).toBe(true);
    expect(res.data).toBe(1);
  });
});

describe('execute executor', () => {
  it('dispatches typed calls', async () => {
    const client = fakeClient((path) => ({ path }));
    const ex = new ExecuteExecutor({ tenant, spec: SPEC, client });
    const res = await ex.execute(`site24x7.current_status.get_current_status();`);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ path: '/api/current_status' });
  });

  it('honours withCustomer by overriding zaaid', async () => {
    const seen: Array<string | undefined> = [];
    const client = fakeClient((_path, zaaid) => {
      seen.push(zaaid);
      return null;
    });
    const ex = new ExecuteExecutor({ tenant: { ...tenant, zaaid: 'baseline' }, spec: SPEC, client });
    const res = await ex.execute(`
      site24x7.current_status.get_current_status();
      site24x7.withCustomer('temp', function(s) {
        s.current_status.get_current_status();
      });
      site24x7.current_status.get_current_status();
      site24x7.zaaid;
    `);
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['baseline', 'temp', 'baseline']);
    expect(res.data).toBe('baseline');
  });

  it('listCustomers chooses the right path for MSP', async () => {
    const seen: string[] = [];
    const client = fakeClient((path) => {
      seen.push(path);
      return [{ name: 'A', zaaid: 'a' }];
    });
    const ex = new ExecuteExecutor({ tenant, spec: SPEC, client });
    const res = await ex.execute(`site24x7.listCustomers();`);
    expect(res.ok).toBe(true);
    expect(seen).toContain('/api/short/msp/customers');
  });

  it('listCustomers chooses the BU path for BU accounts', async () => {
    const seen: string[] = [];
    const client = fakeClient((path) => {
      seen.push(path);
      return [];
    });
    const ex = new ExecuteExecutor({
      tenant: { ...tenant, accountType: 'bu' },
      spec: SPEC,
      client,
    });
    await ex.execute(`site24x7.listCustomers();`);
    expect(seen).toContain('/api/short/bu/business_units');
  });

  it('surfaces UnknownOperationError when dispatching a non-existent op', async () => {
    const ex = new ExecuteExecutor({ tenant, spec: SPEC, client: fakeClient(() => null) });
    const res = await ex.execute(`site24x7.callOperation('does_not_exist', {});`);
    expect(res.ok).toBe(false);
    expect(res.error ?? '').toContain('UnknownOperationError');
  });

  it('enforces the per-execute call budget', async () => {
    const client = fakeClient(() => null);
    const ex = new ExecuteExecutor({
      tenant,
      spec: SPEC,
      client,
      limits: { maxCallsPerExecute: 2 },
    });
    const res = await ex.execute(`
      for (var i = 0; i < 5; i++) {
        site24x7.current_status.get_current_status();
      }
      'done';
    `);
    expect(res.ok).toBe(false);
    expect(res.error ?? '').toMatch(/call limit|API call/);
  });
});
