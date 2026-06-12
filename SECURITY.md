# Security policy

## Supported versions

This project is in public **beta**. Only the latest tagged version
(currently `v0.1.0-beta.1`) receives security fixes.

| Version | Supported |
|---|---|
| `0.1.0-beta.x` | yes |
| `0.0.x` and earlier | no |

When `1.0.0` ships, we'll narrow this to "current minor + previous minor".

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private security advisories:

1. Go to <https://github.com/jmpijll/site24x7-code-mode-mcp/security/advisories>
2. Click **"Report a vulnerability"**
3. Fill in the form

Include:

- A description of the vulnerability and its impact
- Steps to reproduce (or a PoC)
- Affected commit / tag
- Suggested fix if you have one

We aim to acknowledge within 7 days and have a fix or mitigation within
30 days for confirmed issues. We'll coordinate disclosure with you.

## Scope

In scope:

- The MCP server (stdio + Streamable HTTP transports)
- The QuickJS sandbox host bridge (escape paths, header smuggling, prototype
  pollution between sandbox and host, secret leakage)
- The credential-resolution path (env vs HTTP headers, multi-tenant
  `AsyncLocalStorage` isolation, refresh-token handling)
- The Zoho OAuth 2.0 refresh-token cache (in-memory storage, key derivation,
  TTL handling)
- The MSP / BU `zaaid` scoping path (per-request injection, sandbox
  `withCustomer` isolation)
- The Cloudflare Workers entry (`cf-worker/`)
- The bundled JSON spec loader and its caching behaviour
- Anything in the published source that could mishandle a customer's Zoho
  client secret or refresh token

Out of scope (please report to the relevant upstream, not us):

- Vulnerabilities in the Site24x7 API or Zoho accounts service itself
- Vulnerabilities in `quickjs-emscripten-core`, `@modelcontextprotocol/sdk`,
  `undici`, `zod`, or any other upstream dependency (please file with them;
  we'll bump once a fix lands)

## Threat model

This MCP server is a development / homelab / MSP tool, not a hardened
multi-tenant SaaS:

- The `execute` tool runs **LLM-written JavaScript** against your Site24x7
  account. Treat your MCP client config the way you'd treat your Zoho
  refresh token — anyone who can talk to your MCP server can issue
  mutations (create monitors, suspend alerts, modify users, …) against
  your Site24x7 tenant.
- The QuickJS sandbox isolates the LLM's code from the host; the Zoho
  client secret, refresh token, access token, and `zaaid` never enter the
  sandbox. The sandbox cannot open sockets, files, or load Node modules.
- The host enforces a per-execute API call budget (default 50; configurable
  via `SITE24X7_MAX_CALLS_PER_EXECUTE`) and a 30 s sandbox cap to bound
  runaway loops.
- Multi-tenant deployments are gated by an origin allowlist
  (`MCP_HTTP_ALLOWED_ORIGINS`) and should sit behind a reverse proxy with
  auth before being exposed to the public internet.

## Credentials

- **Refresh tokens are permanent.** A leaked refresh token grants
  perpetual access to every scope the Self Client was created with until
  the token is revoked at <https://accounts.zoho.com/u/h#sessions/refreshtokens>.
- Refresh tokens never leave the host process. The sandbox sees only the
  opaque `site24x7.*` prelude; the host injects the `Authorization`
  header at request time.
- Access tokens are cached in memory only (`Map` keyed by SHA-256 of
  `client_id + refresh_token + zone`), with TTL `expires_in - 60s`.
  Restarting the server discards all access tokens.
- The `Cookie: zaaid=<customer_id>` is treated as tenancy metadata, not a
  secret. It still must not leak across tenants in multi-user mode —
  `AsyncLocalStorage` isolates per-request state.

## MSP / BU isolation

In multi-tenant HTTP mode, each request's `X-Site24x7-*` headers are
materialised into a fresh `TenantContext` and stashed in an
`AsyncLocalStorage` scope for the duration of that one request. The
sandbox's `site24x7.withCustomer(zaaid, fn)` helper layers an additional
zaaid override on top, also via `AsyncLocalStorage`, and is unwound
deterministically when the closure resolves or throws. No global mutable
state holds tenancy information.
