# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Upgrade Wrangler to the tested 4.105 baseline so `worker_loaders` is recognized; add a Worker dry-run CI job.
- Derive Node MCP version metadata from package.json across the family; use package metadata in Worker scaffolds to prevent release drift.
- Align README presentation with Vapour and Slightshot, retaining detailed setup and historical verification in the usage guide.
- Align Node 22.19+ requirements, contributor checks, install policy, LF text handling, CI and Docker build exclusions across the code-mode server family.

## [0.1.0-beta.1] — 2026-06-12

### Added

- Initial public beta of the Site24x7 code-mode MCP server.
- Two MCP tools: `site24x7_search` and `site24x7_execute`, backed by a
  QuickJS WASM sandbox with a flat `site24x7.*` surface.
- **Zoho OAuth 2.0 (Self Client refresh-token flow)** with per-tenant
  in-memory access-token cache and automatic refresh on 401.
- **First-class MSP / Business Unit support via `Cookie: zaaid=...`** —
  `TenantContext` carries `zaaid` and `accountType`; the HTTP client injects
  the cookie automatically; operations marked `mspOnly` / `buOnly` in the
  bundled spec return a structured `MissingZaaidError` when called without
  a `zaaid` in scope.
- Sandbox MSP ergonomics: `site24x7.listCustomers()`, `site24x7.withCustomer(zaaid, fn)`,
  `site24x7.zaaid` accessor.
- Single-user (env) and multi-tenant (per-request `X-Site24x7-*` headers) modes.
- stdio + Streamable HTTP transports.
- Bundled JSON spec scraped from the public Site24x7 REST reference
  (`scripts/update-spec.ts`), covering most documented operations.
- Cloudflare Workers entry scaffold (501 transport-adapter parity with
  the sibling `*-code-mode-mcp` repos).
- `examples/site24x7-expert-agent/` — default agent with an explicit MSP
  workflow recipe.
- Default opencode + Cursor wiring (`opencode.json`, `.cursor/mcp.json`,
  `.cursor/cli.json`).
- Docs covering architecture, multi-tenant operation (including MSP/BU),
  security, usage, and the Cursor + opencode integration paths.

### Verification

- Unit + integration tests (Vitest) against in-process mocks.
- MCP Inspector CLI smoke (`tools/list`, `site24x7_search`, `site24x7_execute`).
- Live verification gated on receiving Site24x7 credentials.
