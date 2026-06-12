/**
 * Internal spec shape produced by `scripts/update-spec.ts` and consumed by
 * `src/spec/loader.ts` + `src/spec/index-builder.ts`.
 *
 * Site24x7 does not publish an OpenAPI document, so we define our own
 * minimal schema by scraping the public REST reference at
 * https://www.site24x7.com/help/api/.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** A single parameter (path / query / body). */
export interface ParamSpec {
  /** Parameter name as it appears in the URL or body. */
  name: string;
  /** Where the parameter lives. */
  in: 'path' | 'query' | 'body' | 'header';
  /** True if the operation will 400 without this parameter. */
  required: boolean;
  /** Free-form type hint pulled from the docs (`string`, `long`, `array of strings`, …). */
  type?: string;
  /** Human description from the docs. */
  description?: string;
}

/**
 * A single API operation as parsed from the docs. One per documented
 * endpoint (e.g. "Create Monitor", "List MSP Customers").
 */
export interface RawOperation {
  /** Stable identifier — sanitised from method + path. */
  operationId: string;
  /** HTTP method. */
  method: HttpMethod;
  /** Path with `:placeholder` segments, e.g. `/api/monitors/:monitor_id`. */
  path: string;
  /** Optional API version override (defaults to `2.0`). */
  version?: string;
  /** Section heading from the docs. */
  summary: string;
  /** Tag derived from the H1/H2 grouping (e.g. `monitors`, `msp`, `reports`). */
  tag: string;
  /** Brief description (first paragraph after the section heading). */
  description?: string;
  /** Required Zoho OAuth scopes (e.g. `["Site24x7.Admin.Create"]`). */
  requiredScopes: string[];
  /** True if this operation only works under an MSP `zaaid` scope. */
  mspOnly: boolean;
  /** True if this operation only works under a BU `zaaid` scope. */
  buOnly: boolean;
  /** Parsed parameters. */
  params: ParamSpec[];
  /** URL of the doc section the operation was parsed from, for traceability. */
  docUrl: string;
}

/** Top-level shape of the bundled spec file (`src/spec/site24x7-fallback.json`). */
export interface BundledSpec {
  /** Where the spec came from (always the public docs URL). */
  sourceUrl: string;
  /** When the spec was generated (ISO 8601). */
  generatedAt: string;
  /** Version of the scraper. Bump when you change the parser. */
  scraperVersion: string;
  /** Human title (`"Site24x7 REST API"`). */
  title: string;
  /** List of operations. */
  operations: RawOperation[];
}

/**
 * Operation as stored in the in-memory index. Same fields as `RawOperation`
 * for now, but kept distinct so the index-builder is free to add derived
 * lookups later without changing the bundled-spec on-disk shape.
 */
export interface IndexedOperation extends RawOperation {
  /** Lowercased searchable haystack (summary + description + tag + path). */
  haystack: string;
}

/** Fully processed spec ready to feed the sandbox + search tool. */
export interface ProcessedSpec {
  sourceUrl: string;
  generatedAt: string;
  scraperVersion: string;
  title: string;
  operations: IndexedOperation[];
  /** Indexed by `operationId` for O(1) lookup. */
  operationsById: Map<string, IndexedOperation>;
  /** Tag → operations. */
  operationsByTag: Map<string, IndexedOperation[]>;
}
