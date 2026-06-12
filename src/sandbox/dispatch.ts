/**
 * Host-side dispatch — turns sandbox `site24x7.*` calls into real HTTP
 * requests against Site24x7.
 *
 * Four entry points the sandbox can reach (via the prelude in
 * `buildSite24x7Prelude`):
 *
 *   - dispatchOperation()  → typed `site24x7.<tag>.<op>(args)`
 *   - dispatchRawRequest() → `site24x7.request({ method, path, ... })`
 *   - dispatchListCustomers() → `site24x7.listCustomers()` (MSP/BU)
 *   - dispatchWithCustomer() → `site24x7.withCustomer(zaaid, fn)` (host
 *     just executes the closure; the zaaid override is implemented on the
 *     sandbox side by mutating the prelude's ambient zaaid for the duration
 *     of the call)
 *
 * Smart argument routing for `dispatchOperation`:
 *   - Recognised reserved keys (`pathParams`, `query`, `body`, `headers`,
 *     `version`, `zaaid`) are used verbatim.
 *   - Other args that match spec parameters with `in: 'path' | 'query'`
 *     are auto-routed there.
 *   - Remaining keys form the body when the operation is a POST/PUT/PATCH.
 */

import type { Site24x7HttpClient } from '../client/http.js';
import type { Site24x7RequestParams, Site24x7Response } from '../client/types.js';
import type { IndexedOperation, ProcessedSpec } from '../types/spec.js';
import type { TenantContext } from '../types/tenant.js';

export class UnknownOperationError extends Error {
  public override readonly name = 'UnknownOperationError';
  public readonly operationId: string;
  constructor(operationId: string) {
    super(
      `[site24x7.UnknownOperationError] no operation "${operationId}" in the Site24x7 spec. Use site24x7_search to find the right operationId.`,
    );
    this.operationId = operationId;
  }
}

export interface DispatchOperationArgs {
  [key: string]: unknown;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  version?: string;
  zaaid?: string;
}

export async function dispatchOperation(
  client: Site24x7HttpClient,
  ctx: TenantContext,
  spec: ProcessedSpec,
  operationId: string,
  args: DispatchOperationArgs = {},
): Promise<Site24x7Response> {
  const op = spec.operationsById.get(operationId);
  if (!op) throw new UnknownOperationError(operationId);
  const params = routeArgsToRequest(op, args);
  return client.request(ctx, params);
}

export async function dispatchRawRequest(
  client: Site24x7HttpClient,
  ctx: TenantContext,
  args: Site24x7RequestParams,
): Promise<Site24x7Response> {
  if (typeof args !== 'object' || typeof args.path !== 'string') {
    throw new Error(
      '[site24x7.error] request() argument must be an object with at least a string `path`. Example: site24x7.request({ method: "GET", path: "/api/current_status" })',
    );
  }
  return client.request(ctx, args);
}

/**
 * Returns the customer / business-unit list, choosing the right discovery
 * endpoint based on the account type in the tenant context.
 */
export async function dispatchListCustomers(
  client: Site24x7HttpClient,
  ctx: TenantContext,
): Promise<unknown> {
  const path =
    ctx.accountType === 'bu'
      ? '/api/short/bu/business_units'
      : '/api/short/msp/customers';
  const res = await client.request(ctx, { method: 'GET', path });
  return res.data;
}

function routeArgsToRequest(op: IndexedOperation, args: DispatchOperationArgs): Site24x7RequestParams {
  const pathParams: Record<string, string | number> = { ...(args.pathParams ?? {}) };
  const query: Record<string, string | number | boolean | string[] | undefined> = {
    ...(args.query ?? {}),
  };
  let body: unknown = args.body;
  const version = args.version;
  const zaaid = args.zaaid;

  const RESERVED = new Set(['pathParams', 'query', 'body', 'headers', 'version', 'zaaid']);
  const remaining: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!RESERVED.has(k)) remaining[k] = v;
  }

  for (const param of op.params) {
    if (param.in !== 'path' && param.in !== 'query') continue;
    if (!(param.name in remaining)) continue;
    const value = remaining[param.name];
    Reflect.deleteProperty(remaining, param.name);
    if (value === undefined) continue;
    if (param.in === 'path') {
      if (typeof value === 'string' || typeof value === 'number') {
        pathParams[param.name] = value;
      }
    } else {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        Array.isArray(value)
      ) {
        query[param.name] = value as string | number | boolean | string[];
      }
    }
  }

  const acceptsBody = op.method === 'POST' || op.method === 'PUT' || op.method === 'PATCH';
  if (body === undefined && acceptsBody && Object.keys(remaining).length > 0) {
    body = remaining;
  }

  const params: Site24x7RequestParams = {
    method: op.method,
    path: op.path,
    operation: op,
  };
  if (Object.keys(pathParams).length > 0) params.pathParams = pathParams;
  if (Object.keys(query).length > 0) params.query = query;
  if (body !== undefined) params.body = body;
  if (version !== undefined) params.version = version;
  if (zaaid !== undefined) params.zaaid = zaaid;
  return params;
}

// ─── Prelude builder ────────────────────────────────────────────────

/**
 * Build the JS prelude that creates the `site24x7` namespace at sandbox
 * init time. Functions delegate to host bindings:
 *
 *   __site24x7Call(opId, argsJson)       → typed dispatch
 *   __site24x7Raw(argsJson)              → raw request
 *   __site24x7ListCustomers()            → MSP/BU customer enumeration
 *
 * MSP / `zaaid` ergonomics live entirely in this prelude. The ambient
 * zaaid for the sandbox is held in a closure variable `__activeZaaid` that
 * is initialised from the tenant context, surfaced as `site24x7.zaaid`,
 * and overridden inside the body of `site24x7.withCustomer(zaaid, fn)`.
 * The override stack rewinds even when `fn` throws.
 *
 * NB: every call ends up routing through the host with `zaaid` injected
 * as part of the argsJson. The host trusts the sandbox-provided zaaid
 * because the host itself owns the tenant context — see http.ts.
 */
export function buildSite24x7Prelude(spec: ProcessedSpec, initialZaaid: string | undefined): string {
  const lines: string[] = [];
  lines.push('var site24x7 = (function() {');
  lines.push('  var __activeZaaid = ' + (initialZaaid ? JSON.stringify(initialZaaid) : 'undefined') + ';');
  lines.push('  function __parseHostJson(s) {');
  lines.push('    if (typeof s !== "string") return s;');
  lines.push('    if (s.length === 0) return null;');
  lines.push('    var env;');
  lines.push('    try { env = JSON.parse(s); } catch (e) { return s; }');
  lines.push('    if (env && typeof env === "object" && "ok" in env) {');
  lines.push('      if (env.ok) return env.data;');
  lines.push('      throw new Error(env.error || "[site24x7.error] unknown host error");');
  lines.push('    }');
  lines.push('    return env;');
  lines.push('  }');
  lines.push('  function __mergeZaaid(args) {');
  lines.push('    args = args || {};');
  lines.push('    if (__activeZaaid !== undefined && args.zaaid === undefined) {');
  lines.push('      args.zaaid = __activeZaaid;');
  lines.push('    }');
  lines.push('    return args;');
  lines.push('  }');
  lines.push('  function __wrapCall(opId) { return function(args) {');
  lines.push('    return __parseHostJson(__site24x7Call(opId, JSON.stringify(__mergeZaaid(args))));');
  lines.push('  }; }');
  lines.push('  function __raw(args) {');
  lines.push('    return __parseHostJson(__site24x7Raw(JSON.stringify(__mergeZaaid(args))));');
  lines.push('  }');
  lines.push('  var ns = {');
  lines.push(
    `    spec: ${JSON.stringify({
      title: spec.title,
      sourceUrl: spec.sourceUrl,
      generatedAt: spec.generatedAt,
      operationCount: spec.operations.length,
    })},`,
  );
  lines.push('    request: __raw,');
  lines.push('    callOperation: function(opId, args) { return __parseHostJson(__site24x7Call(opId, JSON.stringify(__mergeZaaid(args)))); },');
  lines.push('    listCustomers: function() { return __parseHostJson(__site24x7ListCustomers()); },');
  lines.push('    withCustomer: function(zaaid, fn) {');
  lines.push('      if (typeof zaaid !== "string" || zaaid.length === 0) {');
  lines.push('        throw new Error("[site24x7.error] withCustomer: zaaid must be a non-empty string");');
  lines.push('      }');
  lines.push('      if (typeof fn !== "function") {');
  lines.push('        throw new Error("[site24x7.error] withCustomer: second argument must be a function");');
  lines.push('      }');
  lines.push('      var prev = __activeZaaid;');
  lines.push('      __activeZaaid = zaaid;');
  lines.push('      try {');
  lines.push('        var result = fn(ns);');
  lines.push('        __activeZaaid = prev;');
  lines.push('        return result;');
  lines.push('      } catch (e) { __activeZaaid = prev; throw e; }');
  lines.push('    }');
  lines.push('  };');
  lines.push('  Object.defineProperty(ns, "zaaid", { get: function() { return __activeZaaid; } });');

  const reserved = new Set([
    'spec',
    'request',
    'callOperation',
    'listCustomers',
    'withCustomer',
    'zaaid',
  ]);

  const groups = new Map<string, IndexedOperation[]>();
  for (const op of spec.operations) {
    const key = op.tag || 'general';
    const arr = groups.get(key) ?? [];
    arr.push(op);
    groups.set(key, arr);
  }

  for (const [tag, ops] of groups) {
    let safeTag = sanitizeIdentifier(tag);
    if (reserved.has(safeTag)) safeTag = `${safeTag}_`;
    lines.push(`  ns.${safeTag} = {};`);
    for (const op of ops) {
      const methodName = sanitizeIdentifier(op.operationId);
      lines.push(`  ns.${safeTag}.${methodName} = __wrapCall(${JSON.stringify(op.operationId)});`);
    }
  }

  lines.push('  return ns;');
  lines.push('})();');

  return lines.join('\n');
}

const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'let', 'static',
]);

export function sanitizeIdentifier(input: string): string {
  let out = input.replace(/[^a-zA-Z0-9_$]/g, '_');
  if (out.length === 0 || /^[0-9]/.test(out)) out = `_${out}`;
  if (RESERVED_WORDS.has(out)) out = `${out}_`;
  return out;
}
