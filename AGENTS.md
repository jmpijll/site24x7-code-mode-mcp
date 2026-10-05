# AGENTS.md — Guidance for AI agents working on this repo

This repository implements a code-mode MCP server for the **Zoho Site24x7 REST API**. **Read this whole file before making changes** — it captures the architectural invariants of the project.

> ## Audience disambiguation
>
> Three different "agent docs" live in this repo. Make sure you're reading the right one:
>
> | If you are… | Read |
> |---|---|
> | Editing the server's source code | **This file** + `CONTRIBUTING.md` |
> | An MCP client driving the *running* server | `SKILL.md` (operating manual) + `docs/usage.md` |
> | Wiring this MCP into your own agent and want a "Site24x7 expert" persona | [`examples/site24x7-expert-agent/`](examples/site24x7-expert-agent/) |
>
> This file (the root `AGENTS.md`) is **for contributors editing the server itself**. It is not a system prompt and not a recipe book.

---

## 1. 60-second orientation

```text
site24x7-mcp/
├── src/
│   ├── auth/        Zoho OAuth 2.0 refresh-token cache + accounts-zone routing
│   ├── client/      HTTP client (Zoho-oauthtoken auth, version=2.0, zaaid cookie, scope-aware errors)
│   ├── tenant/      TenantContext (OAuth identity + zone + zaaid + accountType) from env or headers
│   ├── spec/        Bundled JSON spec + loader + search index (no live OpenAPI endpoint upstream)
│   ├── sandbox/     QuickJS executors (search + execute) + dispatch prelude + resource limits
│   ├── server/      MCP tool registration + stdio / Streamable HTTP transports
│   ├── config.ts    Zod-validated env loading
│   └── index.ts     Node entrypoint
├── cf-worker/       Cloudflare Worker scaffold (501 transport, parity with sibling repos)
├── scripts/         update-spec.ts (docs scraper), live-test.ts, smoke-inspector.sh, mcp-call.mjs
├── docs/            architecture, multi-tenant, security, usage, opencode-skill, cursor-skill
└── src/__tests__/   Vitest suites
```

The whole product is just **two MCP tools** — `site24x7_search` and `site24x7_execute` — backed by a sandboxed JS surface (`site24x7.*`) that fans out to the Site24x7 REST API.

---

## 2. Architecture invariants — do not break these

1. **Two MCP tools, always.** `site24x7_search` and `site24x7_execute`. Adding tools defeats the Code Mode pattern.
2. **One sandbox surface — `site24x7.*`.** MSP and BU operations live on the same surface; the spec's `mspOnly` / `buOnly` flag drives a structured `MissingZaaidError` when called without a `zaaid`. Don't split into separate namespaces.
3. **One refresh token = one OAuth identity = one Site24x7 zone.** The zone is part of `TenantContext`. Multi-zone deployments register one MCP entry per zone.
4. **Credentials never enter the sandbox.** They live on the host and are looked up from `TenantContext` when the host-side `__site24x7Call` runs. The sandbox sees an opaque `site24x7.*` prelude, never a client secret / refresh token / access token.
5. **`zaaid` is first-class.** It rides on `TenantContext`, is auto-injected by the HTTP client whenever set, and has dedicated sandbox helpers (`withCustomer`, `listCustomers`, `zaaid` getter). Don't bypass `TenantContext` to add it manually somewhere.
6. **Per-request multi-tenant scoping.** In the HTTP transport, `TenantContext` is rebuilt from `X-Site24x7-*` headers on every request and is short-lived (`AsyncLocalStorage`). Single-user fallback uses env vars.
7. **Sandbox is QuickJS WASM (Node) or a Cloudflare Worker isolate (`cf-worker/`).** No `eval`, no `vm`, no `Function`.
8. **The bundled spec is the source of truth at runtime.** Site24x7 publishes no OpenAPI document; `scripts/update-spec.ts` re-scrapes the docs and re-emits `src/spec/site24x7-fallback.json`. The loader never hits the network at runtime.
9. **Scope hints come from the doc's `oauthscope` line.** The scraper preserves them on each `IndexedOperation` and the HTTP client surfaces them through `Site24x7HttpError.requiredScopes`. Don't derive scopes from path heuristics; if you change the loader, preserve this field.

---

## 3. Daily dev loop

```bash
npm ci                            # one-time
npm run typecheck                 # tsc --noEmit
npm test                          # vitest run
npm run lint                      # eslint
npm run format:check              # prettier
npm run build                     # tsc → dist/ (also copies the bundled spec)
```

Before opening any PR, lint, typecheck, tests and build must be green. Run
format:check separately and report existing drift; CI keeps formatting advisory.

For end-to-end smoke against a live Site24x7 tenant (read-only):

```bash
# Fill in .env with your Self Client credentials + zone (see README.md).
npm run live-test                 # /api/current_status + /api/monitors + MSP probe if accountType=msp
```

`scripts/live-test.ts` is the smallest viable end-to-end exercise of the OAuth refresh path + HTTP client + (if MSP) a `withCustomer` round-trip.

---

## 4. Where things live (when you're hunting)

| Concern | File |
|---|---|
| Bundled spec snapshot | `src/spec/site24x7-fallback.json` |
| Docs scraper that emits the bundled spec | `scripts/update-spec.ts` |
| Spec loader (bundle-only) | `src/spec/loader.ts` |
| Search index shape (`search` tool payload) | `src/spec/index-builder.ts` |
| Tenant resolution from env / headers (includes zaaid) | `src/tenant/context.ts` |
| Zoho OAuth 2.0 refresh-token cache + zone routing | `src/auth/zoho-oauth.ts` |
| HTTP client (Zoho-oauthtoken, version=2.0, zaaid cookie, scope-aware errors) | `src/client/http.ts` |
| Sandbox prelude (the JS injected on every run, includes `withCustomer`) | `src/sandbox/dispatch.ts` |
| Sandbox resource limits | `src/sandbox/limits.ts` |
| `search` tool sandbox (sync) | `src/sandbox/search-executor.ts` |
| `execute` tool sandbox (async) | `src/sandbox/execute-executor.ts` |
| Tool registration & response framing | `src/server/server.ts` |
| stdio + Streamable HTTP transports | `src/server/transport.ts` |
| Per-request header storage | `src/server/request-context.ts` |
| Cloudflare Workers entrypoint | `cf-worker/index.ts` |
| Live read-only smoke | `scripts/live-test.ts` |
| Refresh bundled snapshot | `scripts/update-spec.ts` |

---

## 5. Multi-tenant header contract

| Header | Purpose |
|---|---|
| `X-Site24x7-Client-Id` | Zoho Self Client client ID |
| `X-Site24x7-Client-Secret` | Zoho Self Client client secret |
| `X-Site24x7-Refresh-Token` | Zoho refresh token (permanent) |
| `X-Site24x7-Zone` | Site24x7 zone: `com` / `eu` / `in` / `com.au` / `cn` / `jp` / `ca` / `uk` / `ae` / `sa` |
| `X-Site24x7-Zaaid` | (Optional) MSP customer / Business Unit `zaaid` |
| `X-Site24x7-Account-Type` | (Optional) `standard` / `msp` / `bu` — used for clearer error messages |

Equivalent env vars for stdio / single-user mode: `SITE24X7_CLIENT_ID`, `SITE24X7_CLIENT_SECRET`, `SITE24X7_REFRESH_TOKEN`, `SITE24X7_ZONE`, `SITE24X7_ZAAID`, `SITE24X7_ACCOUNT_TYPE`.

Missing credentials produce a `MissingCredentialsError` **inside the sandbox**, surfaced to the model with an actionable message — never a 5xx.

Calling an MSP/BU-only endpoint without a `zaaid` produces a `MissingZaaidError` with the operation context, including a hint to call `site24x7.listCustomers()` first.

The eleven recognised zones are tracked in `KNOWN_SITE24X7_ZONES` in `src/config.ts`. Each zone maps to two host families: `accounts.zoho.<dc>` (OAuth) and `www.site24x7.<dc>` / `app.site24x7.<dc>` (API). Don't hardcode either set elsewhere.

---

## 6. Gotchas we already paid for — read before re-debugging

### 6.1 Authorization scheme is `Zoho-oauthtoken`, not `Bearer`

Site24x7 / Zoho authenticate with `Authorization: Zoho-oauthtoken <access-token>`. Don't "fix" this to `Bearer` — Zoho's gateway will return a generic 401 with no scope hint and you'll waste time wondering why the spec says one thing and the wire another.

### 6.2 The Accept header carries the API version

Every request must send `Accept: application/json; version=2.0` (or a per-endpoint override; the docs note exceptions). Without it you get older response shapes that don't match the spec.

### 6.3 `zaaid` is a Cookie, not a header

Site24x7 scopes MSP / BU context via `Cookie: zaaid=<id>`. Don't try `X-Site24x7-Zaaid` on the wire — that's our *server's* per-request header, the *upstream* API only reads the cookie.

### 6.4 Japan zone uses `app.site24x7.jp`, not `www.site24x7.jp`

Most zones use `www.site24x7.<dc>` as the API root. Japan uses `app.site24x7.jp`. UK, AE both also use `app.` prefixes per the docs. The `KNOWN_SITE24X7_ZONES` table is authoritative.

### 6.5 Refresh tokens are permanent — store like a password

A leaked refresh token is permanent access. The sandbox never sees credentials; they live only on the host. The access-token cache is in-memory only.

### 6.6 Bump `CACHE_SCHEMA_VERSION` whenever you change `buildOperationIndex`

The on-disk cache stores the *output* of `buildOperationIndex`. Anyone with a warm cache sees the old shape until the cache is invalidated. `CACHE_SCHEMA_VERSION` in `src/spec/loader.ts` is the version stamp; a mismatch causes the loader to ignore the cache and re-read the bundled spec.

### 6.7 Top-level `await` and top-level `return` are not allowed in the sandbox

QuickJS treats the executed code as module-body, not function-body. All `site24x7.*` calls **look synchronous** from the sandbox (host yields via Asyncify), so the SKILL recipe is a straight-line snippet whose **last expression** is the return value. Do not encourage `async`/`await` in user snippets — it tangles QuickJS' promise plumbing with Node's microtask queue and we hit GC asserts under sequential awaits.

### 6.8 `site24x7.withCustomer` is synchronous in the sandbox

`withCustomer(zaaid, fn)` is sync (it returns the closure's return value directly, not a Promise). The closure is invoked synchronously, and on `return`/`throw` the previous `zaaid` is restored — so callers don't need to think about cleanup. Don't reintroduce the old Promise-returning shape; it interacts badly with QuickJS' GC under sequential calls.

---

## 7. Code style

- TypeScript, strict, ESM. Node 22.19+ (CI: 22 and 24).
- **Avoid narrative comments.** Comments explain the *why* of non-obvious decisions only — never restate what the code does.
- Prefer plain functions over classes when there's no state.
- Errors in the host that need to reach the sandbox go through `formatHttpError` / the executor's error path — preserve the `[site24x7.<error-class>]` prefix, the model relies on it.

---

## 8. Tests live next to the system

- `src/__tests__/tenant.test.ts` — env / header builders + zaaid handling + missing-cred paths.
- `src/__tests__/zoho-oauth.test.ts` — per-tenant cache, refresh path, zone routing.
- `src/__tests__/spec-loader.test.ts` — bundle load, cache-schema-version invalidation.
- `src/__tests__/spec-index.test.ts` — operation lookup + tag normalisation + mspOnly/buOnly flags.
- `src/__tests__/http-client.test.ts` — argument substitution + factory wiring.
- `src/__tests__/http-client-live.test.ts` — header shape (`Authorization: Zoho-oauthtoken …`, `Accept: application/json; version=2.0`, `Cookie: zaaid=…`), 401-refresh-and-retry, 429 retry, scope-aware 403 formatting, MissingZaaid for mspOnly ops.
- `src/__tests__/dispatch.test.ts` — `buildSite24x7Prelude` emits expected accessors; `withCustomer` semantics.
- `src/__tests__/sandbox.test.ts` — `SearchExecutor` and `ExecuteExecutor` end-to-end with a mocked HTTP fetch.
- `src/__tests__/integration/*.test.ts` — full MCP-client → server → mock-Site24x7 round-trip on both `InMemoryTransport` and Streamable HTTP transports, including a `withCustomer` round-trip.

When fixing a bug, write a Vitest case before the fix.

---

## 9. Commit and PR conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- One logical change per commit. Keep `src/spec/cache/*` and `out/` out of commits.
- Don't bump deps in unrelated commits.

---

## 10. Roadmap (intentional, not yet implemented)

- **Mutation verification.** A self-reverting `PUT` (or `POST` / `DELETE` round-trip) against a non-production lab tenant.
- **Multi-zone verification.** Currently we plan to drive only the zone the test credentials live in; the other ten zones in `KNOWN_SITE24X7_ZONES` should be smoke-tested.
- **Broader client validation.** Confirmed working configs for Cursor, Claude Desktop, Continue, Cline, Aider, Zed, the MCP Inspector UI, and HTTP/SSE transports.
- **Cloudflare Workers full transport.** `wrangler dev` parity smoke is goal; the 501 transport-adapter scaffold mirrors `make-mcp` / `unraid-mcp`.
- **Per-tenant rate limiting** keyed on hashed credentials.
- **NPM publish** — reserved for `1.0.0`. The package is `"private": true` until then.

If you pick one up, write a short design note in `docs/` first.
