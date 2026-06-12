# SKILL.md — Operating manual for site24x7-code-mode-mcp

> This file is the **operating manual for the MCP client** (the model
> writing JS into `site24x7_execute`). It is **not** for contributors
> editing the server — that's [`AGENTS.md`](AGENTS.md).
>
> Wiring this MCP into a long-lived agent? See
> [`examples/site24x7-expert-agent/`](examples/site24x7-expert-agent/).

## What you get

Two MCP tools, both backed by a sandboxed JS runtime with a flat
`site24x7.*` API.

| Tool | When to use it |
|---|---|
| `site24x7_search` | Find operations by name, tag, scope, or path before writing real code. Returns the indexed spec subset. |
| `site24x7_execute` | Run a snippet of JavaScript inside the sandbox; it can call `site24x7.*` freely and return any JSON-serialisable value. |

Both tools accept exactly one argument: a `code` string.

## The sandbox

- QuickJS WASM (or a Cloudflare Worker isolate in the cf-worker entrypoint).
- No `eval`, no `Function`, no `import`, no `require`, no `process`, no `fetch`.
- Only `site24x7.*` exists outside the standard JS surface.
- **All `site24x7.*` calls look synchronous from the sandbox.** No `async`,
  no `await`, no Promises. The host yields under the hood (QuickJS
  Asyncify) so you can write straight-line code. Top-level `await` is not
  allowed; the **last expression** of your snippet is the return value.

```js
var status = site24x7.request({ method: 'GET', path: '/api/current_status' });
status;
```

- Per-execute call budget (default 50) and 30 s wall-clock deadline.

## The surface

```js
// Raw escape hatch
site24x7.request({
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: '/api/monitors',
  query: { ... },         // optional
  body: { ... },          // optional, JSON
  version: '2.0',         // optional, default '2.0'
  zaaid: '...',           // optional, overrides ambient zaaid
})

// Typed accessor (one per spec operation), examples:
site24x7.monitors.list()
site24x7.monitors.get({ monitor_id: '...' })
site24x7.users.list()
site24x7.reports.summary({ ... })

// Flat lookup by operationId
site24x7.callOperation('listMonitors', { ... })

// MSP / Business Unit ergonomics — see "MSP recipes" below
site24x7.listCustomers()                          // returns [{ name, zaaid, ... }]
site24x7.withCustomer('658123456', function (s) { /* ... */ })
site24x7.zaaid                                    // active zaaid or undefined
```

## Standard recipe

1. Call `site24x7_search` first with a phrase like `"create http monitor"` or `"msp customer list"`.
2. Pick the operationId(s) you need and note their `requiredScopes` and `mspOnly` / `buOnly` flags.
3. Write a short synchronous snippet in `site24x7_execute` that uses the typed accessors. The last expression is the return value.

## MSP recipes

### Enumerate customers + fan out a single operation

```js
var customers = site24x7.listCustomers();
var results = [];
for (var i = 0; i < customers.length; i++) {
  var c = customers[i];
  var status = site24x7.withCustomer(c.zaaid, function (s) {
    return s.request({ method: 'GET', path: '/api/current_status' });
  });
  results.push({
    customer: c.name,
    zaaid: c.zaaid,
    down: (status && status.monitors_status && status.monitors_status.down) || 0,
  });
}
results;
```

### Act against a single named customer

```js
var customers = site24x7.listCustomers();
var target = customers.find(function (c) { return c.name === 'Acme Corp'; });
if (!target) throw new Error('customer not found');
site24x7.withCustomer(target.zaaid, function (s) {
  return s.monitors.list();
});
```

### What goes wrong (and how it surfaces)

| Symptom | Meaning | Fix |
|---|---|---|
| `[site24x7.MissingZaaidError] operation "listMspCustomers" requires a zaaid in scope (operation mspOnly=true). Hint: call site24x7.listCustomers() first.` | You're calling an MSP/BU-only endpoint without a `zaaid`. | Wrap in `site24x7.withCustomer(zaaid, ...)`. |
| `[site24x7.MissingCredentialsError] no Site24x7 OAuth credentials in scope` | Server is in multi-tenant HTTP mode but the request didn't carry `X-Site24x7-*` headers. | Configure the MCP client to send them. |
| `[site24x7.HttpError] HTTP 403 (operation requires scope `Site24x7.Admin.All` — your refresh token lacks it)` | Scope-aware 403. The doc-derived requirement on this op doesn't match your refresh token's grant. | Re-mint the refresh token with the right scope (see README). |
| `[site24x7.HttpError] HTTP 401` (after one retry) | Refresh token is invalid / revoked. | Re-do the Self Client → grant → refresh dance. |

## Limits

- Default 50 API calls per `site24x7_execute` invocation. Override via `SITE24X7_MAX_CALLS_PER_EXECUTE`.
- 30 s wall-clock deadline. Override via `SITE24X7_EXECUTE_TIMEOUT_MS`.
- Site24x7's own per-token rate limits apply on top (~10 req/s on most plans). 429s trigger one polite retry; persistent 429 is surfaced as an `HttpError`.
