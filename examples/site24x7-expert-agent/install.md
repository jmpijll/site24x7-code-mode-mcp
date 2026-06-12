# Cross-platform install guide — Site24x7 expert agent

How to wire `site24x7-code-mode-mcp` into different agent platforms,
with the `site24x7-expert-agent` persona loaded as the system prompt.
Each section is self-contained.

## Verification legend

- **VERIFIED** — The maintainer has run a real LLM through this client and watched it call the MCP tools end-to-end. Configurations below are known to work.
- **NOT-VERIFIED** — The configuration follows the platform's documented MCP support and *should* work, but we haven't tested it. Please file a [verification report](https://github.com/jmpijll/site24x7-code-mode-mcp/issues/new?template=verification_report.yml) if you do.
- **PROTOCOL-ONLY** — The MCP handshake works, but the platform's particular client mode doesn't expose custom tools to the LLM in the current release.

> **Surface verification (independent of agent platform).** All
> verification recorded so far is from the server's unit, integration,
> and MCP Inspector smokes. End-to-end LLM-mediated invocation against
> a real Site24x7 tenant is **pending credentials**; every section
> below is therefore **NOT-VERIFIED** for the LLM leg of the loop
> unless explicitly marked otherwise. The MCP handshake itself is
> stable on every transport documented here.

## Prerequisites (every platform)

```bash
git clone https://github.com/jmpijll/site24x7-code-mode-mcp.git
cd site24x7-code-mode-mcp
npm install --legacy-peer-deps
cp .env.example .env
# Fill in SITE24X7_CLIENT_ID / SECRET / REFRESH_TOKEN / ZONE.
# See README.md → "Authentication" for the 5-minute Self Client flow.
npm run build
# Sanity check (boots the stdio server):
node dist/index.js --help 2>/dev/null || echo "stdio server is fine"
```

The server's stdio entry is `node dist/index.js`. The HTTP transport
entry is the same binary with `MCP_TRANSPORT=http` set.

For multi-tenant deployments (one MCP server, many Zoho identities),
run in HTTP mode and have each request carry the credentials via
headers — see [`docs/multi-tenant.md`](../../docs/multi-tenant.md).

The full path to use in absolute-path snippets below:

```bash
echo "$(pwd)/dist/index.js"
# e.g. /Users/you/code/site24x7-code-mode-mcp/dist/index.js
```

We use `/absolute/path/to/site24x7-code-mode-mcp/dist/index.js` as a
placeholder.

### Minimum env vars (single-tenant stdio)

```bash
export SITE24X7_CLIENT_ID=1000.xxx
export SITE24X7_CLIENT_SECRET=xxx
export SITE24X7_REFRESH_TOKEN=1000.yyy
export SITE24X7_ZONE=com                          # com | eu | in | com.au | cn | jp | ca | uk | ae | sa
# Optional, for MSP / BU portals:
export SITE24X7_ACCOUNT_TYPE=msp                  # standard (default) | msp | bu
export SITE24X7_ZAAID=658123456                   # default downstream customer scope
```

---

## Cursor IDE / `cursor-agent` CLI — NOT-VERIFIED (wiring documented)

Add to `.cursor/mcp.json` at your project root, **or** to the global
config at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["/absolute/path/to/site24x7-code-mode-mcp/dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com",
        "SITE24X7_ACCOUNT_TYPE": "msp"
      }
    }
  }
}
```

Or, with credentials forwarded from the parent shell (recommended —
keeps the JSON committable):

```json
{
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "${env:SITE24X7_CLIENT_ID}",
        "SITE24X7_CLIENT_SECRET": "${env:SITE24X7_CLIENT_SECRET}",
        "SITE24X7_REFRESH_TOKEN": "${env:SITE24X7_REFRESH_TOKEN}",
        "SITE24X7_ZONE": "${env:SITE24X7_ZONE}",
        "SITE24X7_ACCOUNT_TYPE": "${env:SITE24X7_ACCOUNT_TYPE}"
      }
    }
  }
}
```

Adopt the persona — two equally good options:

```bash
# Option A: project-root AGENTS.md (Cursor reads it automatically)
cp examples/site24x7-expert-agent/AGENTS.md AGENTS.md

# Option B: project-scoped rule
mkdir -p .cursor/rules
cp examples/site24x7-expert-agent/AGENTS.md .cursor/rules/site24x7.mdc
```

Headless run via `cursor-agent`:

```bash
cursor-agent --print --output-format json --approve-mcps --force \
  --model claude-4.6-sonnet-medium \
  "Use the site24x7 MCP search tool with code: searchOperations('current status', 5). Return the operation IDs only."
```

See [`docs/cursor-skill.md`](../../docs/cursor-skill.md) for the full
Cursor coupling guide.

---

## opencode (CLI) — NOT-VERIFIED (wiring documented)

Project-scoped `opencode.json` at the repo root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "site24x7": {
      "type": "local",
      "command": ["node", "dist/index.js"],
      "enabled": true,
      "environment": {
        "SITE24X7_CLIENT_ID": "{env:SITE24X7_CLIENT_ID}",
        "SITE24X7_CLIENT_SECRET": "{env:SITE24X7_CLIENT_SECRET}",
        "SITE24X7_REFRESH_TOKEN": "{env:SITE24X7_REFRESH_TOKEN}",
        "SITE24X7_ZONE": "{env:SITE24X7_ZONE}",
        "SITE24X7_ACCOUNT_TYPE": "{env:SITE24X7_ACCOUNT_TYPE}"
      }
    }
  },
  "permission": {
    "site24x7_search": "allow",
    "site24x7_execute": "ask"
  }
}
```

Notes:

- Top-level key is `mcp` (not `mcpServers`). Per-server
  `type: "local"` for stdio. `command` is a single argv array.
  Environment vars under `environment` (not `env`).
- opencode auto-prefixes tools with the server key, so the names
  become `site24x7_search` and `site24x7_execute`. The example above
  keeps `site24x7_execute` behind an approval gate — recommended for
  any deployment where mutations are possible. If you fully trust
  the persona and just want to fly, use `"site24x7_*": "allow"`.
- Drop the persona at the project root as `AGENTS.md`:

```bash
cp examples/site24x7-expert-agent/AGENTS.md AGENTS.md
```

opencode reads project-root `AGENTS.md` as the agent system prompt.

Alternative per-agent placement (multi-agent setups):

```bash
mkdir -p .opencode/agent
cp examples/site24x7-expert-agent/AGENTS.md .opencode/agent/site24x7.md
```

Smoke test (no LLM):

```bash
opencode mcp list
# expected:
# ●  ✓ site24x7 connected
#        node dist/index.js
# └  1 server(s)
```

See [`docs/opencode-skill.md`](../../docs/opencode-skill.md) for the
opencode-specific coupling guide.

---

## Claude Code CLI — NOT-VERIFIED

Add the server with:

```bash
claude mcp add site24x7 \
  --transport stdio \
  -- node /absolute/path/to/site24x7-code-mode-mcp/dist/index.js \
  --env SITE24X7_CLIENT_ID=1000.xxx \
  --env SITE24X7_CLIENT_SECRET=xxx \
  --env SITE24X7_REFRESH_TOKEN=1000.yyy \
  --env SITE24X7_ZONE=com \
  --env SITE24X7_ACCOUNT_TYPE=msp
```

Verify with:

```bash
claude mcp list
claude mcp get site24x7
```

Adopt the persona by dropping it at the project root:

```bash
cp examples/site24x7-expert-agent/AGENTS.md CLAUDE.md
# (Claude Code reads CLAUDE.md as the project system prompt.)
```

End-to-end LLM call: needs `ANTHROPIC_API_KEY` in your environment
(or interactive auth). **Verification report welcome.**

---

## Claude Desktop — NOT-VERIFIED

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS (similar paths on Linux / Windows — see Claude Desktop docs):

```json
{
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["/absolute/path/to/site24x7-code-mode-mcp/dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com",
        "SITE24X7_ACCOUNT_TYPE": "msp"
      }
    }
  }
}
```

Reload Claude Desktop. The persona can't be loaded as a system prompt
the same way — paste it into a project's instructions or the
conversation's system prompt slot. **Verification report welcome.**

---

## Codex CLI — NOT-VERIFIED

Codex reads MCP servers from `~/.codex/config.toml` (per-user) or a
project-scoped `.codex/config.toml`:

```toml
[mcp_servers.site24x7]
command = "node"
args = ["/absolute/path/to/site24x7-code-mode-mcp/dist/index.js"]

[mcp_servers.site24x7.env]
SITE24X7_CLIENT_ID = "1000.xxx"
SITE24X7_CLIENT_SECRET = "xxx"
SITE24X7_REFRESH_TOKEN = "1000.yyy"
SITE24X7_ZONE = "com"
SITE24X7_ACCOUNT_TYPE = "msp"
```

Adopt the persona by dropping it at the project root as `AGENTS.md`
(Codex reads project-root `AGENTS.md` as the system prompt). Verify
discovery with `codex mcp list`. **Verification report welcome.**

---

## Continue — NOT-VERIFIED

Edit `~/.continue/config.json` (or the workspace
`.continue/config.json`). Continue expects MCP servers under
`mcpServers` and a per-agent `systemMessage`:

```json
{
  "models": [],
  "mcpServers": {
    "site24x7": {
      "command": "node",
      "args": ["/absolute/path/to/site24x7-code-mode-mcp/dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com",
        "SITE24X7_ACCOUNT_TYPE": "msp"
      }
    }
  },
  "systemMessage": "<paste the contents of examples/site24x7-expert-agent/AGENTS.md here>"
}
```

Continue does not pull `AGENTS.md` automatically — paste the persona
into `systemMessage` or load it via the platform's prompt-library
feature if available. **Verification report welcome.**

---

## VS Code + GitHub Copilot Chat — NOT-VERIFIED

Recent Copilot Chat versions read MCP servers from `.vscode/mcp.json`
(workspace) or VS Code user settings (`mcp.servers`). Workspace
example:

```json
{
  "servers": {
    "site24x7": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/site24x7-code-mode-mcp/dist/index.js"],
      "env": {
        "SITE24X7_CLIENT_ID": "1000.xxx",
        "SITE24X7_CLIENT_SECRET": "xxx",
        "SITE24X7_REFRESH_TOKEN": "1000.yyy",
        "SITE24X7_ZONE": "com",
        "SITE24X7_ACCOUNT_TYPE": "msp"
      }
    }
  }
}
```

Adopt the persona by dropping it as
`.github/copilot-instructions.md`. **Verification report welcome.**

---

## MCP Inspector (CLI) — VERIFIED (handshake only)

The CI workflow runs an MCP Inspector CLI smoke that confirms
`tools/list` exposes both `site24x7_search` and `site24x7_execute`.
Manual interactive use:

```bash
npx -y @modelcontextprotocol/inspector \
  --cli node /absolute/path/to/site24x7-code-mode-mcp/dist/index.js \
  --method tools/list

npx -y @modelcontextprotocol/inspector \
  --cli node /absolute/path/to/site24x7-code-mode-mcp/dist/index.js \
  --method tools/call \
  --tool-name site24x7_search \
  --tool-arg code="searchOperations('current status', 5)"
```

UI mode (browser-based): `npx -y @modelcontextprotocol/inspector` then
connect via stdio to `node /absolute/path/to/site24x7-code-mode-mcp/dist/index.js`.
No LLM in the loop — useful for verifying the wiring before pointing
an agent at it.

---

## Generic (any agent with a system-prompt slot) — NOT-VERIFIED

If the platform isn't listed above:

1. Configure the MCP server via whatever JSON / TOML / YAML it
   accepts. The command is always `node /absolute/path/to/dist/index.js`
   with `SITE24X7_CLIENT_ID`, `SITE24X7_CLIENT_SECRET`,
   `SITE24X7_REFRESH_TOKEN`, `SITE24X7_ZONE` in env (plus optional
   `SITE24X7_ZAAID` and `SITE24X7_ACCOUNT_TYPE`).
2. Copy the contents of [`AGENTS.md`](AGENTS.md) into whichever slot
   the platform calls "system prompt", "agent instructions",
   "persona", or "guardrails". The content is platform-agnostic.
3. Confirm the agent can see both `site24x7_search` and
   `site24x7_execute` as available tools.
4. Run prompt 1 from [`SAMPLE_PROMPTS.md`](SAMPLE_PROMPTS.md) to
   smoke-test the wiring.

---

## Per-platform persona file mapping

| Platform | Persona file |
|---|---|
| Cursor | `AGENTS.md` at project root, or `.cursor/rules/site24x7.mdc` |
| `cursor-agent` CLI | `AGENTS.md` at project root + `--print` prompt |
| opencode | `AGENTS.md` at project root, or `.opencode/agent/site24x7.md` |
| Claude Code CLI | `CLAUDE.md` at project root |
| Claude Desktop | Paste into project / conversation system prompt |
| Codex CLI | `AGENTS.md` at project root |
| Continue | `~/.continue/config.json` → `systemMessage` |
| VS Code + Copilot | `.github/copilot-instructions.md` (workspace) |
| MCP Inspector | N/A (no LLM in the loop) |

When in doubt, copy [`AGENTS.md`](AGENTS.md) into whatever the
platform calls "system prompt" or "persona" or "agent definition
file". The content is platform-agnostic.
