/**
 * Tenant types shared across config / tenant / auth / client / sandbox.
 *
 * A `TenantContext` is the full set of inputs the HTTP client needs to make
 * an authenticated, correctly-scoped call to Site24x7. It is rebuilt from
 * env (single-user) or HTTP headers (multi-tenant) on every request and
 * stashed in AsyncLocalStorage.
 */

import type { Site24x7Zone } from './zones.js';

export type AccountType = 'standard' | 'msp' | 'bu';

/**
 * The credentials and tenancy metadata for a single request.
 *
 * `clientId`, `clientSecret`, `refreshToken`, `zone` together identify the
 * Zoho OAuth identity. `zaaid` (if set) overlays an MSP customer or BU
 * scope on top of that identity.
 */
export interface TenantContext {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  zone: Site24x7Zone;
  /** Optional MSP customer / BU `zaaid` to inject as a Cookie. */
  zaaid?: string;
  /** Hint for clearer error messages. Default `standard`. */
  accountType: AccountType;
}

/**
 * Thrown when the server is in multi-tenant HTTP mode but the request
 * didn't carry the required headers (or in stdio mode but the env is
 * incomplete).
 */
export class MissingCredentialsError extends Error {
  public readonly missing: string[];
  public override readonly name = 'MissingCredentialsError';
  constructor(missing: string[]) {
    super(
      `[site24x7.MissingCredentialsError] no complete Site24x7 OAuth credentials in scope — missing: ${missing.join(
        ', ',
      )}. In stdio mode set the SITE24X7_* env vars; in HTTP mode pass X-Site24x7-* headers.`,
    );
    this.missing = missing;
  }
}

/**
 * Thrown when an MSP- or BU-only operation is invoked without a `zaaid`.
 * Surfaced inside the sandbox so the model gets actionable feedback.
 */
export class MissingZaaidError extends Error {
  public readonly operationId: string;
  public readonly accountType: AccountType;
  public override readonly name = 'MissingZaaidError';
  constructor(operationId: string, accountType: AccountType, kind: 'msp' | 'bu') {
    const hint =
      kind === 'msp'
        ? 'Hint: call site24x7.listCustomers() and wrap the call in site24x7.withCustomer(zaaid, ...).'
        : 'Hint: call site24x7.listCustomers() (BU mode lists business units) and wrap the call in site24x7.withCustomer(zaaid, ...).';
    super(
      `[site24x7.MissingZaaidError] operation "${operationId}" requires a zaaid in scope (operation is ${kind}Only=true, current accountType=${accountType}). ${hint}`,
    );
    this.operationId = operationId;
    this.accountType = accountType;
  }
}
