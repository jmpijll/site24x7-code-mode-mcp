# site24x7-code-mode-mcp

> **Status:** public beta (`v0.1.0-beta.1`). Verification status is tracked below.

A [Model Context Protocol](https://modelcontextprotocol.io/) server for the **Zoho Site24x7 REST API**, built on the **code-mode** pattern: instead of mapping each of the hundreds of Site24x7 endpoints to its own MCP tool, this server exposes **exactly two** tools (`site24x7_search` and `site24x7_execute`) and a JavaScript sandbox where the LLM writes real code against a flat `site24x7.*` surface.

This is the same architecture used by the sibling repos:

- [`make-code-mode-mcp`](https://github.com/jmpijll/make-code-mode-mcp) — Make.com Web API v2
- [`unraid-code-mode-mcp`](https://github.com/jmpijll/unraid-code-mode-mcp) — Unraid 7.2+ GraphQL API
- [`unifi-code-mode-mcp`](https://github.com/jmpijll/unifi-code-mode-mcp) — UniFi Network + Site Manager APIs
- [`fortimanager-code-mode-mcp`](https://github.com/jmpijll/fortimanager-code-mode-mcp) — FortiManager JSON-RPC

What's different about Site24x7:

1. **Zoho OAuth 2.0** with a permanent refresh token (Self Client flow). New auth pattern for this family.
2. **MSP / Business Unit tenancy** — a second axis of tenancy inside a single OAuth identity, expressed as `Cookie: zaaid=<customer_id>`. **First-class** in this server, not bolted on.
3. **No public OpenAPI spec.** We scrape the [official REST reference](https://www.site24x7.com/help/api/) into a bundled JSON spec at build time.

---

## Quickstart

```bash
git clone https://github.com/jmpijll/site24x7-code-mode-mcp
cd site24x7-code-mode-mcp
npm install --legacy-peer-deps
cp .env.example .env
# Fill in SITE24X7_CLIENT_ID / SECRET / REFRESH_TOKEN / ZONE — see "Authentication" below.
npm run build
node dist/index.js                   # stdio mode (default)
# or, for multi-tenant HTTP mode:
MCP_TRANSPORT=http MCP_HTTP_PORT=8000 node dist/index.js
```

Then wire it into your MCP client:

- **Cursor** — uses `.cursor/mcp.json` shipped in this repo.
- **opencode** — uses `opencode.json` shipped in this repo.
- **Claude Code / Claude Desktop / Codex / Continue / Cline / Zed / MCP Inspector** — see [`docs/usage.md`](docs/usage.md).

---

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

See [`docs/multi-tenant.md`](docs/multi-tenant.md) for the full architecture.

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

See [`SKILL.md`](SKILL.md) for the operating manual aimed at the model
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

All variables are documented in [`.env.example`](.env.example). Highlights:

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

This table updates honestly as we verify more — if a row is not ticked here, we haven't tested it. Verification reports are welcome (see [`CONTRIBUTING.md`](CONTRIBUTING.md)).

---

## Docs

- [`AGENTS.md`](AGENTS.md) — contributor guide and architectural invariants
- [`SKILL.md`](SKILL.md) — operating manual for the MCP client / LLM
- [`docs/architecture.md`](docs/architecture.md) — the code-mode pattern and how this server implements it
- [`docs/multi-tenant.md`](docs/multi-tenant.md) — env vs headers vs `withCustomer`, including MSP/BU
- [`docs/security.md`](docs/security.md) — threat model, credential handling, sandbox boundary
- [`docs/usage.md`](docs/usage.md) — every supported MCP client and how to wire it in
- [`docs/opencode-skill.md`](docs/opencode-skill.md) — opencode-specific install + recipes
- [`docs/cursor-skill.md`](docs/cursor-skill.md) — Cursor-specific install + recipes
- [`examples/site24x7-expert-agent/`](examples/site24x7-expert-agent/) — drop-in Site24x7-expert persona for any agent platform

---

## License

[MIT](LICENSE).
