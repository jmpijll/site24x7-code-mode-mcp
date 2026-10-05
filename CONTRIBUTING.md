# Contributing to site24x7-code-mode-mcp

Thanks for thinking about it. This is a public beta and we genuinely
need help — verification reports against real Site24x7 accounts (MSP
and standard), bug reports, edge cases, and PRs.

## Project posture

- **Status: beta.** The package is `"private": true` in `package.json`. We
  will lift that and publish to npm when we tag `1.0.0`. Until then,
  install from source.
- **Single maintainer.** Response time is best-effort. If you don't hear
  back in a week, ping the issue.
- **Honest scope.** We say what we've verified and what we haven't — read
  the [README's Project status](README.md#project-status) before filing.

## Filing issues

- **Bug report** — something works wrong against the documented surface.
  Include the exact JS you ran in `site24x7_execute`, the Site24x7 zone
  (`com` / `eu` / …), whether you're MSP / BU / standard, and a redacted
  log. **Don't paste client secrets or refresh tokens.**
- **Verification report** — you tested with an agent platform we haven't
  verified yet (Cursor, Claude Code, Claude Desktop, VS Code Copilot,
  Codex CLI, Continue, Cline, opencode, MCP Inspector, Aider, Zed, …).
  This is the most helpful kind of issue right now.
- **Feature request** — something the Site24x7 API exposes that we don't
  surface well. Cite the operation (method + path + scope) and explain
  the use case.
- **Security issue** — DO NOT open a public issue. See [`SECURITY.md`](SECURITY.md).

## Development setup

```bash
git clone https://github.com/jmpijll/site24x7-code-mode-mcp
cd site24x7-code-mode-mcp
npm ci
cp .env.example .env
# (optional) edit .env to point at a real Site24x7 account for live testing
npm run dev
```

## Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the server via `tsx` (live TypeScript) |
| `npm run build` | Type-check + emit to `dist/` |
| `npm run lint` | ESLint over `src/`, `scripts/`, `cf-worker/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format:check` | Required Prettier check (included in `npm run check`) |
| `npm test` | Vitest in CI mode |
| `npm run test:watch` | Vitest watch mode |
| `npm run update-spec` | Refresh `src/spec/site24x7-fallback.json` from upstream docs |
| `npm run live-test` | Read-only sweep against a real Site24x7 tenant (uses `.env`) |
| `npm run smoke:mcp` | Offline built-server metadata and tool registration check |
| `npm run cf:check` | Worker bundle validation without deployment |
| `npm run smoke:inspector` | Interactive MCP Inspector against a configured live tenant |

CI runs `npm run check` on Node 22 and 24, including formatting and the offline
built-MCP smoke. A separate job runs `npm run cf:check`.

## Style

- TypeScript everywhere, ESM modules.
- `prettier` defaults from `.prettierrc` (single quotes, semicolons,
  trailing commas, 100-char width).
- Follow the existing layout: features grow under the right `src/<area>/`
  folder and re-export via `src/<area>/index.ts`.
- Avoid trivial comments. Comments should explain "why", not narrate the
  code.
- Don't create new top-level docs unless asked — extend the existing files.

## Tests

- Unit tests live under `src/__tests__/`. Add one when you change
  behavior, refactor a non-trivial helper, or fix a bug.
- Integration tests use a tiny in-process `node:http` mock — extend it
  instead of spinning up new harnesses.
- Live-against-real-Site24x7 tests are gated behind real credentials in
  `.env`; do not commit `.env`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new behavior the user can observe
- `fix:` — bug fix
- `chore:` — internals, deps, lint, type-noise
- `docs:` — markdown / README only
- `test:` — only test files
- `ci:` — workflows / GH Actions

If working with an LLM coding assistant, include a `Co-authored-by:` trailer.

## Pull requests

Keep diffs focused — one concern per PR. Formatting is enforced in CI; avoid unrelated cleanup in feature changes.

## Security

Do not file security issues publicly. Use the [private security advisory
form](https://github.com/jmpijll/site24x7-code-mode-mcp/security/advisories/new).
See [SECURITY.md](SECURITY.md).


## Shared repository conventions

- Use Node.js 22.19+; the lockfile dependencies require this baseline.
- Install with `npm ci`; `.npmrc` keeps the resolver policy consistent in local, CI and Docker builds.
- Run `npm run check` before opening a PR: lint, formatting, typecheck, mocked tests and build.
- Formatting is enforced by `npm run check`; use `npm run format` to apply the shared style.
- Keep text files in LF format (`.gitattributes`).
- Keep service-specific API semantics, tool names and sandbox bridges compatible.
- Record live checks separately from mocked tests; never infer new client or upstream coverage from CI.

## Offline and Worker checks

`npm run smoke:mcp` checks the built stdio server name, package version and two tool names.
It is included in `npm run check`, blocks upstream network access and does not forward tenant credentials.
Run `npm run cf:check` after Worker changes; it bundles without deploying.
Live API and interactive Inspector checks remain separate and require deliberate credentials.
