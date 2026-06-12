import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBundledSpec, clearSpecCache, specSummary } from '../spec/loader.js';
import type { BundledSpec } from '../types/spec.js';

const MINIMAL_SPEC: BundledSpec = {
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
      docUrl: 'https://example.com#list-monitors',
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
      docUrl: 'https://example.com#msp-customers',
    },
  ],
};

describe('spec loader', () => {
  it('loads, indexes, and summarises a minimal bundled spec', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'site24x7-spec-'));
    const path = join(dir, 'bundle.json');
    await writeFile(path, JSON.stringify(MINIMAL_SPEC), 'utf-8');
    try {
      clearSpecCache();
      const processed = await loadBundledSpec({ bundledPath: path });
      expect(processed.operations).toHaveLength(2);
      expect(processed.operationsById.has('get_monitors')).toBe(true);
      expect(processed.operationsByTag.get('msp')).toHaveLength(1);
      const sum = specSummary(processed);
      expect(sum.operations).toBe(2);
      expect(sum.mspOnly).toBe(1);
      expect(sum.buOnly).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when the file is missing the operations array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'site24x7-spec-'));
    const path = join(dir, 'bad.json');
    await writeFile(path, JSON.stringify({ title: 'x' }), 'utf-8');
    try {
      await expect(loadBundledSpec({ bundledPath: path })).rejects.toThrow(/operations array/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
