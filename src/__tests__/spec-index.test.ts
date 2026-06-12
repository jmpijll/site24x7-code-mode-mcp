import { describe, it, expect } from 'vitest';
import { buildOperationIndex, searchOperations } from '../spec/index-builder.js';
import type { BundledSpec } from '../types/spec.js';

const SPEC: BundledSpec = {
  sourceUrl: 'test://stub',
  generatedAt: '2026-06-12T00:00:00Z',
  scraperVersion: 'test',
  title: 'Test',
  operations: [
    {
      operationId: 'get_monitors',
      method: 'GET',
      path: '/api/monitors',
      summary: 'List monitors',
      tag: 'monitors',
      requiredScopes: ['Site24x7.Admin.Read'],
      mspOnly: false,
      buOnly: false,
      params: [],
      docUrl: 'https://example.com#mons',
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
      docUrl: 'https://example.com#msp',
    },
    {
      operationId: 'get_short_bu_business_units',
      method: 'GET',
      path: '/api/short/bu/business_units',
      summary: 'List Business Units',
      tag: 'business_units',
      requiredScopes: ['Site24x7.Bu.Read'],
      mspOnly: false,
      buOnly: true,
      params: [],
      docUrl: 'https://example.com#bu',
    },
  ],
};

describe('operation index + search', () => {
  it('groups by tag and indexes by id', () => {
    const idx = buildOperationIndex(SPEC);
    expect([...idx.operationsByTag.keys()].sort()).toEqual(['business_units', 'monitors', 'msp']);
    expect(idx.operationsById.get('get_monitors')?.path).toBe('/api/monitors');
  });

  it('searches by keyword', () => {
    const idx = buildOperationIndex(SPEC);
    const hits = searchOperations(idx, 'msp customers');
    expect(hits[0]?.operationId).toBe('get_short_msp_customers');
  });

  it('preserves mspOnly / buOnly flags through the index', () => {
    const idx = buildOperationIndex(SPEC);
    const mspOps = idx.operations.filter((o) => o.mspOnly);
    const buOps = idx.operations.filter((o) => o.buOnly);
    expect(mspOps).toHaveLength(1);
    expect(buOps).toHaveLength(1);
  });
});
