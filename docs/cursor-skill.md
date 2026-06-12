# Coupling site24x7-code-mode-mcp with Cursor

This guide is for users who want a Cursor IDE or `cursor-agent` CLI session to drive this MCP server. For a vendor-neutral guide on the two-tool surface and the `site24x7.*` JavaScript surface, read [`../SKILL.md`](../SKILL.md) first.

> **Verification status.** None of the agent-platform integrations described below have been live-verified by the maintainer for this server. The protocol-level smoke (`cursor-agent mcp list-tools site24x7` printing both `site24x7_search` and `site24x7_execute`) and the Vitest integration suite are green; an end-to-end LLM-mediated session through Cursor against a real Site24x7 tenant has not been recorded yet. The Cursor mechanics described here are sourced from the Cursor docs and from the sibling `unraid-code-mode-mcp` / `unifi-code-mode-mcp` repos where the equivalent flow *has* been verified live. If you try this with a real Zoho Self Client and a Site24x7 portal, please file a [verification report](../.github/ISSUE_TEMPLATE/verification_report.yml).

## 1. Where MCP servers are configured in Cursor

Cursor reads MCP server entries from a JSON file called `mcp.json`:

| Scope | Path | Wins on name conflict |
|---|---|---|
| **Project** | `<repo>/.cursor/mcp.json` | yes |
| **Global (macOS / Linux)** | `~/.cursor/mcp.json` | no |

The same file is read by both Cursor IDE and the `cursor-agent` CLI. A project-scoped entry with the same name as a global one wins.

> Source: <https://cursor.com/docs/mcp.md>

## 2. Recommended: stdio entry (single tenant, IDE)

Most users want one Cursor profile against one Zoho identity. Drop a project-scoped `.cursor/mcp.json` next to the cloned repo:

```json
{
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "SITE24X7_CLIENT_ID": "${env:SITE24X7_CLIENT_ID}",
        "SITE24X7_CLIENT_SECRET": "${env:SITE24X7_CLIENT_SECRET}",
        "SITE24X7_REFRESH_TOKEN": "${env:SITE24X7_REFRESH_TOKEN}",
        "SITE24X7_ZONE": "${env:SITE24X7_ZONE}",
        "SITE24X7_ACCOUNT_TYPE": "${env:SITE24X7_ACCOUNT_TYPE}",
        "SITE24X7_ZAAID": "${env:SITE24X7_ZAAID}"
      }
    }
  }
}
```

> **Path note.** Use the workspace-relative `dist/index.js` rather than `${workspaceFolder}/dist/index.js`. `cursor-agent mcp list-tools <name>` does **not** expand `${workspaceFolder}`, which causes it to spawn `node /dist/index.js` and fail with `Connection closed`. Relative paths work in both the IDE and all `cursor-agent` subcommands. Verified against `cursor-agent v2026.05.05` in the sibling unifi / unraid repos.

Cursor resolves `${env:NAME}` at config-load time against the **shell environment that launched Cursor**. On macOS that means setting them in `~/.zshenv` (or letting them flow from `1password run` / a similar secrets shim) — env vars set only in `.zshrc` may not be seen by GUI Cursor.

> "MCP servers use environment variables for authentication. Pass API keys and tokens through the config." — <https://cursor.com/docs/mcp.md>

> "`envFile` is only available for STDIO servers. Remote servers (HTTP/SSE) do not support `envFile`. For remote servers, use config interpolation with environment variables set in your shell profile or system environment instead." — <https://cursor.com/docs/mcp.md>

## 3. Streamable HTTP entry (remote / shared deployment)

If you run the server as a hosted service, point Cursor at the HTTP endpoint and pass the Zoho credentials per-tenant via headers:

```json
{
  "mcpServers": {
    "site24x7": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "X-Site24x7-Client-Id": "${env:SITE24X7_CLIENT_ID}",
        "X-Site24x7-Client-Secret": "${env:SITE24X7_CLIENT_SECRET}",
        "X-Site24x7-Refresh-Token": "${env:SITE24X7_REFRESH_TOKEN}",
        "X-Site24x7-Zone": "${env:SITE24X7_ZONE}",
        "X-Site24x7-Account-Type": "msp"
      }
    }
  }
}
```

`${env:VAR}` interpolation is supported in `url` and `headers`. The full header contract lives in [`multi-tenant.md`](multi-tenant.md).

## 4. Multi-tenant: register one entry per Zoho identity *or* per zone

Cursor's MCP configuration schema only documents a static `headers` map per remote server entry; values are resolved at config load via `${env:…}` interpolation. The docs describe **no mechanism for per-request or per-tenant header injection at the protocol layer**.

That has two consequences for Site24x7:

1. **One refresh token = one OAuth identity = one Site24x7 zone.** A refresh token minted against the EU console will not work against `accounts.zoho.com`. If you operate across more than one zone, register one MCP entry per zone.
2. **The MSP `zaaid` axis is not a header-per-call axis from Cursor's perspective.** Inside the sandbox, `site24x7.withCustomer(zaaid, fn)` is still how the LLM scopes individual calls. The `X-Site24x7-Zaaid` header in `mcp.json` only sets a **default** customer scope for the whole entry.

For an MSP operator who routinely jumps between two customers, register them as separate Cursor MCP entries so the agent can pick by name:

```json
{
  "mcpServers": {
    "site24x7-acme": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "X-Site24x7-Client-Id": "${env:S24X7_CLIENT_ID}",
        "X-Site24x7-Client-Secret": "${env:S24X7_CLIENT_SECRET}",
        "X-Site24x7-Refresh-Token": "${env:S24X7_REFRESH_TOKEN}",
        "X-Site24x7-Zone": "com",
        "X-Site24x7-Account-Type": "msp",
        "X-Site24x7-Zaaid": "658123456"
      }
    },
    "site24x7-beta": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "X-Site24x7-Client-Id": "${env:S24X7_CLIENT_ID}",
        "X-Site24x7-Client-Secret": "${env:S24X7_CLIENT_SECRET}",
        "X-Site24x7-Refresh-Token": "${env:S24X7_REFRESH_TOKEN}",
        "X-Site24x7-Zone": "com",
        "X-Site24x7-Account-Type": "msp",
        "X-Site24x7-Zaaid": "658987654"
      }
    }
  }
}
```

Both entries hit the same MCP backend with the same refresh token — only the default `zaaid` differs. The agent picks by name (`site24x7-acme` vs `site24x7-beta`).

For ad-hoc customer switches from a single entry, set `X-Site24x7-Account-Type: msp` and let the LLM call `site24x7.listCustomers()` + `site24x7.withCustomer(...)` inside the sandbox — that's the cleaner path and the one the SKILL nudges the model toward.

## 5. Headless / CI invocation with cursor-agent

Run the agent non-interactively with auto-approval of MCP tool calls and JSON output suitable for parsing:

```bash
cursor-agent \
  --workspace "$PWD" \
  --print \
  --output-format json \
  --approve-mcps \
  --force \
  "Use site24x7 to list every monitor that is currently DOWN, including its display name, monitor type, and the timestamp of the last failed check. Return a markdown table."
```

There is **no `--mcp-config` flag** — the agent reads `.cursor/mcp.json` in the workspace it was launched against. To use a different config, either swap files or change the workspace.

> Sources: <https://cursor.com/docs/cli/headless.md>, <https://cursor.com/docs/cli/reference/parameters.md>

## 6. Coupling the agent with the SKILL

Cursor auto-discovers `SKILL.md` files in:

- `~/.cursor/skills/<name>/SKILL.md` (personal)
- `<repo>/.cursor/skills/<name>/SKILL.md` (project)

This repo's [`../SKILL.md`](../SKILL.md) sits at the **repo root** so it ships with the source. To make the agent pick it up automatically when working in another project, copy or symlink it into a skills directory:

```bash
mkdir -p ~/.cursor/skills/site24x7-code-mode-mcp
ln -s "$PWD/SKILL.md" ~/.cursor/skills/site24x7-code-mode-mcp/SKILL.md
```

The skill's frontmatter omits `disable-model-invocation`, so the agent reaches for it whenever it sees Site24x7-shaped queries.

For more deliberate wiring — e.g. you want a dedicated Site24x7-expert persona — drop a project rule that points at the SKILL and at the expert-agent system prompt this repo ships:

```text
<repo>/.cursor/rules/site24x7-expert.mdc
```

```markdown
---
description: Site24x7 expert — use site24x7_search + site24x7_execute MCP tools for any Site24x7 / Zoho monitoring question.
globs:
alwaysApply: false
---

You are a Site24x7 expert. Whenever the user asks about Site24x7 monitors,
status pages, alerts, MSP customers, or Business Units:

1. Call `site24x7_search` first with a phrase that matches the user's intent
   ("create http monitor", "list msp customers", "thresholds for ping monitor",
   etc.). Inspect the returned operations' `requiredScopes` and
   `mspOnly` / `buOnly` flags.

2. Write a short straight-line snippet for `site24x7_execute`. All
   `site24x7.*` calls look synchronous; the last expression is the
   return value:

   ```js
   var result = site24x7.<tag>.<op>(args);
   result;
   ```

3. For MSP / BU users, scope every customer-specific call inside
   `site24x7.withCustomer(zaaid, function (s) { ... })`. Enumerate
   with `site24x7.listCustomers()`.

4. Never invent operationIds. Never paste a refresh token, client secret,
   or `Authorization` header into the sandbox — they are not visible there
   and any attempt to "fix" auth from inside is a bug, not a workaround.

5. If you get `[site24x7.MissingZaaidError]`, the operation is `mspOnly` or
   `buOnly` — wrap in `withCustomer`. If you get a scope-annotated `HTTP 403`,
   tell the user which scope to re-mint with.

See `~/path/to/site24x7-code-mode-mcp/SKILL.md` for the full surface and
`docs/multi-tenant.md` for MSP/BU recipes.
```

The dedicated `examples/site24x7-expert-agent/` directory in this repo holds a longer system prompt you can drop into a Cursor agent or any other platform that supports a custom persona.

## 7. End-to-end smoke test

A single command to verify the wiring once the env vars are set and `npm run build` has populated `dist/`:

```bash
cursor-agent --print --output-format json --approve-mcps --force \
  "Use site24x7 to call site24x7_search with code='index.operations.length' and report the number. Then call site24x7_execute with code='site24x7.request({ method: \"GET\", path: \"/api/current_status\" });' and return the count of monitors with status DOWN." \
  | tee out/cursor-smoke.json
```

If you only need to verify the protocol-level behaviour (not the IDE client), the project's Vitest integration suite does exactly that without depending on the CLI:

```bash
npm test -- src/__tests__/integration
```

It spins up the real `createMcpServer` factory against an in-process Site24x7 mock and exercises both the in-memory MCP transport (stdio-equivalent) and the Streamable HTTP transport, including a `withCustomer` round-trip.

For a credential-free protocol smoke that doesn't even need a Site24x7 portal, `npm run build` then `cursor-agent mcp list-tools site24x7` should print both `site24x7_search` and `site24x7_execute` — the bundled scraped spec boots without any wire access.

If the smoke fails, check in this order:

1. Is the server actually registered? Run `cursor-agent --list-mcps` (or the IDE's *MCP* settings panel) and confirm `site24x7` appears.
2. Are credentials reaching the server? In stdio mode, run `node dist/index.js` directly and watch stderr. In HTTP mode, hit `GET /health`.
3. Is the refresh token zone-correct? A `com` refresh token will fail with `INVALID_TOKEN` against `accounts.zoho.eu`. See [`multi-tenant.md`](multi-tenant.md) and the zone table in [`../README.md`](../README.md#data-centers).
4. For MSP/BU users hitting `[site24x7.MissingZaaidError]`, confirm the operation is one you meant to call against a customer (not the portal root), and that the model wrapped it in `withCustomer`.

## 8. Known limitations specific to Cursor

- **No per-request headers.** Confirmed via the docs (see §4 above). Workaround: one MCP entry per `(zone, identity, default-zaaid)` combination, or rely on `withCustomer` from inside the sandbox.
- **`envFile` doesn't apply to remote servers.** All credentials for an HTTP entry must come from `${env:…}` or be hard-coded in `headers`.
- **Cursor IDE caches MCP server connections.** After editing `mcp.json`, reload the window (`Cmd+Shift+P → Developer: Reload Window`) or new headers / env values won't take effect.
- **`cursor-agent --force` bypasses the per-tool approval prompt.** Use it in CI; avoid it in interactive sessions where you want a human approval gate on mutating Site24x7 calls (monitor delete, threshold-profile mutate, user-management writes, etc.).
- **`${workspaceFolder}` is not always interpolated.** `cursor-agent mcp list-tools <name>` specifically does not expand it (server fails to spawn with `Connection closed`). Use a workspace-relative path like `"args": ["dist/index.js"]` — it works for both the IDE and the CLI subcommands.
- **`cursor-agent` does not auto-inject custom MCPs as model tools.** Across both `--print` (headless) and interactive (TUI) sessions, with `cursor-agent mcp list` reporting the server as `ready` and `--approve-mcps --force` set, custom MCP servers configured in `.cursor/mcp.json` are **not** added to the model's tool list. The model has access only to Cursor's built-ins (`codebase_search`, `run_terminal_cmd`, `grep`, `read_file`, etc.). There is no `mcp__<server>__<tool>` entry exposed to the model.

  Sufficiently capable models (Sonnet 4.6, Codex 5.3) work around this on their own: they read `.cursor/mcp.json` from the workspace, find the server's command, and drive it over stdio by writing a raw JSON-RPC message into `node dist/index.js` via `run_terminal_cmd`. Verified end-to-end in the sibling unifi-code-mode-mcp repo against `cursor-agent v2026.05.05`. The same workaround *should* work here but is **not yet verified by us** — please file a verification report if you confirm or refute it.

  **Reliable smokes** (weakest → strongest evidence):

  1. **Protocol-level (no LLM, no credentials):** `cursor-agent mcp list-tools site24x7` prints `site24x7_search` + `site24x7_execute`. The bundled spec boots without any Zoho token.
  2. **Functional (no LLM):** `npm test -- src/__tests__/integration` — same MCP wire protocol as Cursor, in-memory + Streamable HTTP transports.
  3. **End-to-end LLM-mediated:** drive `cursor-agent --print` with a prompt that asks for a real Site24x7 call (e.g. `/api/current_status`) and confirm the model returns the live value. **Not yet recorded for this server** — testers wanted.

  **Permissions tip** (interactive `cursor-agent` sessions): if the global `~/.cursor/cli-config.json` uses `"approvalMode": "allowlist"`, add a project-scoped `.cursor/cli.json` to pre-allow this server's tools without prompting:

  ```json
  {
    "permissions": {
      "allow": [
        "Mcp(site24x7:site24x7_search)",
        "Mcp(site24x7:site24x7_execute)"
      ]
    }
  }
  ```

## 9. Sample chat prompts

Read-only sweep (single-tenant):

```text
Use the site24x7 MCP to give me the 5 monitors with the worst availability
over the last 24 hours. Use site24x7_search to find the right report
operation first, then site24x7_execute. Return a markdown table.
```

MSP fan-out:

```text
List every customer under my MSP portal and tell me how many monitors each
has DOWN right now. Use site24x7.listCustomers() to enumerate, then
site24x7.withCustomer for each. Watch the per-execute call budget
(default 50) — paginate across multiple site24x7_execute invocations if
needed.
```

Targeted MSP read:

```text
For the MSP customer named "Acme Corp", give me every HTTP(S) monitor and
its current status. Use site24x7.listCustomers() to find Acme's zaaid,
then wrap the call in site24x7.withCustomer.
```

Scope diagnosis:

```text
Try to list users via site24x7.callOperation('listUsers', {}) and tell me
what scope my refresh token would need if I get a 403. Don't suggest a
fix — just report the scope name from the error.
```

## 10. Reference

| Item | URL |
|---|---|
| Cursor MCP configuration | <https://cursor.com/docs/mcp.md> |
| `cursor-agent` headless mode | <https://cursor.com/docs/cli/headless.md> |
| `cursor-agent` parameters | <https://cursor.com/docs/cli/reference/parameters.md> |
| This server's two-tool surface | [`../SKILL.md`](../SKILL.md) |
| Server installation | [`./usage.md`](./usage.md) |
| Multi-tenant transport details | [`./multi-tenant.md`](./multi-tenant.md) |
| MSP / BU recipes | [`./multi-tenant.md`](./multi-tenant.md#msp--bu-ergonomics-in-the-sandbox) |
| Site24x7-expert persona | [`../examples/site24x7-expert-agent/`](../examples/site24x7-expert-agent/) |
