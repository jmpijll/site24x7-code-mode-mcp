/**
 * Per-request context propagated via AsyncLocalStorage.
 *
 * The HTTP transport runs each MCP request inside an ALS scope carrying the
 * request's lower-cased HTTP headers. The `tenantResolver` provided to
 * `createMcpServer` reads from this scope to build a fresh `TenantContext`
 * per request, so two concurrent multi-tenant callers never see each other's
 * credentials or `zaaid`.
 *
 * In stdio mode no scope is established — the resolver falls back to env vars.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestScope {
  /** Lower-cased HTTP headers. */
  headers: Record<string, string | string[] | undefined>;
  /** Caller IP for logging. */
  clientIp?: string;
}

export const requestStore = new AsyncLocalStorage<RequestScope>();

export function currentRequestScope(): RequestScope | undefined {
  return requestStore.getStore();
}
