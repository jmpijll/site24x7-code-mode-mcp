/**
 * Search executor — read-only sandbox that exposes the bundled spec to
 * LLM-written JS. No network. Globals:
 *
 *   - `spec`             { title, sourceUrl, generatedAt, operationCount, tags[] }
 *   - `getOperation(id)` full IndexedOperation lookup (or null)
 *   - `searchOperations(query, limit?)` ranked text search (default 25)
 *   - `findOperationsByPath(substr)`    substring on path
 *   - `findOperationsByTag(tag)`         operations within a tag
 */

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten';
import { searchOperations } from '../spec/index-builder.js';
import type { IndexedOperation, ProcessedSpec } from '../types/spec.js';
import { BaseSyncExecutor, injectJsonValue } from './executor.js';
import { SEARCH_MAX_MEMORY_BYTES, SEARCH_TIMEOUT_MS } from './limits.js';

export interface SearchExecutorOptions {
  spec?: ProcessedSpec;
}

export class SearchExecutor extends BaseSyncExecutor {
  private readonly spec?: ProcessedSpec;

  constructor(options: SearchExecutorOptions) {
    super({ timeoutMs: SEARCH_TIMEOUT_MS, maxMemoryBytes: SEARCH_MAX_MEMORY_BYTES });
    this.spec = options.spec;
  }

  protected override setupContext(
    context: QuickJSContext,
    _runtime: QuickJSRuntime,
    _warnings: string[],
  ): void {
    const summary = this.spec
      ? {
          title: this.spec.title,
          sourceUrl: this.spec.sourceUrl,
          generatedAt: this.spec.generatedAt,
          operationCount: this.spec.operations.length,
          tags: [...this.spec.operationsByTag.keys()].sort(),
        }
      : null;
    injectJsonValue(context, 'spec', summary);

    const getOperationFn = context.newFunction('getOperation', (idHandle: QuickJSHandle) => {
      const id = context.getString(idHandle);
      if (!this.spec) return context.null;
      const op = this.spec.operationsById.get(id);
      if (!op) return context.null;
      return jsonValueToHandle(context, summariseOp(op));
    });
    context.setProp(context.global, 'getOperation', getOperationFn);
    getOperationFn.dispose();

    const searchFn = context.newFunction(
      'searchOperations',
      (qHandle: QuickJSHandle, limitHandle?: QuickJSHandle) => {
        const q = context.getString(qHandle);
        const limit =
          limitHandle && context.typeof(limitHandle) === 'number'
            ? context.getNumber(limitHandle)
            : 25;
        if (!this.spec) return jsonValueToHandle(context, []);
        const ops = searchOperations(this.spec, q, limit).map(summariseOp);
        return jsonValueToHandle(context, ops);
      },
    );
    context.setProp(context.global, 'searchOperations', searchFn);
    searchFn.dispose();

    const byPathFn = context.newFunction('findOperationsByPath', (pHandle: QuickJSHandle) => {
      const pattern = context.getString(pHandle).toLowerCase();
      if (!this.spec) return jsonValueToHandle(context, []);
      const matches = this.spec.operations
        .filter((op) => op.path.toLowerCase().includes(pattern))
        .map(summariseOp);
      return jsonValueToHandle(context, matches);
    });
    context.setProp(context.global, 'findOperationsByPath', byPathFn);
    byPathFn.dispose();

    const byTagFn = context.newFunction('findOperationsByTag', (tHandle: QuickJSHandle) => {
      const tag = context.getString(tHandle);
      if (!this.spec) return jsonValueToHandle(context, []);
      const ops = (this.spec.operationsByTag.get(tag) ?? []).map(summariseOp);
      return jsonValueToHandle(context, ops);
    });
    context.setProp(context.global, 'findOperationsByTag', byTagFn);
    byTagFn.dispose();
  }
}

function summariseOp(op: IndexedOperation): Record<string, unknown> {
  return {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    tag: op.tag,
    summary: op.summary,
    description: op.description,
    requiredScopes: op.requiredScopes,
    mspOnly: op.mspOnly,
    buOnly: op.buOnly,
    version: op.version,
    params: op.params.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      type: p.type,
      description: p.description,
    })),
    docUrl: op.docUrl,
  };
}

function jsonValueToHandle(context: QuickJSContext, value: unknown): QuickJSHandle {
  const json = JSON.stringify(value);
  const result = context.evalCode(`(${json})`);
  if (result.error) {
    result.error.dispose();
    return context.null;
  }
  return result.value;
}
