#!/usr/bin/env node
/**
 * Site24x7 Code-Mode MCP Server — entry point.
 *
 * Lifecycle:
 *   1. Validate env config (Zod).
 *   2. Pre-warm QuickJS WASM module.
 *   3. Load the bundled Site24x7 spec.
 *   4. Build the shared HTTP + OAuth client.
 *   5. Build MCP server with `site24x7_search` + `site24x7_execute` tools.
 *   6. Start the chosen transport (stdio or HTTP).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type AppConfig } from './config.js';
import { buildClient } from './client/factory.js';
import { getQuickJSModule } from './sandbox/executor.js';
import { loadBundledSpec, specSummary } from './spec/index.js';
import {
  buildContextFromEnv,
  buildContextFromHeaders,
} from './tenant/context.js';
import type { TenantContext } from './types/tenant.js';
import { createMcpServer } from './server/server.js';
import { startHttpTransport, startStdioTransport } from './server/transport.js';
import { currentRequestScope } from './server/request-context.js';

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'package.json'),
    resolve(here, '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      // Try next candidate.
    }
  }
  return '0.0.0-unknown';
}

const SERVER_VERSION = readPackageVersion();

const logger = {
  info: (msg: string, ...args: unknown[]): void => {
    console.error(`[INFO] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]): void => {
    console.error(`[WARN] ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]): void => {
    console.error(`[ERROR] ${msg}`, ...args);
  },
};

async function main(): Promise<void> {
  logger.info(`Site24x7 Code-Mode MCP Server v${SERVER_VERSION} starting...`);
  const config: AppConfig = loadConfig();
  logger.info(`Transport: ${config.mcpTransport}`);
  logger.info(`Default zone: ${config.envZone}`);
  logger.info(`Account type: ${config.envAccountType}`);

  const wasmStart = Date.now();
  await getQuickJSModule();
  logger.info(`QuickJS WASM initialized in ${String(Date.now() - wasmStart)}ms`);

  const spec = await loadBundledSpec();
  const sum = specSummary(spec);
  logger.info(
    `Loaded bundled spec: ${sum.title} (${String(sum.operations)} operations across ${String(sum.tags)} tags; ` +
      `${String(sum.mspOnly)} MSP-only, ${String(sum.buOnly)} BU-only; generated ${sum.generatedAt})`,
  );

  const { http: client, oauth } = buildClient();
  oauth.clearAll();

  const tenantResolver = (): TenantContext => {
    const scope = currentRequestScope();
    if (scope) return buildContextFromHeaders(scope.headers);
    return buildContextFromEnv(config);
  };

  const server = createMcpServer({
    spec,
    tenantResolver,
    client,
    limits: {
      maxCallsPerExecute: config.maxCallsPerExecute,
      timeoutMs: config.executeTimeoutMs,
    },
    logger,
    name: 'site24x7-code-mode-mcp',
    version: SERVER_VERSION,
  });

  if (config.mcpTransport === 'stdio') {
    await startStdioTransport(server, logger);
  } else {
    await startHttpTransport(
      server,
      {
        port: config.mcpHttpPort,
        allowedOrigins: config.mcpHttpAllowedOrigins,
      },
      logger,
    );
  }
}

main().catch((err: unknown) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
