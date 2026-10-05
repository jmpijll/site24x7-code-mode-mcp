#!/usr/bin/env tsx
/**
 * Live smoke test against the Site24x7 REST API via the sandbox.
 *
 * READ-ONLY. Drives the site24x7.* sandbox surface end-to-end:
 *   1. GET /api/current_status  — sanity check on Reports.Read
 *   2. GET /api/monitors        — needs Site24x7.Admin.Read or .Reports.Read
 *   3. If accountType=msp/bu, also pull listCustomers() and call
 *      get_current_status with the first zaaid via withCustomer().
 *
 * Credentials (priority: env > 1Password):
 *   SITE24X7_CLIENT_ID
 *   SITE24X7_CLIENT_SECRET
 *   SITE24X7_REFRESH_TOKEN
 *   SITE24X7_ZONE            (com|eu|in|au|jp|ca|cn|gov, default com)
 *   SITE24X7_ZAAID           (optional override, MSP customer zaaid)
 *   SITE24X7_ACCOUNT_TYPE    (standard|msp|bu, default standard)
 *
 * 1Password references (override via OP_*_REF):
 *   OP_S24_CLIENT_ID_REF       = op://AI Agents/Site24x7 Self Client/client_id
 *   OP_S24_CLIENT_SECRET_REF   = op://AI Agents/Site24x7 Self Client/client_secret
 *   OP_S24_REFRESH_TOKEN_REF   = op://AI Agents/Site24x7 Self Client/refresh_token
 *
 * Run:
 *   npm run live-test
 */

import { execSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { buildContextFromEnv } from '../src/tenant/context.js';
import { createZohoOAuthClient } from '../src/auth/zoho-oauth.js';
import { createSite24x7HttpClient } from '../src/client/http.js';
import { loadBundledSpec } from '../src/spec/loader.js';
import { ExecuteExecutor } from '../src/sandbox/execute-executor.js';

const OP_CLIENT_ID_REF =
  process.env['OP_S24_CLIENT_ID_REF'] ?? 'op://AI Agents/Site24x7 Self Client/client_id';
const OP_CLIENT_SECRET_REF =
  process.env['OP_S24_CLIENT_SECRET_REF'] ?? 'op://AI Agents/Site24x7 Self Client/client_secret';
const OP_REFRESH_TOKEN_REF =
  process.env['OP_S24_REFRESH_TOKEN_REF'] ?? 'op://AI Agents/Site24x7 Self Client/refresh_token';

function safeOpRead(ref: string): string | undefined {
  try {
    const out = execSync(`op read ${JSON.stringify(ref)}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function pick(envName: string, opRef: string): string | undefined {
  return process.env[envName] ?? safeOpRead(opRef);
}

async function main(): Promise<void> {
  const clientId = pick('SITE24X7_CLIENT_ID', OP_CLIENT_ID_REF);
  const clientSecret = pick('SITE24X7_CLIENT_SECRET', OP_CLIENT_SECRET_REF);
  const refreshToken = pick('SITE24X7_REFRESH_TOKEN', OP_REFRESH_TOKEN_REF);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Zoho OAuth credentials. Set SITE24X7_CLIENT_ID, SITE24X7_CLIENT_SECRET, ' +
        `SITE24X7_REFRESH_TOKEN env vars or store them at ${OP_CLIENT_ID_REF} etc. ` +
        '(1Password CLI: `op read`).',
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SITE24X7_CLIENT_ID: clientId,
    SITE24X7_CLIENT_SECRET: clientSecret,
    SITE24X7_REFRESH_TOKEN: refreshToken,
    SITE24X7_ZONE: process.env['SITE24X7_ZONE'] ?? 'com',
  };

  const cfg = loadConfig(env);
  const tenant = buildContextFromEnv(env);

  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(
    `[live] zone=${cfg.zone} accountType=${tenant.accountType} zaaid=${tenant.zaaid ?? '(none)'}`,
  );

  const oauth = createZohoOAuthClient({
    onRefresh: (info) => {
      console.error(
        `[live] refreshed token (expires_in=${String(info.expiresIn)}s, zone=${info.zone})`,
      );
    },
  });
  const client = createSite24x7HttpClient({ oauth });
  const spec = await loadBundledSpec();
  console.error(`[live] spec=${spec.title} (${String(spec.operations.length)} ops)`);

  const exec = new ExecuteExecutor({
    tenant,
    spec,
    client,
    limits: { maxCallsPerExecute: 20, timeoutMs: 60_000 },
  });

  const code = `
    var snapshot = { generatedAt: new Date().toISOString(), zaaid: site24x7.zaaid };

    try {
      snapshot.currentStatus = site24x7.request({ method: 'GET', path: '/api/current_status' });
    } catch (e) { snapshot.currentStatusError = String(e); }

    try {
      snapshot.monitors = site24x7.request({ method: 'GET', path: '/api/monitors' });
      if (snapshot.monitors && snapshot.monitors.length !== undefined) {
        snapshot.monitorCount = snapshot.monitors.length;
        snapshot.monitors = snapshot.monitors.slice(0, 3);
      }
    } catch (e) { snapshot.monitorsError = String(e); }

    snapshot.accountType = ${JSON.stringify(tenant.accountType)};
    if (snapshot.accountType === 'msp' || snapshot.accountType === 'bu') {
      try {
        var customers = site24x7.listCustomers();
        snapshot.customerCount = (customers && customers.length) || 0;
        snapshot.firstCustomers = (customers || []).slice(0, 2);
        if (customers && customers[0] && customers[0].zaaid) {
          snapshot.firstCustomerStatus = site24x7.withCustomer(customers[0].zaaid, function(api) {
            try { return api.request({ method: 'GET', path: '/api/current_status' }); }
            catch (e) { return { error: String(e) }; }
          });
        }
      } catch (e) { snapshot.listCustomersError = String(e); }
    }

    snapshot;
  `;

  console.error('[live] running sandbox sweep…');
  const t0 = Date.now();
  const result = await exec.execute(code);
  const elapsed = Date.now() - t0;
  console.error(
    `[live] sandbox done in ${String(elapsed)}ms — ok=${String(result.ok)} calls=${String(result.callsMade)}`,
  );

  console.error('[live] result:');
  console.error(JSON.stringify(result, null, 2));

  if (!result.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('[live] FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
