import { SERVER_VERSION } from '../version.js';
/**
 * MCP Server — Site24x7 Code Mode.
 *
 * Registers two tools:
 *   - site24x7_search  — query the bundled spec via sandboxed JS (no network)
 *   - site24x7_execute — run Site24x7 API calls via sandboxed JS
 *
 * Each `site24x7_execute` call resolves a `TenantContext` (env in single-user
 * mode, `X-Site24x7-*` headers in multi-tenant mode), constructs a fresh
 * `ExecuteExecutor` for that request, runs the code, and returns the
 * formatted MCP tool content.
 *
 * The HTTP client and OAuth client are constructed once and shared across
 * tenants; the per-tenant access-token cache lives on the OAuth client.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ExecuteExecutor } from '../sandbox/execute-executor.js';
import { SearchExecutor } from '../sandbox/search-executor.js';
import { MAX_CODE_SIZE, MAX_RESULT_SIZE, type SandboxLimits } from '../sandbox/limits.js';
import type { ExecuteResult } from '../sandbox/types.js';
import type { Site24x7HttpClient } from '../client/http.js';
import type { ProcessedSpec } from '../types/spec.js';
import type { TenantContext } from '../types/tenant.js';

const SEARCH_TOOL_DESCRIPTION = `Search the Site24x7 REST API spec by writing JavaScript.

The sandbox is read-only — no network. Use this tool to **discover** what to call before invoking \`site24x7_execute\`.

## Globals

- \`spec\` — \`{ title, sourceUrl, generatedAt, operationCount, tags[] }\`. \`null\` if no spec is loaded.
- \`searchOperations(query, limit?)\` — text-ranked search; default limit 25.
- \`getOperation(operationId)\` — full operation including parameters, requiredScopes, mspOnly / buOnly flags. Returns \`null\` if no such id.
- \`findOperationsByPath(substring)\` — list operations whose path contains the substring (case-insensitive).
- \`findOperationsByTag(tag)\` — list operations in a tag (e.g. \`'monitors'\`, \`'msp'\`, \`'business_units'\`).
- \`console.log()\` — captured into the tool output.

## Examples

\`\`\`javascript
// All operations tagged "monitors"
findOperationsByTag('monitors');
\`\`\`

\`\`\`javascript
// Top 10 hits for "msp customer"
searchOperations('msp customer', 10);
\`\`\`

\`\`\`javascript
// Full detail on the create-monitor op
getOperation('post_monitors');
\`\`\`
`;

const EXECUTE_TOOL_DESCRIPTION = `Run Site24x7 API calls by writing JavaScript that uses the \`site24x7\` namespace.

Surface:

- \`site24x7.<tag>.<operationId>(args)\` — typed call. Args are auto-routed: keys matching path or query params from the spec are placed correctly; remaining keys form the JSON body for POST/PUT/PATCH. Override with \`{ pathParams: {...}, query: {...}, body: {...}, version: '2.1', zaaid: '...' }\`.
- \`site24x7.callOperation(operationId, args)\` — flat lookup by id.
- \`site24x7.request({ method, path, query?, body?, version?, zaaid? })\` — raw HTTP escape hatch (e.g. for endpoints not yet in the spec).
- \`site24x7.spec\` — \`{ title, sourceUrl, generatedAt, operationCount }\` for diagnostics.
- \`site24x7.listCustomers()\` — MSP/BU customer enumeration (uses /api/short/msp/customers or /api/short/bu/business_units based on accountType).
- \`site24x7.withCustomer(zaaid, async fn)\` — run \`fn(site24x7)\` with the closure scoped to a customer. Restores the previous zaaid on exit, even on throw. **Must be awaited.**
- \`site24x7.zaaid\` — the currently active zaaid (or \`undefined\`).

Operations are async — use \`await\`. Top-level \`await\` is not supported; wrap in an async IIFE:

\`\`\`javascript
(async () => {
  const status = await site24x7.request({ method: 'GET', path: '/api/current_status' });
  return status;
})()
\`\`\`

## MSP recipe (fan out over customers)

\`\`\`javascript
(async () => {
  const customers = await site24x7.listCustomers();
  const out = [];
  for (const c of customers) {
    const status = await site24x7.withCustomer(c.zaaid, async (s) => {
      return s.request({ method: 'GET', path: '/api/current_status' });
    });
    out.push({ name: c.name, zaaid: c.zaaid, down: status?.monitors_status?.down ?? 0 });
  }
  return out;
})()
\`\`\`

## Errors

Errors are prefixed with a structured tag:

- \`[site24x7.HttpError] HTTP 403 GET /api/users (operation requires scope(s) \\\`Site24x7.Admin.Read\\\` — confirm your refresh token grants them)\`
- \`[site24x7.MissingZaaidError] operation "..." requires a zaaid in scope (operation mspOnly=true). Hint: call site24x7.listCustomers() and wrap the call in site24x7.withCustomer(zaaid, ...).\`
- \`[site24x7.MissingCredentialsError] ...\` when no Zoho OAuth credentials are configured
- \`[site24x7.UnknownOperationError] ...\` when the operationId doesn't exist in the spec

## Limits

- Per-execute API call ceiling (default 50, configurable via \`SITE24X7_MAX_CALLS_PER_EXECUTE\`).
- Sandbox memory + 30 s deadline.
- Credentials never enter the sandbox.
- Site24x7 enforces its own per-token rate limit (~10 req/s on most plans). 429 triggers one polite retry.
`;

export interface CreateServerOptions {
  spec: ProcessedSpec;
  /** Function called per `site24x7_execute` request to obtain the TenantContext. */
  tenantResolver: () => TenantContext | Promise<TenantContext>;
  /** Shared HTTP client (one per process). */
  client: Site24x7HttpClient;
  /** Sandbox limits override. */
  limits?: Partial<SandboxLimits>;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
  };
  name?: string;
  version?: string;
}

export function createMcpServer(options: CreateServerOptions): McpServer {
  const {
    spec,
    tenantResolver,
    client,
    limits,
    logger,
    name = 'site24x7-code-mode-mcp',
    version = SERVER_VERSION,
  } = options;

  const server = new McpServer(
    { name, version },
    {
      capabilities: { tools: {} },
      instructions: [
        'Site24x7 Code-Mode MCP Server.',
        `site24x7: ${spec.title} — ${String(spec.operations.length)} operations across ${String(
          spec.operationsByTag.size,
        )} tags (spec generated ${spec.generatedAt}).`,
        '',
        'Workflow: use `site24x7_search` to find the operationIds you need, then call them via `site24x7_execute`.',
        'Operations are scope-gated — 403 errors will name the required Site24x7 scope.',
        'MSP / BU? Use site24x7.listCustomers() + site24x7.withCustomer(zaaid, ...) inside execute.',
      ].join('\n'),
    },
  );

  const searchExecutor = new SearchExecutor({ spec });

  server.registerTool(
    'site24x7_search',
    {
      title: 'Search Site24x7 API spec',
      description: SEARCH_TOOL_DESCRIPTION,
      inputSchema: {
        code: z
          .string()
          .describe(
            'JavaScript code to execute against the bundled spec. The final expression is returned.',
          ),
      },
    },
    async ({ code }) => {
      logger?.info(`[site24x7_search] ${String(code.length)} chars`);
      if (code.length > MAX_CODE_SIZE) {
        return errorResult(
          `Code too large (${String(code.length)} chars, max ${String(MAX_CODE_SIZE)}).`,
        );
      }
      try {
        const result = await searchExecutor.execute(code);
        logger?.info(
          `[site24x7_search] ${result.ok ? 'ok' : 'error'} ${String(result.durationMs)}ms`,
        );
        return formatToolResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'site24x7_execute',
    {
      title: 'Execute Site24x7 API calls',
      description: EXECUTE_TOOL_DESCRIPTION,
      inputSchema: {
        code: z
          .string()
          .describe(
            'JavaScript code to execute against the live Site24x7 API. Wrap async work in an IIFE.',
          ),
      },
    },
    async ({ code }) => {
      logger?.info(`[site24x7_execute] ${String(code.length)} chars`);
      if (code.length > MAX_CODE_SIZE) {
        return errorResult(
          `Code too large (${String(code.length)} chars, max ${String(MAX_CODE_SIZE)}).`,
        );
      }

      let tenant: TenantContext;
      try {
        tenant = await tenantResolver();
      } catch (err) {
        return errorResult(
          `Failed to resolve tenant credentials: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const executor = new ExecuteExecutor({
        tenant,
        spec,
        client,
        ...(limits ? { limits } : {}),
      });

      try {
        const result = await executor.execute(code);
        logger?.info(
          `[site24x7_execute] ${result.ok ? 'ok' : 'error'} ${String(result.durationMs)}ms ${String(result.callsMade ?? 0)} calls (zone=${tenant.zone}${tenant.zaaid ? `, zaaid=${tenant.zaaid}` : ''})`,
        );
        return formatToolResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  return server;
}

function errorResult(message: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function formatToolResult(result: ExecuteResult): {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
} {
  const parts: Array<{ type: 'text'; text: string }> = [];

  if (result.warnings.length > 0) {
    parts.push({
      type: 'text',
      text: `--- Warnings ---\n${result.warnings.map((w) => `[warn] ${w}`).join('\n')}`,
    });
  }
  if (result.logs.length > 0) {
    parts.push({
      type: 'text',
      text: `--- Console Output ---\n${result.logs.map((l) => `[${l.level}] ${l.message}`).join('\n')}`,
    });
  }
  if (result.ok) {
    let dataStr =
      result.data !== undefined
        ? typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data, null, 2)
        : '(no return value)';
    if (dataStr.length > MAX_RESULT_SIZE) {
      const total = dataStr.length;
      dataStr =
        dataStr.slice(0, MAX_RESULT_SIZE) +
        `\n\n--- TRUNCATED (${String(total)} chars total, showing first ${String(MAX_RESULT_SIZE)}) ---` +
        '\nTip: filter, paginate, or select specific fields to reduce size.';
    }
    parts.push({ type: 'text', text: dataStr });
  } else {
    parts.push({ type: 'text', text: `Error: ${result.error ?? 'Unknown error'}` });
  }

  const meta = [`--- Executed in ${String(result.durationMs)}ms`];
  if (typeof result.callsMade === 'number' && result.callsMade > 0) {
    meta.push(`${String(result.callsMade)} API calls`);
  }
  parts.push({ type: 'text', text: `${meta.join(' · ')} ---` });

  return { content: parts, isError: !result.ok };
}
