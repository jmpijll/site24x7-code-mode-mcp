/**
 * Zod-validated env loading. The single source of truth for "what does the
 * server know about its environment?".
 *
 * In stdio mode the env supplies a single `TenantContext` (single-user).
 * In HTTP mode the env may be empty; per-request `X-Site24x7-*` headers
 * supply a fresh `TenantContext` for each call.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SITE24X7_ZONES, type Site24x7Zone } from './types/zones.js';

const TransportEnum = z.enum(['stdio', 'http']);

const AccountTypeEnum = z.enum(['standard', 'msp', 'bu']);

const ZoneEnum = z.enum(SITE24X7_ZONES);

const RawEnvSchema = z.object({
  MCP_TRANSPORT: TransportEnum.default('stdio'),
  MCP_HTTP_PORT: z.coerce.number().int().positive().max(65_535).default(8000),
  MCP_HTTP_ALLOWED_ORIGINS: z.string().default('http://localhost,http://127.0.0.1'),

  SITE24X7_CLIENT_ID: z.string().optional(),
  SITE24X7_CLIENT_SECRET: z.string().optional(),
  SITE24X7_REFRESH_TOKEN: z.string().optional(),
  SITE24X7_ZONE: ZoneEnum.default('com'),
  SITE24X7_ZAAID: z.string().optional(),
  SITE24X7_ACCOUNT_TYPE: AccountTypeEnum.default('standard'),

  SITE24X7_MAX_CALLS_PER_EXECUTE: z.coerce.number().int().positive().default(50),
  SITE24X7_EXECUTE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  SITE24X7_CACHE_DIR: z.string().optional(),
});

export type AppConfig = {
  mcpTransport: 'stdio' | 'http';
  mcpHttpPort: number;
  mcpHttpAllowedOrigins: string[];
  envClientId?: string;
  envClientSecret?: string;
  envRefreshToken?: string;
  envZone: Site24x7Zone;
  envZaaid?: string;
  envAccountType: 'standard' | 'msp' | 'bu';
  maxCallsPerExecute: number;
  executeTimeoutMs: number;
  cacheDir: string;
};

function defaultCacheDir(): string {
  return resolve(homedir(), '.cache', 'site24x7-code-mode-mcp');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = RawEnvSchema.parse(env);
  return {
    mcpTransport: parsed.MCP_TRANSPORT,
    mcpHttpPort: parsed.MCP_HTTP_PORT,
    mcpHttpAllowedOrigins: parsed.MCP_HTTP_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    envClientId: parsed.SITE24X7_CLIENT_ID || undefined,
    envClientSecret: parsed.SITE24X7_CLIENT_SECRET || undefined,
    envRefreshToken: parsed.SITE24X7_REFRESH_TOKEN || undefined,
    envZone: parsed.SITE24X7_ZONE,
    envZaaid: parsed.SITE24X7_ZAAID || undefined,
    envAccountType: parsed.SITE24X7_ACCOUNT_TYPE,
    maxCallsPerExecute: parsed.SITE24X7_MAX_CALLS_PER_EXECUTE,
    executeTimeoutMs: parsed.SITE24X7_EXECUTE_TIMEOUT_MS,
    cacheDir: parsed.SITE24X7_CACHE_DIR || defaultCacheDir(),
  };
}
