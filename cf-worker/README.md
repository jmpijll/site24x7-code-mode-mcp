# Cloudflare Workers entry

This directory contains the scaffold for an eventual Cloudflare-native deployment of the Site24x7 code-mode MCP server, intended to follow the same pattern as Cloudflare's [`@cloudflare/codemode`](https://www.npmjs.com/package/@cloudflare/codemode) helper plus a [Worker Loader](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) sandbox.

## Status

**Scaffold.** The Worker validates per-request credentials and routes `/health`, but `/mcp` returns 501. The bundled spec is not embedded, the Zoho OAuth refresh path is not wired, and the MCP transport adapter is intentionally absent.

For a fully-working multi-tenant HTTP MCP server, use the Node entry (`npm start` from the repo root).

## What's verified

- `wrangler --version` resolves (devDep in the root `package.json`).
- `wrangler deploy --config cf-worker/wrangler.toml --dry-run` typechecks the Worker against `@cloudflare/workers-types`.
- `/health` returns `{ status: "ok", namespace: "site24x7" }`.
- `/mcp` returns 401 when any of the four required credential headers (`X-Site24x7-Client-Id`, `X-Site24x7-Client-Secret`, `X-Site24x7-Refresh-Token`, `X-Site24x7-Zone`) are missing or the zone is unknown.
- `/mcp` returns 501 with a pointer back to this README once credentials are present.
- Unknown paths return 404.

## What's NOT verified

- The full Worker transport adapter. The MCP TypeScript SDK's `StreamableHTTPServerTransport` is built on top of `node:http`'s `IncomingMessage` / `ServerResponse`; Workers exposes Web `Request` / `Response`. Bridging the two requires either:
  1. The MCP SDK shipping a web-streams transport (tracked upstream)
  2. A small shim that adapts Web `Request` to the SDK's expected shape
- Spec embedding. Site24x7 publishes no OpenAPI document, so the runtime spec lives in `src/spec/site24x7-fallback.json` (~hundreds of KB JSON) and would need to be shipped via [Workers Assets](https://developers.cloudflare.com/workers/static-assets/) or a [KV binding](https://developers.cloudflare.com/kv/) before a real cf deployment can mount it. The Node entry reads it from disk; the Worker cannot.
- Zoho OAuth 2.0 refresh on the Worker. The host-side refresh path lives in `src/auth/zoho-oauth.ts` and would need a Workers-native port (no `node:fs`, no `undici`) before this entry can mint access tokens.
- Sandbox dispatch. The host-side `request()` that injects `Authorization: Zoho-oauthtoken <access>`, `Accept: application/json; version=2.0`, and — crucially — `Cookie: zaaid=<id>` for MSP / Business Unit scoping is not yet implemented here. The cookie is the upstream's first-class MSP/BU mechanism (see [../AGENTS.md](../AGENTS.md) §6.3); any real Worker dispatch must respect it.

## Auth contract

Per-request HTTP headers, identical to the Node HTTP transport ([../docs/multi-tenant.md](../docs/multi-tenant.md)):

| Header                       | Required | Purpose                                          |
| ---------------------------- | -------- | ------------------------------------------------ |
| `X-Site24x7-Client-Id`       | yes      | Zoho Self Client client ID                       |
| `X-Site24x7-Client-Secret`   | yes      | Zoho Self Client client secret                   |
| `X-Site24x7-Refresh-Token`   | yes      | Zoho refresh token (permanent)                   |
| `X-Site24x7-Zone`            | yes      | One of `com`, `eu`, `in`, `com.au`, `cn`, `jp`, `ca`, `uk`, `ae`, `sa` |
| `X-Site24x7-Zaaid`           | no       | MSP customer / BU zaaid; sent upstream as `Cookie: zaaid=<id>` |
| `X-Site24x7-Account-Type`    | no       | `standard` / `msp` / `bu`; only used for clearer error messages |

Equivalent `DEFAULT_*` Worker vars / secrets in `wrangler.toml` for single-tenant deployments. One refresh token = one Zoho OAuth identity = one Site24x7 zone; multi-zone deployments need one Worker (or one route per zone).

## Deploy

```bash
npm run cf:dev      # local wrangler dev
npm run cf:deploy   # deploy to Cloudflare
```

`npm run cf:dev` is an alias for `wrangler dev --config cf-worker/wrangler.toml`.

## Requirements

- **Wrangler ≥ 4.0.0** — the `worker_loaders = [{ binding = "LOADER" }]` binding in `wrangler.toml` is supported on `wrangler@4+`. The repo's `devDependencies` already pin this; `npm run cf:dev` / `npm run cf:deploy` pick it up.

## Limitations

- `/mcp` returns 501 by design until the transport adapter, spec embedding, and Zoho refresh path are wired up. Use the Node entry for a working multi-tenant HTTP server.
- No persistent on-disk caches; everything would be module-memory per Worker instance once dispatch is wired.
- Zoho refresh tokens are permanent — store like a password; prefer Worker secrets over `[vars]`.
