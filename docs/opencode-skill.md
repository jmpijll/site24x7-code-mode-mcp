# Coupling site24x7-code-mode-mcp with opencode

This guide is for users who want the [opencode](https://opencode.ai) AI agent CLI to drive this MCP server. For a vendor-neutral guide on the two-tool surface and the `site24x7.*` JavaScript surface, read [`../SKILL.md`](../SKILL.md) first.

> **Verification status.** Not yet live-verified end-to-end against a Site24x7 tenant. The opencode mechanics described below are sourced from the opencode docs and from the sibling `unraid-code-mode-mcp` / `unifi-code-mode-mcp` repos where the equivalent flow *has* been verified. If you try this with a real Zoho Self Client and a Site24x7 portal, please file a [verification report](../.github/ISSUE_TEMPLATE/verification_report.yml).

## 1. Where MCP servers are configured

opencode reads MCP server entries from a JSON config file:

| Scope | Path | Wins on name conflict |
|---|---|---|
| **Project** | `<repo>/opencode.json` (or `.jsonc`) | yes |
| **Global** | `~/.config/opencode/opencode.json` (or `.jsonc`) | no |

> Source: <https://opencode.ai/docs/config/> and <https://opencode.ai/docs/mcp-servers/>

## 2. Recommended: project-scoped stdio entry

Drop an `opencode.json` next to the cloned repo (project-scoped wins over the global one, so this is the safest place to put it):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "site24x7": {
      "type": "local",
      "command": ["node", "dist/index.js"],
      "enabled": true
    }
  },
  "permission": {
    "site24x7_*": "allow"
  }
}
```

Differences from Cursor's `mcp.json`:

- Top-level key is `mcp` (not `mcpServers`).
- Per-server: `type: "local"` for stdio. `command` is a single argv array (binary + args combined — no separate `args` field).
- Environment variables go under `environment` (not `env`).
- The top-level `permission` block uses auto-generated `<server>_<tool>` names. opencode prefixes every tool with the server key, so `site24x7_search` becomes `site24x7_site24x7_search` and `site24x7_execute` becomes `site24x7_site24x7_execute`. The wildcard `"site24x7_*": "allow"` covers both.

opencode auto-injects MCP tools into the model's tool list (verified against the sibling repos with `opencode-go/deepseek-v4-flash`), so there's nothing to wire up on the prompt side — just ask the model to use `site24x7_site24x7_search` or `site24x7_site24x7_execute`.

## 3. Credentials

opencode forwards the parent-process environment to the MCP child. Set the env vars in your shell before running opencode:

```bash
export SITE24X7_CLIENT_ID=1000.xxx
export SITE24X7_CLIENT_SECRET=xxx
export SITE24X7_REFRESH_TOKEN=1000.yyy
export SITE24X7_ZONE=com
export SITE24X7_ACCOUNT_TYPE=msp   # if you're an MSP user
opencode run --model opencode-go/deepseek-v4-flash \
  "Use site24x7_site24x7_search to find a 'list monitors' op, then call site24x7_site24x7_execute to return the count of monitors that are currently down."
```

Or pin them in `opencode.json` for that profile (avoid checking this version into a public repo):

```json
{
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
  }
}
```

For MSP / BU users, the most useful single switch is `SITE24X7_ACCOUNT_TYPE=msp` (or `bu`) — it makes `MissingZaaidError` messages tell the model exactly what to do. See [`multi-tenant.md`](multi-tenant.md).

## 4. Wiring the expert agent persona

This repo ships a Site24x7-expert agent persona at [`../examples/site24x7-expert-agent/`](../examples/site24x7-expert-agent/). It is platform-agnostic: copy the system prompt into your agent's persona slot and the LLM will treat `site24x7_site24x7_search` / `site24x7_site24x7_execute` as its primary tools for Site24x7 questions.

For opencode specifically, the persona drops in as a custom agent:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "site24x7": { "type": "local", "command": ["node", "dist/index.js"], "enabled": true }
  },
  "agents": {
    "site24x7-expert": {
      "model": "anthropic/claude-sonnet-4-5",
      "systemPrompt": {
        "type": "file",
        "path": "./examples/site24x7-expert-agent/system-prompt.md"
      },
      "tools": ["site24x7_*"]
    }
  },
  "permission": {
    "site24x7_*": "allow"
  }
}
```

Then call it explicitly:

```bash
opencode run --agent site24x7-expert "Which of my MSP customers have any monitors down right now?"
```

## 5. Smoke-test with `opencode mcp list`

Before involving any model, confirm opencode picks up the entry:

```bash
opencode mcp list
```

Expected:

```text
●  ✓ site24x7 connected
       node dist/index.js
└  1 server(s)
```

If it says `failed`, run `opencode mcp list` once more — the first start spawns the server and discovers tools; the second start will show the final `connected` state. **Not yet recorded against this server** — please file a verification report if you confirm or refute the same behaviour you'd see against a healthy Node MCP server.

## 6. Headless run for verification

A protocol-level smoke that does not need any Site24x7 credentials (just confirms the bundled spec loads):

```bash
opencode --pure run --model opencode-go/deepseek-v4-flash \
  "Use site24x7_site24x7_search with code='index.operations.length'. Reply with only the number."
```

Expected: opencode prints the operation count from the bundled scraped spec.

A real round-trip (requires creds in env):

```bash
opencode --pure run --model opencode-go/deepseek-v4-flash \
  "Use site24x7_site24x7_execute to run site24x7.request({method:'GET',path:'/api/current_status'}) and return the count of monitors with status === 'DOWN'."
```

The `--pure` flag is documented below as a workaround for an opencode 1.14.30 plugin-bootstrap hang.

## 7. Sample prompts that exercise MSP recipes

For MSP / BU users — these prompts assume `SITE24X7_ACCOUNT_TYPE=msp` and a refresh token with `Site24x7.Msp.All`:

```bash
opencode run --agent site24x7-expert \
  "List every customer under my MSP portal and how many of their monitors are currently down. Return a markdown table sorted by down-count."
```

```bash
opencode run --agent site24x7-expert \
  "For the customer named 'Acme Corp', list every HTTP monitor with a failing status and the timestamp of its last successful check. Use site24x7.withCustomer."
```

```bash
opencode run --agent site24x7-expert \
  "Across all my MSP customers, find any monitor that has been DOWN for more than 24 hours and return { customer, monitorName, downSince } for each. Respect the 50-call per-execute budget — paginate across multiple site24x7_execute calls if needed."
```

The expert persona's system prompt nudges the model to call `site24x7_site24x7_search` first, pick operationIds + read their `mspOnly` / `requiredScopes`, and only then write the `site24x7_site24x7_execute` script.

## 8. Known limitations specific to opencode (v1.14.30)

These are reproduced from the sibling repos where they were verified live. They are opencode-level, not vendor-specific, so they apply identically here.

- **`plugin.copilot` Zod-validation crash hangs bootstrap.** opencode 1.14.30's bundled GitHub Copilot provider plugin fails to parse `models.json` from `models.dev` for some capability fields; the error is logged but bootstrap hangs in `kevent64`. **Workaround**: pass `--pure` (skips plugins). All `github-copilot/*` and Anthropic models still work this way; only auto-discovery of new copilot models is disabled.
- **Persisted model variants are silent.** opencode keeps per-model reasoning-effort overrides in `~/.local/state/opencode/model.json` under the `variant` key. If you ran a model with a high reasoning variant once (e.g. via the TUI), every subsequent CLI invocation inherits it — and `opencode run` does not echo this. Clear with `--variant default` or edit the file.
- **Permissions allowlist syntax differs from Cursor.** opencode uses `"site24x7_*": "allow"` at the top-level `permission` block — Cursor uses `"Mcp(site24x7:site24x7_search)"` patterns inside `.cursor/cli.json`. Not interchangeable.
- **`opencode run` is silent until completion** (no streaming progress on stdout) — tail the rolling log file under `~/.local/share/opencode/log/` instead.
- **Mutating tools should not be on `allow`** in shared sessions. The example in §2 uses `"site24x7_*": "allow"` for convenience; for any session where the agent might call `monitors.delete`, `userManagement.delete`, threshold-profile mutations, or scheduled-maintenance writes and you want a human approval gate, switch to per-tool permissions.

## 9. Reference

| Item | URL |
|---|---|
| opencode config | <https://opencode.ai/docs/config/> |
| opencode MCP servers | <https://opencode.ai/docs/mcp-servers/> |
| opencode CLI | <https://opencode.ai/docs/cli/> |
| opencode permissions | <https://opencode.ai/docs/permissions/> |
| This server's two-tool surface | [`../SKILL.md`](../SKILL.md) |
| Server installation | [`./usage.md`](./usage.md) |
| Multi-tenant transport details | [`./multi-tenant.md`](./multi-tenant.md) |
| Site24x7-expert persona | [`../examples/site24x7-expert-agent/`](../examples/site24x7-expert-agent/) |
