/**
 * Build the in-memory operation index used by the `search` tool and the
 * sandbox's typed `site24x7.<tag>.<op>` accessors.
 *
 * The on-disk shape (`BundledSpec`) is purposefully simple. This module
 * derives the secondary lookups (`operationsById`, `operationsByTag`,
 * `haystack` for full-text-ish search) at startup.
 */

import type { BundledSpec, IndexedOperation, ProcessedSpec, RawOperation } from '../types/spec.js';

export function buildOperationIndex(spec: BundledSpec): ProcessedSpec {
  const operations: IndexedOperation[] = spec.operations.map((op) => ({
    ...op,
    haystack: buildHaystack(op),
  }));
  const operationsById = new Map<string, IndexedOperation>();
  const operationsByTag = new Map<string, IndexedOperation[]>();
  for (const op of operations) {
    operationsById.set(op.operationId, op);
    const bucket = operationsByTag.get(op.tag);
    if (bucket) bucket.push(op);
    else operationsByTag.set(op.tag, [op]);
  }
  return {
    sourceUrl: spec.sourceUrl,
    generatedAt: spec.generatedAt,
    scraperVersion: spec.scraperVersion,
    title: spec.title,
    operations,
    operationsById,
    operationsByTag,
  };
}

function buildHaystack(op: RawOperation): string {
  const parts: string[] = [
    op.operationId,
    op.summary,
    op.tag,
    op.path,
    op.method,
    op.description ?? '',
    op.requiredScopes.join(' '),
  ];
  if (op.mspOnly) parts.push('msp mspOnly');
  if (op.buOnly) parts.push('bu buOnly business unit');
  for (const p of op.params) {
    parts.push(p.name);
    if (p.description) parts.push(p.description);
  }
  return parts.join(' ').toLowerCase();
}

/** Tiny search ranker — splits the query on whitespace, returns operations
 * whose `haystack` contains every term, ordered by an aggregated score
 * that favours operationId / summary matches over description matches. */
export function searchOperations(spec: ProcessedSpec, query: string, limit = 25): IndexedOperation[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return spec.operations.slice(0, limit);
  const scored: Array<{ op: IndexedOperation; score: number }> = [];
  for (const op of spec.operations) {
    let score = 0;
    let allMatched = true;
    for (const term of terms) {
      const inHaystack = op.haystack.includes(term);
      if (!inHaystack) {
        allMatched = false;
        break;
      }
      if (op.operationId.toLowerCase().includes(term)) score += 8;
      if (op.summary.toLowerCase().includes(term)) score += 4;
      if (op.tag.toLowerCase().includes(term)) score += 3;
      if (op.path.toLowerCase().includes(term)) score += 2;
      score += 1;
    }
    if (allMatched) scored.push({ op, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.op);
}
