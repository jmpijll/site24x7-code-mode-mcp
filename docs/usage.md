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


---

# Setup and verification reference

The following details were moved from the README during repository harmonization.
Historical verification records describe the maintainer's earlier runs; they are not
claims that live services or clients were retested in this change.

## Authentication

Site24x7 reuses Zoho's accounts service for OAuth 2.0. The only practical long-lived option for a local MCP is the **Self Client → refresh token** flow.

### Why this flow (and not the others)

| Flow | Why we don't use it |
|---|---|
| Web-server authorization-code | Needs a callback URL — impossible for a local MCP. |
| Access-token only | Expires every hour — terrible UX. |
| Legacy `portal_id` / authtoken | Deprecated by Zoho for new integrations. |
| **Self Client refresh-token** | **What we use.** One-time setup, permanent refresh token, automatic per-tenant access-token rotation. |

### One-time setup (5 minutes)

1. Open the Zoho API console for **your** data center:

    | Zone | Console URL |
    |---|---|
    | US (`com`) | <https://api-console.zoho.com> |
    | EU (`eu`) | <https://api-console.zoho.eu> |
    | India (`in`) | <https://api-console.zoho.in> |
    | Australia (`com.au`) | <https://api-console.zoho.com.au> |
    | China (`cn`) | <https://api-console.zoho.com.cn> |
    | Japan (`jp`) | <https://api-console.zoho.jp> |
    | Canada (`ca`) | <https://api-console.zohocloud.ca> |
    | UK (`uk`) | <https://api-console.zoho.uk> |
    | UAE (`ae`) | <https://api-console.zoho.ae> |
    | Saudi Arabia (`sa`) | <https://api-console.zoho.sa> |

2. Click **Add Client** → **Self Client** → **Create**. Note the **Client ID** and **Client Secret**.

3. Go to the **Generate Code** tab on the same Self Client and fill in:
    - **Scope:** the scopes you want available to the MCP, comma-separated. Pick from the table below. For a typical "full admin + MSP" deployment:

        ```text
        Site24x7.Admin.All,Site24x7.Account.All,Site24x7.Reports.All,Site24x7.Operations.All,Site24x7.Msp.All,Site24x7.Bu.All
        ```

    - **Description:** anything (`"site24x7 code-mode mcp"` works).
    - **Time Duration:** **10 Minutes** (the maximum; you only need a minute or two).
    - Click **Create**. Copy the displayed **code** (the grant token).

4. Exchange the grant token for a refresh token using `curl` (run **within 10 minutes** of step 3):

    ```bash
    curl -X POST 'https://accounts.zoho.com/oauth/v2/token' \
      -d "client_id=$CLIENT_ID" \
      -d "client_secret=$CLIENT_SECRET" \
      -d "code=$GRANT_CODE" \
      -d "grant_type=authorization_code"
    ```

    Replace `accounts.zoho.com` with the accounts host for your zone (`accounts.zoho.eu`, `accounts.zoho.in`, etc.). The response includes:

    ```json
    {
      "access_token": "1000.xxx",
      "refresh_token": "1000.yyy",
      "expires_in": 3600,
      "token_type": "Bearer"
    }
    ```

    Keep the **`refresh_token`** — it's permanent. The `access_token` is throwaway; the MCP server will mint fresh ones automatically.

5. Drop the values into `.env`:

    ```dotenv
    SITE24X7_CLIENT_ID=1000.xxx
    SITE24X7_CLIENT_SECRET=xxx
    SITE24X7_REFRESH_TOKEN=1000.yyy
    SITE24X7_ZONE=com
    ```

### Scopes reference

| Scope family | What it grants | Levels |
|---|---|---|
| `Site24x7.Account.*` | Users, license, account-wide data | `Read`, `Create`, `Update`, `Delete`, `All` |
| `Site24x7.Admin.*` | Monitors, profiles, third-party integrations | `Read`, `Create`, `Update`, `Delete`, `All` |
| `Site24x7.Reports.*` | Reports and monitor status | `Read`, `Create`, `Update`, `Delete`, `All` |
| `Site24x7.Operations.*` | IT Automation, maintenance, status pages | `Read`, `Create`, `Update`, `Delete`, `All` |
| `Site24x7.Msp.*` | MSP-level operations | `Read`, `Create`, `Update`, `Delete`, `All` |
| `Site24x7.Bu.*` | Business-Unit-level operations | `Read`, `Create`, `Update`, `Delete`, `All` |

Pick the narrowest set of scopes that covers your intended use. The MCP server tells the LLM, per operation, which scope it needs — so a scope-aware 403 always has actionable context.

### Revoking a refresh token

```bash
curl -X POST 'https://accounts.zoho.com/oauth/v2/token/revoke?token=YOUR_REFRESH_TOKEN'
```

Or via the Zoho web UI: <https://accounts.zoho.com/u/h#sessions/refreshtokens>.

---

## MSP and Business Units

If your Zoho identity is an MSP user (or a BU portal user), one Self Client / refresh token lets you operate against **any** customer / BU under your portal — but you must tell each API call which customer to act on via `Cookie: zaaid=<customer_zaaid>`. This server makes that ergonomic.

### Finding your customers' zaaid values

In the sandbox:

```js
site24x7.listCustomers();
```

This returns `[{ name, zaaid, ... }]` from `/api/short/msp/customers` (or `/api/short/bu/business_units` if `SITE24X7_ACCOUNT_TYPE=bu`).

### Running against a single customer

```js
site24x7.withCustomer('658123456', function (s) {
  return s.monitors.list();
});
```

`withCustomer` re-injects the cookie for every call inside the closure. Outside the closure, the active `zaaid` reverts to whatever was in scope when you entered.

### Fanning out

```js
var customers = site24x7.listCustomers();
var summary = [];
for (var i = 0; i < customers.length; i++) {
  var c = customers[i];
  var status = site24x7.withCustomer(c.zaaid, function (api) {
    return api.request({ method: 'GET', path: '/api/current_status' });
  });
  summary.push({
    name: c.name,
    zaaid: c.zaaid,
    down: (status && status.monitors_status && status.monitors_status.down) || 0,
  });
}
summary;
```

### Multi-tenant HTTP mode

When the server runs with `MCP_TRANSPORT=http`, each request can override the active customer via the `X-Site24x7-Zaaid` header. The full multi-tenant contract:

| Header | Required | Notes |
|---|---|---|
| `X-Site24x7-Client-Id` | yes | Zoho Self Client client ID |
| `X-Site24x7-Client-Secret` | yes | Zoho Self Client client secret |
| `X-Site24x7-Refresh-Token` | yes | Permanent refresh token |
| `X-Site24x7-Zone` | yes | One of `com`, `eu`, `in`, `com.au`, `cn`, `jp`, `ca`, `uk`, `ae`, `sa` |
| `X-Site24x7-Zaaid` | no | Default `zaaid` for this request; can still be overridden by `withCustomer` |
| `X-Site24x7-Account-Type` | no | `standard` / `msp` / `bu` — improves error messages |

See [`docs/multi-tenant.md`](../docs/multi-tenant.md) for the full architecture.

---

## Data centers

The server speaks to two hosts per zone — Zoho accounts (for OAuth) and Site24x7 (for API calls). Both are routed automatically from `SITE24X7_ZONE`.

| Zone (`SITE24X7_ZONE`) | Zoho accounts | Site24x7 API |
|---|---|---|
| `com` (US, default) | `https://accounts.zoho.com` | `https://www.site24x7.com/api` |
| `eu` (Europe) | `https://accounts.zoho.eu` | `https://www.site24x7.eu/api` |
| `in` (India) | `https://accounts.zoho.in` | `https://www.site24x7.in/api` |
| `com.au` (Australia) | `https://accounts.zoho.com.au` | `https://www.site24x7.net.au/api` |
| `cn` (China) | `https://accounts.zoho.com.cn` | `https://www.site24x7.cn/api` |
| `jp` (Japan) | `https://accounts.zoho.jp` | `https://app.site24x7.jp/api` |
| `ca` (Canada) | `https://accounts.zohocloud.ca` | `https://www.site24x7.ca/api` |
| `uk` (UK) | `https://accounts.zoho.uk` | `https://app.site24x7.uk/api` |
| `ae` (UAE) | `https://accounts.zoho.ae` | `https://app.site24x7.ae/api` |
| `sa` (Saudi Arabia) | `https://accounts.zoho.sa` | `https://www.site24x7.sa/api` |

---

## The sandbox surface

See [`SKILL.md`](../SKILL.md) for the operating manual aimed at the model
writing the JavaScript. TL;DR:

```js
site24x7.request({ method, path, query?, body?, version?, zaaid? })
site24x7.<tag>.<op>(args)               // typed accessor
site24x7.callOperation('opId', args)    // flat lookup
site24x7.listCustomers()                // MSP/BU enumeration
site24x7.withCustomer(zaaid, fn)        // scoped customer override (sync)
site24x7.zaaid                          // active zaaid (or undefined)
```

---

## Configuration

All variables are documented in [`.env.example`](../.env.example). Highlights:

| Variable | Default | Notes |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `8000` | HTTP port (only if `MCP_TRANSPORT=http`) |
| `MCP_HTTP_ALLOWED_ORIGINS` | `http://localhost,http://127.0.0.1` | Comma-separated origin allowlist |
| `SITE24X7_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` | — | Zoho Self Client credentials |
| `SITE24X7_ZONE` | `com` | Data center (see table above) |
| `SITE24X7_ZAAID` | — | (Optional) default MSP/BU customer scope |
| `SITE24X7_ACCOUNT_TYPE` | `standard` | `standard` / `msp` / `bu` |
| `SITE24X7_MAX_CALLS_PER_EXECUTE` | `50` | Per-execute API call budget |
| `SITE24X7_EXECUTE_TIMEOUT_MS` | `30000` | Wall-clock deadline (ms) |
| `SITE24X7_CACHE_DIR` | `~/.cache/site24x7-code-mode-mcp/` | On-disk cache root |

---

## Project status

This is `v0.1.0-beta.1`. Honest verification surface:

| Surface | Verified |
|---|---|
| Unit tests (Vitest, in-process) | ✅ |
| Integration tests (`InMemoryTransport` + real HTTP transport against a mock Site24x7) | ✅ |
| MCP Inspector CLI smoke (`tools/list`, `site24x7_search`, `site24x7_execute`) | ✅ |
| **Live read-only sweep against a real Site24x7 tenant** | ⏳ pending credentials |
| **Live MSP customer round-trip via `withCustomer`** | ⏳ pending credentials |
| OpenCode end-to-end LLM round-trip | ⏳ pending credentials |
| Cursor / Claude Code / Claude Desktop / Continue / Cline / Aider / Zed | ⏳ |
| Mutating live operations | ⛔ deliberately not run until you give us a lab tenant |
| Other zones beyond the one your refresh token lives in | ⏳ |
| Cloudflare Workers full transport | ⛔ 501 scaffold only (parity with sibling repos) |
| Long-running soak / stability | ⏳ |

This table updates honestly as we verify more — if a row is not ticked here, we haven't tested it. Verification reports are welcome (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

---
