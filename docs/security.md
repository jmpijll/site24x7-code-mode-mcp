# Security model

## Threat model

The server sits between an LLM agent (whose code generation is potentially adversarial — directly or via prompt injection) and the Site24x7 REST API (a SaaS that can mutate monitors, threshold profiles, alert rules, and — for MSP/BU users — every customer in the portal). The threat surface is:

1. **Adversarial sandbox code.** The LLM might try to exfiltrate credentials, exhaust resources, or call destructive operations.
2. **Credential leakage.** The Zoho refresh token (permanent) and short-lived access tokens must not be visible to the sandbox, the MCP wire, logs, or other tenants' requests.
3. **Resource exhaustion.** Malicious or buggy code might loop forever, allocate gigabytes, or spam the upstream API.
4. **Cross-tenant privilege escalation.** In HTTP mode, one tenant's request must not see another's credentials, `zaaid`, or access token.
5. **Cross-customer privilege escalation within one OAuth identity.** An MSP operator's `withCustomer('A')` block must not leak the `zaaid` into a sibling `withCustomer('B')` block, or into surrounding code after `withCustomer` returns.

## Defenses

### Refresh tokens never enter the sandbox

`TenantContext` (`src/types/tenant.ts`) lives on the host. The QuickJS prelude only exposes opaque `__site24x7Call(...)` and `__site24x7Raw(...)` host bindings — the HTTP client that holds the refresh token is constructed on the host side from the resolved context and is unreachable from sandbox code. The sandbox has no `process`, no `require`, no `import`, no `eval`, no `Function`, no `fetch`. There is no path from sandbox code to `process.env`.

### In-memory access-token cache

The access-token cache (`src/auth/zoho-oauth.ts`) lives only in process memory. It is:

- **Keyed** on `tenantCacheKey(ctx)` = `${zone}|${clientId}|${refreshToken}`. Two callers with different OAuth identities never share an access token.
- **Bounded** by `expires_in - 60s` (default `~59 minutes` per Zoho contract). After expiry the next call refreshes.
- **Coalesced** for concurrent refreshes — multiple callers hitting an expired token share one in-flight `POST /oauth/v2/token` rather than racing.
- **Invalidated** on a 401: the HTTP client drops the cached token and re-asks for a fresh one before retrying the original call once.
- **Never written to disk.** Process exit discards everything. The on-disk cache directory (`SITE24X7_CACHE_DIR`) only stores spec metadata.

The refresh token itself is **never** cached anywhere — it lives in the `TenantContext` for the duration of a single request and is forgotten when the request returns.

### Per-request scoping via `AsyncLocalStorage`

In HTTP mode every request runs inside its own Node `AsyncLocalStorage` scope (`src/server/request-context.ts`). The tenant resolver reads the ALS slot and builds a fresh `TenantContext` from headers. Two interleaved requests on the same Node process cannot share credentials, cannot share `zaaid`, and cannot share `accountType`.

### `zaaid` isolation: stack semantics for `withCustomer`

`site24x7.withCustomer(zaaid, fn)` pushes the customer onto a per-request stack, runs `fn` with that scope, and pops on `return` or `throw`. The HTTP client reads the **top** of the stack (else `TenantContext.zaaid`, else none) on each wire call. Properties:

- A `throw` from `fn` still pops the stack — there's no leak path through the error channel.
- Nested calls work: an inner `withCustomer('B')` inside an outer `withCustomer('A')` runs against `B`, and returns to `A` when it pops.
- The stack is per-`ExecuteExecutor`, which is per-request. A second request cannot see the first's stack.
- `await`s inside `fn` keep the right top-of-stack because of how the host bridges QuickJS promises — the stack mutation is synchronous around the `__site24x7Call`, never deferred across event-loop turns.

### Sandbox resource limits

`src/sandbox/limits.ts` caps every sandbox invocation:

- **Time:** 30 s wall-clock deadline for `execute`, 10 s for `search` (`SITE24X7_EXECUTE_TIMEOUT_MS`).
- **Memory:** 64 MiB for `execute`, 32 MiB for `search` (`runtime.setMemoryLimit`).
- **Stack:** 512 KiB (`runtime.setMaxStackSize`).
- **API call budget:** 50 per `execute` (`SITE24X7_MAX_CALLS_PER_EXECUTE`). Enforced in the dispatcher before forwarding to the HTTP client.
- **Code input:** 100 000 characters. Enforced at the MCP boundary.
- **Result size:** 100 000 characters. Truncated with a notice.

The call budget is the most important defence against fan-out abuse: an MSP sweep against 500 customers will hit the budget long before it hits Zoho's per-token rate limit. Raise the budget deliberately, with eyes open, for sweeps you've decided to run.

### Always-strict TLS

Site24x7 and Zoho both serve from publicly-trusted certificates. There is no `insecure` mode, no custom CA support, no self-signed cert path. If your DNS resolves `accounts.zoho.com` or `www.site24x7.com` to anything that isn't a publicly-trusted endpoint, the request fails — intentionally.

### Rate-limit respect

Site24x7's per-token rate limit (~10 req/s on most plans) returns `429 Too Many Requests`. The HTTP client honours `Retry-After` (capped at 60 s) and retries **once**. The second 429 propagates as a `Site24x7HttpError` to the sandbox. No exponential backoff loops.

### Scope-aware error surfacing

`Site24x7HttpError` for typed calls includes the operation's `requiredScopes` (scraped from the docs' `oauthscope` line). The model sees:

```text
[site24x7.HttpError] HTTP 403 on /api/monitors: ... (operation requires
scope `Site24x7.Admin.All` — your refresh token lacks it)
```

This is informational only — the server does not pre-filter operations by scope. The operator decides which scopes to grant at refresh-token-mint time.

## What is *not* defended against

- **Destructive operations the LLM was asked to run.** If a user prompts the agent to `monitors.delete({...})` and the agent does so, the server happily forwards that request. Pre-execution review of mutating operations is the SKILL's responsibility, not the runtime's.
- **Subtle scope abuse with a privileged token.** A refresh token minted with `Site24x7.Admin.All` can mutate anything an admin user can. The server does not narrow scopes; that's the operator's job at token-mint time. Mint the **narrowest** set of scopes that covers your intended use (see the scope table in [`../README.md`](../README.md)).
- **MSP operator abusing a different customer.** An MSP refresh token with `Site24x7.Msp.All` can act against every customer under the portal. `withCustomer` is an ergonomics affordance, not an authorisation boundary; the boundary lives at refresh-token mint time and inside the Site24x7 portal's RBAC. If an MSP operator should not see customer X, do not grant them an MSP-scope refresh token.
- **Cross-zone data exfiltration.** A refresh token from one zone does not work against another zone's API host (Zoho will return a `INVALID_TOKEN`). The server doesn't model this as a defence — it falls out of the protocol.
- **Side-channel timing.** The sandbox does not normalise wall-clock timing; an adversarial script could in principle measure HTTP latencies to infer state. Accepted.
- **Stolen refresh tokens.** A leaked Zoho refresh token is **permanent** access until it's revoked. See "Operator responsibilities" below.

## Credential handling

- Credentials are read once per request (env or headers) into a `TenantContext`.
- The HTTP client copies the access token into `Authorization: Zoho-oauthtoken <token>` at request-build time.
- Refresh token, client secret, and access token are **never** logged, **never** included in MCP tool responses, and **never** echoed in error messages. The OAuth refresh helper logs only `(zone, clientId, expiresIn)` via the optional `onRefresh` callback.
- On request completion, the `TenantContext` is garbage-collected. The access-token cache survives the request but is in-memory only.
- On process exit, everything (cache included) is gone. The Zoho refresh token is held only in the operator's environment / headers store, never on this server's disk.

### Zoho refresh tokens are permanent

A Self Client refresh token does not expire. If it leaks, the attacker has permanent access to every Site24x7 operation the original scopes covered — across every customer in the portal if those scopes include `Site24x7.Msp.*` — until you explicitly revoke it. Treat refresh tokens like database passwords:

- Mint with the narrowest scope set that does the job.
- Store in a secrets manager, not in `.env` files committed to a repo.
- Revoke immediately if a host is compromised:

  ```bash
  curl -X POST 'https://accounts.zoho.com/oauth/v2/token/revoke?token=YOUR_REFRESH_TOKEN'
  ```

  Or via the Zoho web UI: <https://accounts.zoho.com/u/h#sessions/refreshtokens>. Replace `accounts.zoho.com` with the accounts host for your zone.

- Rotate periodically. There's no built-in expiry — that's a feature for uptime, a liability for stolen credentials.

## Operator responsibilities

- Use the **least-privilege scope set** at refresh-token mint time. See the scope table in [`../README.md`](../README.md).
- Run the HTTP transport behind TLS termination.
- Set `MCP_HTTP_ALLOWED_ORIGINS` to a strict list when serving browser clients.
- For MSP/BU portals, decide carefully whether to grant a refresh token `Site24x7.Msp.All` (every customer) or a narrower bundle. The server does not police this.
- Monitor `[site24x7.HttpError]` log lines — scope-aware 401/403 messages often hint at the problem before users complain.
- For shared deployments, do not put `MAX_CALLS_PER_EXECUTE` so high that one client can starve another via fan-out.

## Reporting vulnerabilities

Don't open a public GitHub issue for security problems. See [`SECURITY.md`](../SECURITY.md) for the responsible-disclosure policy.

## What this server is **not** designed to do

- Run untrusted multi-tenant LLMs against the same Site24x7 portal. The MCP server is single-trust; if you wouldn't give the LLM your refresh token, don't put it behind this server.
- Replace Zoho's OAuth scope system. The refresh token's granted scopes still gate what calls can actually do.
- Substitute for an MSP RBAC layer. `withCustomer` is for ergonomics, not authorisation.
