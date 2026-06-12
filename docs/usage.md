# Usage

This document covers installation, configuration, and wiring this MCP server into every supported MCP client. For the JS surface the LLM sees inside the sandbox, read [`../SKILL.md`](../SKILL.md).

## Install

```bash
git clone https://github.com/jmpijll/site24x7-code-mode-mcp.git
cd site24x7-code-mode-mcp
npm install --legacy-peer-deps
npm run build
```

The build emits `dist/index.js` and copies `src/spec/site24x7-fallback.json` next to it. No network access is needed at runtime.

## Configure

```bash
cp .env.example .env
$EDITOR .env
```

Mint your Zoho Self Client refresh token by following the step-by-step in [`../README.md`](../README.md) → "Authentication". The full env-var surface lives in [`../.env.example`](../.env.example); the important ones:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SITE24X7_CLIENT_ID` | yes (stdio) | — | Zoho Self Client client ID |
| `SITE24X7_CLIENT_SECRET` | yes (stdio) | — | Zoho Self Client client secret |
| `SITE24X7_REFRESH_TOKEN` | yes (stdio) | — | Permanent Zoho refresh token |
| `SITE24X7_ZONE` | no | `com` | One of `com`, `eu`, `in`, `com.au`, `cn`, `jp`, `ca`, `uk`, `ae`, `sa` |
| `SITE24X7_ZAAID` | no | — | Default MSP customer / BU `zaaid` |
| `SITE24X7_ACCOUNT_TYPE` | no | `standard` | `standard` / `msp` / `bu` |
| `MCP_TRANSPORT` | no | `stdio` | Set to `http` for multi-tenant. |
| `MCP_HTTP_PORT` | no | `8000` | Listen port when `MCP_TRANSPORT=http`. |
| `MCP_HTTP_ALLOWED_ORIGINS` | no | `http://localhost,http://127.0.0.1` | Comma-separated CORS allowlist. |
| `SITE24X7_MAX_CALLS_PER_EXECUTE` | no | `50` | Per-`execute` call budget. |
| `SITE24X7_EXECUTE_TIMEOUT_MS` | no | `30000` | Per-`execute` wall-clock deadline. |
| `SITE24X7_CACHE_DIR` | no | `~/.cache/site24x7-code-mode-mcp/` | On-disk spec-metadata cache. |

In multi-tenant HTTP mode, omit the credential env vars and pass them as `X-Site24x7-*` HTTP headers per request — see [`multi-tenant.md`](multi-tenant.md).

## Run

### Single-user (stdio)

```bash
npm start
# or
node dist/index.js
```

Point your MCP client at `node /path/to/site24x7-code-mode-mcp/dist/index.js` over stdio.

### Multi-tenant (HTTP)

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=8000 npm start
```

Then `POST /mcp` with credentials in headers:

```http
POST /mcp HTTP/1.1
Content-Type: application/json
X-Site24x7-Client-Id: 1000.xxx
X-Site24x7-Client-Secret: xxx
X-Site24x7-Refresh-Token: 1000.yyy
X-Site24x7-Zone: com
X-Site24x7-Zaaid: 658123456            # optional
X-Site24x7-Account-Type: msp           # optional

{ "jsonrpc": "2.0", "method": "tools/list", "id": 1 }
```

See [`multi-tenant.md`](multi-tenant.md) for the full contract.

## The two tools

| Tool | Argument | Purpose |
|---|---|---|
| `site24x7_search` | `{ code: string }` | Read-only sandbox over the bundled spec index. Returns whatever the script's final expression evaluates to. |
| `site24x7_execute` | `{ code: string }` | Live sandbox with the `site24x7.*` surface bound. The script runs as an async IIFE; its result is the tool output. |

The JavaScript surface, recipes, and gotchas are documented in [`../SKILL.md`](../SKILL.md). Quick reference:

```js
site24x7.request({ method, path, query?, body?, version?, zaaid? })
site24x7.<tag>.<op>(args)
site24x7.callOperation('opId', args)
site24x7.listCustomers()
site24x7.withCustomer(zaaid, async fn)
site24x7.zaaid
```

## Wiring into MCP clients

The configuration snippets below cover the common stdio and HTTP cases. Replace `/abs/path/to/site24x7-code-mode-mcp` with the path on your machine.

### Cursor

`.cursor/mcp.json` (project-scoped) or `~/.cursor/mcp.json` (global):

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

Use the workspace-relative `"dist/index.js"` path (not `${workspaceFolder}/dist/index.js`) — see [`cursor-skill.md`](cursor-skill.md) §2 for the rationale.

Remote / shared HTTP deployment:

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

Full Cursor specifics in [`cursor-skill.md`](cursor-skill.md).

### Claude Code

`~/.claude/claude_desktop_config.json` (the same file Claude Code and Claude Desktop read):

```json
{
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["/abs/path/to/site24x7-code-mode-mcp/dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com"
      }
    }
  }
}
```

After editing the file, restart Claude Code (`claude /mcp restart`) or Claude Desktop entirely.

### Claude Desktop

Same config file as Claude Code, same shape. Restart Claude Desktop from scratch after editing — it does not hot-reload MCP config.

### opencode

`opencode.json` (project-scoped, wins over global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "site24x7": {
      "type": "local",
      "command": ["node", "dist/index.js"],
      "environment": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com",
        "SITE24X7_ACCOUNT_TYPE": "msp"
      },
      "enabled": true
    }
  },
  "permission": {
    "site24x7_*": "allow"
  }
}
```

opencode auto-prefixes every tool with the server key, so the two tools become `site24x7_site24x7_search` and `site24x7_site24x7_execute`. The example permission `"site24x7_*": "allow"` covers both. Full opencode specifics in [`opencode-skill.md`](opencode-skill.md).

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.site24x7]
command = "node"
args = ["/abs/path/to/site24x7-code-mode-mcp/dist/index.js"]
env = { SITE24X7_CLIENT_ID = "1000.xxx", SITE24X7_CLIENT_SECRET = "xxx", SITE24X7_REFRESH_TOKEN = "1000.yyy", SITE24X7_ZONE = "com" }
```

For HTTP transport, Codex supports the same `[mcp_servers.<name>]` shape with `url = "https://…/mcp"` and `headers = { … }`.

### VS Code Copilot

Copilot Chat reads MCP entries from `~/.config/github-copilot/intellij/mcp.json` (or the equivalent per-IDE path). The shape is the same as Cursor's:

```json
{
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["/abs/path/to/site24x7-code-mode-mcp/dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com"
      }
    }
  }
}
```

Restart VS Code after editing. Copilot's MCP UI lives under Settings → Copilot → MCP servers.

### MCP Inspector CLI

For protocol-level smoke without involving any LLM:

```bash
# stdio
npx @modelcontextprotocol/inspector node dist/index.js

# Streamable HTTP
MCP_TRANSPORT=http npm start &
npx @modelcontextprotocol/inspector --transport http http://localhost:8000/mcp
```

The Inspector UI lets you list tools, call `site24x7_search` and `site24x7_execute` directly, and watch the wire frames.

## Operational scripts

```bash
npm run update-spec        # re-scrape Site24x7 docs → src/spec/site24x7-fallback.json
npm run live-test          # read-only sweep: /api/current_status + /api/monitors (+ MSP probe if account_type=msp)
npm test                   # vitest run
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm run format:check       # prettier
```

`live-test` reads credentials from the environment (`SITE24X7_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` / `ZONE`, plus optional `SITE24X7_ZAAID` / `SITE24X7_ACCOUNT_TYPE`). If `SITE24X7_ACCOUNT_TYPE=msp`, it also exercises a `withCustomer` round-trip against the first customer returned by `listCustomers`.

## Common gotchas

- **No top-level `await`; the last expression is the return value.** QuickJS treats the script as module body. `site24x7.*` calls look synchronous to the sandbox (host yields via Asyncify), so write straight-line code:

  ```js
  site24x7.monitors.list();
  ```

- **`site24x7.withCustomer(...)` is synchronous.** It invokes the closure inline, returns the closure's return value, and restores the previous `zaaid` on return / throw. Don't reach for `await` — there's no Promise.
- **One zone per refresh token.** A US-zone refresh token does not work against `accounts.zoho.eu`. Register one MCP entry per zone.
- **Don't invent operationIds.** Always confirm with `site24x7_search` first — the bundled spec is the source of truth at runtime, and operationIds are derived from the scraped docs (not from a Site24x7-published list).
- **Refresh tokens are permanent.** Treat like a password; see [`security.md`](security.md).
- **`mspOnly` / `buOnly` operations need a `zaaid`.** Wrap them in `site24x7.withCustomer(zaaid, ...)` or set `SITE24X7_ZAAID` / pass `X-Site24x7-Zaaid`. See [`multi-tenant.md`](multi-tenant.md).

See also: [`architecture.md`](architecture.md), [`multi-tenant.md`](multi-tenant.md), [`security.md`](security.md), [`cursor-skill.md`](cursor-skill.md), [`opencode-skill.md`](opencode-skill.md), [`../SKILL.md`](../SKILL.md).
