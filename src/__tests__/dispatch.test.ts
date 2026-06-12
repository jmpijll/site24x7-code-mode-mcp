import { describe, it, expect } from 'vitest';
import { buildOperationIndex } from '../spec/index-builder.js';
import { buildSite24x7Prelude, sanitizeIdentifier } from '../sandbox/dispatch.js';
import type { BundledSpec } from '../types/spec.js';

const SPEC: BundledSpec = {
  sourceUrl: 't',
  generatedAt: '2026-06-12T00:00:00Z',
  scraperVersion: 't',
  title: 'T',
  operations: [
    {
      operationId: 'get_monitors',
      method: 'GET',
      path: '/api/monitors',
      summary: 's',
      tag: 'monitors',
      requiredScopes: [],
      mspOnly: false,
      buOnly: false,
      params: [],
      docUrl: '',
    },
    {
      operationId: 'post_monitors',
      method: 'POST',
      path: '/api/monitors',
      summary: 's',
      tag: 'monitors',
      requiredScopes: [],
      mspOnly: false,
      buOnly: false,
      params: [],
      docUrl: '',
    },
    {
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
    },
  ],
};

describe('prelude builder', () => {
  it('emits typed accessors per tag', () => {
    const idx = buildOperationIndex(SPEC);
    const prelude = buildSite24x7Prelude(idx, undefined);
    expect(prelude).toContain('ns.monitors = {};');
    expect(prelude).toContain('ns.monitors.get_monitors =');
    expect(prelude).toContain('ns.monitors.post_monitors =');
    expect(prelude).toContain('ns.msp = {};');
    expect(prelude).toContain('ns.msp.get_short_msp_customers =');
  });

  it('includes the withCustomer / listCustomers / zaaid helpers', () => {
    const idx = buildOperationIndex(SPEC);
    const prelude = buildSite24x7Prelude(idx, 'init-zaaid');
    expect(prelude).toContain('listCustomers');
    expect(prelude).toContain('withCustomer');
    expect(prelude).toContain('"init-zaaid"');
    expect(prelude).toContain('Object.defineProperty(ns, "zaaid"');
  });
});

describe('sanitizeIdentifier', () => {
  it('replaces invalid chars and quotes reserved words', () => {
    expect(sanitizeIdentifier('my-op')).toBe('my_op');
    expect(sanitizeIdentifier('1foo')).toBe('_1foo');
    expect(sanitizeIdentifier('class')).toBe('class_');
  });
});
