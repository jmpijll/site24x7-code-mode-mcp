/**
 * Spec loader. Loads the bundled JSON spec, runs it through the index
 * builder, and caches the processed shape per-process.
 *
 * Site24x7 publishes no live OpenAPI document, so this loader never hits
 * the network. To refresh the bundled spec, run `npm run update-spec`.
 *
 * `CACHE_SCHEMA_VERSION` bumps whenever the shape produced by
 * `buildOperationIndex` changes in a way that would make an on-disk
 * cache misleading. We persist nothing today (everything is in-memory)
 * but the version stamp travels with the processed spec so future on-disk
 * caching can hash against it.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOperationIndex } from './index-builder.js';
import type { BundledSpec, ProcessedSpec } from '../types/spec.js';

export const CACHE_SCHEMA_VERSION = 1;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Candidate paths for the bundled spec. Order matters — the first
 * existing file wins. Both candidates resolve to the same file on disk
 * in production, but the layout differs between `src/spec/...` (dev,
 * `tsx`) and `dist/spec/...` (built, `node dist/index.js`).
 */
const BUNDLED_PATHS: string[] = [
  resolve(__dirname, 'site24x7-fallback.json'),
  resolve(__dirname, '..', 'spec', 'site24x7-fallback.json'),
  resolve(__dirname, '..', '..', 'src', 'spec', 'site24x7-fallback.json'),
];

let processedCache: ProcessedSpec | undefined;

export interface LoadSpecOptions {
  /** Override the path; used by tests. */
  bundledPath?: string;
  /** Drop the in-memory cache (forces re-read on next call). */
  forceReload?: boolean;
}

export async function loadBundledSpec(opts: LoadSpecOptions = {}): Promise<ProcessedSpec> {
  if (!opts.forceReload && !opts.bundledPath && processedCache) {
    return processedCache;
  }
  const path = opts.bundledPath ?? findBundled();
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as BundledSpec;
  if (!Array.isArray(parsed.operations)) {
    throw new Error(`Bundled spec ${path} is missing the operations array`);
  }
  const processed = buildOperationIndex(parsed);
  if (!opts.bundledPath) processedCache = processed;
  return processed;
}

export function clearSpecCache(): void {
  processedCache = undefined;
}

export function specSummary(spec: ProcessedSpec): {
  title: string;
  generatedAt: string;
  scraperVersion: string;
  operations: number;
  tags: number;
  mspOnly: number;
  buOnly: number;
} {
  let msp = 0;
  let bu = 0;
  for (const op of spec.operations) {
    if (op.mspOnly) msp += 1;
    if (op.buOnly) bu += 1;
  }
  return {
    title: spec.title,
    generatedAt: spec.generatedAt,
    scraperVersion: spec.scraperVersion,
    operations: spec.operations.length,
    tags: spec.operationsByTag.size,
    mspOnly: msp,
    buOnly: bu,
  };
}

function findBundled(): string {
  for (const candidate of BUNDLED_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Bundled spec not found at any of: ${BUNDLED_PATHS.join(', ')}. Run \`npm run update-spec\` to generate it.`,
  );
}
