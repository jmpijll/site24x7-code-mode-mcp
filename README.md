<p align="center">
  <img src="docs/assets/hero.svg" alt="Site24x7 Code Mode MCP. Two tools. One API." width="100%">
</p>

<p align="center">
  <strong>Explore Site24x7 through two MCP tools.</strong><br>
  Use Zoho OAuth and sandboxed JavaScript to work across monitors, MSP customers and Business Units.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#example-session">Example session</a> ·
  <a href="#know-the-boundaries">Boundaries</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">Node.js 22.19+ · Public beta · v0.1.0-beta.1 · MIT license</p>

[![CI](https://github.com/jmpijll/site24x7-code-mode-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jmpijll/site24x7-code-mode-mcp/actions/workflows/ci.yml)

## Two tools, one API

This [Model Context Protocol](https://modelcontextprotocol.io/) server exposes `site24x7_search` and `site24x7_execute`.
The agent searches the API reference, then runs JavaScript inside a QuickJS WASM sandbox.
API calls go through the host; credentials remain outside the sandbox.

- **Use one namespace.** `site24x7.*` covers monitoring and account operations.
- **Refresh OAuth automatically.** Credentials and the in-memory access-token cache stay on the host.
- **Scope customer calls.** `withCustomer(zaaid, fn)` selects an MSP customer or Business Unit and restores the previous scope.
- **Search offline.** The bundled specification is generated from the API documentation.

## Get started

Install from source and point your MCP client at the built `dist/index.js`.

### Requirements

- Node.js **22.19.0 or newer** and npm. CI checks Node 22 and 24.
- Zoho Self Client credentials and a refresh token for your Site24x7 data center.

### Build from source

```bash
git clone https://github.com/jmpijll/site24x7-code-mode-mcp.git
cd site24x7-code-mode-mcp
npm ci
cp .env.example .env
# Edit .env: SITE24X7_CLIENT_ID, SITE24X7_CLIENT_SECRET, SITE24X7_REFRESH_TOKEN and SITE24X7_ZONE.
npm run build
npm start
```

The shell examples use Bash. In PowerShell, use `Copy-Item .env.example .env` and
set variables with `$env:NAME = 'value'`.

Configure your MCP client with `node /absolute/path/to/site24x7-code-mode-mcp/dist/index.js`.
Use an absolute path and supply credentials through the client's environment configuration
when its working directory does not contain your `.env` file.
See the [client setup and usage guide](docs/usage.md).

For hosted use, set `MCP_TRANSPORT=http` and follow the [per-request credential contract](docs/multi-tenant.md).
Docker instructions are in [docker-compose.yml](docker-compose.yml).

## Example session

After discovering the operation with the search tool, use the execute tool:

```javascript
site24x7.request({ method: 'GET', path: '/api/current_status' });
```

See the [usage guide](docs/usage.md) for search recipes, configuration and additional call shapes.

## Know the boundaries

| Area | Current boundary |
| --- | --- |
| API reference | Bundled snapshot scraped from documentation; no live OpenAPI endpoint. |
| Live coverage | Real-tenant, MSP/BU, client and mutation verification remain pending. |
| Workers | Scaffold; the MCP transport adapter returns 501. |
| Sandbox | Resource limits bound each invocation; allowed API calls still act with the supplied account's permissions. |

### Verification status

Mocked unit/integration coverage and MCP Inspector CLI smoke are recorded. Real-tenant and LLM-client verification remain pending.
See the [setup and verification reference](docs/usage.md#setup-and-verification-reference)
for the detailed historical evidence and remaining work. New verification reports should
identify the server revision, client, upstream version and operations actually exercised.

### Project status

Public beta · v0.1.0-beta.1. Install from source; the package remains private and is not published to npm.

## Privacy

The host sends API requests to the service configured for this server. Tool results and
captured sandbox logs are returned to your MCP client; that client may send them to its
configured model provider. Spec caches may be written locally.

Keep `.env` files and credentials private. Redact account identifiers, IP addresses and
service data before sharing logs or verification reports. See [SECURITY.md](SECURITY.md)
for vulnerability reporting.

## Development and contribution

```bash
npm run check
npm run format:check
```

`check` runs lint, typecheck, mocked tests and the build. Formatting is checked separately;
existing formatter drift is reported in PR validation. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the repository layout and contribution checks, and [AGENTS.md](AGENTS.md) for
architectural invariants. Live API tests require separate credentials and verification scope.

<a id="data-centers"></a>

## Documentation

- [Usage and client setup](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Agent operating manual](SKILL.md) and [example persona](examples/site24x7-expert-agent/)
- [Changelog](CHANGELOG.md)

## License and acknowledgements

[MIT](LICENSE). Built with TypeScript, the MCP SDK and QuickJS, following the
[Cloudflare Code Mode pattern](https://github.com/cloudflare/mcp-server-cloudflare).
