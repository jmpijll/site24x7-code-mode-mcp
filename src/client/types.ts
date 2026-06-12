/**
 * Shared client-side request/response shapes.
 */

import type { HttpMethod, IndexedOperation } from '../types/spec.js';

export interface Site24x7RequestParams {
  method: HttpMethod;
  /** Path beginning with `/api/...`. Path parameters like `:id` are replaced from `pathParams`. */
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  /** Override the `Accept: application/json; version=<x>` header (default `2.0`). */
  version?: string;
  /** Override the active `zaaid` for this single call. */
  zaaid?: string;
  /** Pass the indexed operation when known, so 401/403s get scope hints. */
  operation?: IndexedOperation;
}

export interface Site24x7Response<T = unknown> {
  status: number;
  data: T;
  /** Site24x7 standard envelope: `{ code, message, data }`. We surface as-is. */
  raw: unknown;
  headers: Record<string, string>;
}
