# Site24x7 expert agent — example persona + prompts

A drop-in persona that turns any LLM agent connected to the
[`site24x7-code-mode-mcp`](https://github.com/jmpijll/site24x7-code-mode-mcp)
server into a **senior Site24x7 operator**: deeply familiar with
monitors of every flavour (URL, REST API, DNS, server, AWS / Azure /
GCP, RUM, APM, synthetic transactions, plugins), notification /
threshold / location profiles, IT Automation, schedule maintenance,
status pages, MSP and Business-Unit tenancy, the Zoho OAuth
identity + `zaaid` mental model, and the realities of monitoring
ops across one or many customer accounts.

## What's in here

| File | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The persona itself. Drop into any system-prompt slot or per-agent config (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.opencode/agent/<name>.md`, etc.) |
| [`SAMPLE_PROMPTS.md`](SAMPLE_PROMPTS.md) | Vetted prompts to validate the wiring end-to-end. Each one is annotated with what we expect the agent to do |
| [`install.md`](install.md) | Cross-platform install snippets — Cursor IDE, `cursor-agent` CLI, opencode, Claude Code, Claude Desktop, VS Code + Copilot, Codex CLI, Continue, MCP Inspector |

## Who this is for

- **Single-tenant Site24x7 operators** who want a chat-style ops
  console grounded in real REST calls instead of clicking through
  the web UI for every check.
- **MSP partners and BU portal admins** who manage many downstream
  customer accounts under one Zoho identity and want an agent that
  thinks in `(customer, zaaid)` pairs by default.
- **Hosters** running this MCP server multi-tenant (via the HTTP
  transport with per-request `X-Site24x7-*` headers) and want a
  consistent agent identity across deployments.
- **Testers** who want to drop a vetted persona into a fresh agent
  platform and file a [verification report](https://github.com/jmpijll/site24x7-code-mode-mcp/issues/new?template=verification_report.yml)
  about whether end-to-end LLM-mediated invocation works.

## Verification status

This persona ships with the `v0.1.0-beta.1` cut of the server. The
honest matrix:

| Surface | Verified |
|---|---|
| Unit + integration tests for the MCP server | yes |
| MCP Inspector CLI smoke (`tools/list`, `site24x7_search`, `site24x7_execute`) | yes |
| End-to-end LLM round-trip against a real Site24x7 tenant | pending tenant credentials |
| MSP `withCustomer` round-trip against a real MSP portal | pending tenant credentials |
| Cursor / opencode / Claude Code / Claude Desktop / Continue / Codex CLI | wired, awaiting verification |
| Mutating live operations under this persona | deliberately not exercised until a lab tenant is available |

If you test the persona end-to-end on a live tenant, please file a
[verification report](https://github.com/jmpijll/site24x7-code-mode-mcp/issues/new?template=verification_report.yml).
That single act is the highest-leverage contribution to this project
right now.

## License

Same as the parent repo: MIT.
