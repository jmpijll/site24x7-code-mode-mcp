/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/require-await */
/**
 * Cloudflare Workers entry — Site24x7 Code-Mode MCP (cloud-hosted variant).
 *
 * NOTE: This is a SCAFFOLD. Wrangler-typed bindings (`WorkerLoader`,
 * `Request`/`Response`/`RequestInit`, `ExecutionContext`, `ExportedHandler`)
 * come from `@cloudflare/workers-types` which the linter sees as `error`/`any`
 * until a Worker build wires them in with `wrangler types`. The lint
 * suppression at the file level prevents those scaffolding errors from
 * gating CI; revisit when this entry becomes a first-class deployment target.
 *
 * Differences from the Node entry:
 *   - The sandbox would be a real V8 Worker isolate (Worker Loader binding),
 *     with `globalOutbound: null` blocking any direct outbound network from
 *     the sandbox; all Site24x7 calls must go through a host-side
 *     `request()` that injects `Authorization: Zoho-oauthtoken <access>`,
 *     `Accept: application/json; version=2.0`, and (when the request carries
 *     `X-Site24x7-Zaaid`) `Cookie: zaaid=<id>`. The cookie is the upstream's
 *     first-class MSP / Business Unit scoping mechanism — see
 *     [../AGENTS.md](../AGENTS.md) §6.3.
 *   - No live OpenAPI fetch: Site24x7 publishes no OpenAPI document. The
 *     bundled spec at `src/spec/site24x7-fallback.json` is the source of
 *     truth and would need to be embedded via Workers Assets or a KV
 *     binding for the cf entry to mount it.
 *   - One refresh token = one Zoho OAuth identity = one Site24x7 zone.
 *     Multi-zone deployments register one Worker (or one route per zone).
 *
 * Per-request multi-tenant credentials are read from headers exactly like
 * the Node HTTP transport — see [../docs/multi-tenant.md](../docs/multi-tenant.md).
 *
 * The full transport + sandbox wiring is intentionally a follow-up; this
 * scaffold validates credentials and returns 501 with a pointer to
 * [./README.md](./README.md).
 */

interface Env {
  /** Worker Loader binding for the dynamic sandbox (reserved for the follow-up). */
  LOADER: WorkerLoader;
  /** Defaults for single-tenant deployments. Operators may set these as Worker secrets. */
  DEFAULT_CLIENT_ID?: string;
  DEFAULT_CLIENT_SECRET?: string;
  DEFAULT_REFRESH_TOKEN?: string;
  DEFAULT_ZONE?: string;
  DEFAULT_ZAAID?: string;
  DEFAULT_ACCOUNT_TYPE?: string;
}

/**
 * Inlined subset of `KNOWN_SITE24X7_ZONES` (`src/types/zones.ts`). The cf
 * entry intentionally avoids importing from `src/` because the Worker is
 * built independently. Keep this table in sync with the canonical one in
 * `src/types/zones.ts`; mismatches will surface as 401 / 502 against the
 * wrong Zoho data center.
 */
const ZONES: Record<string, { accountsBaseUrl: string; apiBaseUrl: string }> = {
  com: { accountsBaseUrl: 'https://accounts.zoho.com', apiBaseUrl: 'https://www.site24x7.com' },
  eu: { accountsBaseUrl: 'https://accounts.zoho.eu', apiBaseUrl: 'https://www.site24x7.eu' },
  in: { accountsBaseUrl: 'https://accounts.zoho.in', apiBaseUrl: 'https://www.site24x7.in' },
  'com.au': {
    accountsBaseUrl: 'https://accounts.zoho.com.au',
    apiBaseUrl: 'https://www.site24x7.net.au',
  },
  cn: { accountsBaseUrl: 'https://accounts.zoho.com.cn', apiBaseUrl: 'https://www.site24x7.cn' },
  jp: { accountsBaseUrl: 'https://accounts.zoho.jp', apiBaseUrl: 'https://app.site24x7.jp' },
  ca: { accountsBaseUrl: 'https://accounts.zohocloud.ca', apiBaseUrl: 'https://www.site24x7.ca' },
  uk: { accountsBaseUrl: 'https://accounts.zoho.uk', apiBaseUrl: 'https://app.site24x7.uk' },
  ae: { accountsBaseUrl: 'https://accounts.zoho.ae', apiBaseUrl: 'https://app.site24x7.ae' },
  sa: { accountsBaseUrl: 'https://accounts.zoho.sa', apiBaseUrl: 'https://www.site24x7.sa' },
};

const KNOWN_ZONES = Object.keys(ZONES);

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', namespace: 'site24x7' });
    }

    if (url.pathname !== '/mcp') {
      return new Response('Not found', { status: 404 });
    }

    const credsResult = readCreds(request, env);
    if ('error' in credsResult) {
      return Response.json({ error: credsResult.error }, { status: 401 });
    }

    return Response.json(
      {
        error:
          'Cloudflare Workers transport adapter is a scaffold. ' +
          'The Site24x7 cf entry validates credentials but does not yet wire up ' +
          'the MCP sandbox: the bundled spec (src/spec/site24x7-fallback.json) ' +
          'must be embedded via Workers Assets or a KV binding, and the MCP SDK ' +
          'transport must be adapted to Web Request/Response. ' +
          'Use the Node entry (npm start) for a fully-working multi-tenant HTTP server. ' +
          'See cf-worker/README.md for adapter status.',
      },
      { status: 501 },
    );
  },
} satisfies ExportedHandler<Env>;

interface Creds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  zone: string;
  accountsBaseUrl: string;
  apiBaseUrl: string;
  zaaid?: string;
  accountType: 'standard' | 'msp' | 'bu';
}

function readCreds(request: Request, env: Env): Creds | { error: string } {
  const clientId = request.headers.get('x-site24x7-client-id') ?? env.DEFAULT_CLIENT_ID ?? '';
  const clientSecret =
    request.headers.get('x-site24x7-client-secret') ?? env.DEFAULT_CLIENT_SECRET ?? '';
  const refreshToken =
    request.headers.get('x-site24x7-refresh-token') ?? env.DEFAULT_REFRESH_TOKEN ?? '';
  const zone = (request.headers.get('x-site24x7-zone') ?? env.DEFAULT_ZONE ?? '').trim();

  const missing: string[] = [];
  if (!clientId) missing.push('X-Site24x7-Client-Id');
  if (!clientSecret) missing.push('X-Site24x7-Client-Secret');
  if (!refreshToken) missing.push('X-Site24x7-Refresh-Token');
  if (!zone) missing.push('X-Site24x7-Zone');
  if (missing.length > 0) {
    return {
      error:
        `Missing required Site24x7 credential header(s): ${missing.join(', ')}. ` +
        `Provide them per-request as X-Site24x7-* headers, or set the matching ` +
        `DEFAULT_* Worker vars / secrets. See ../README.md for the auth model.`,
    };
  }

  const endpoints = ZONES[zone];
  if (!endpoints) {
    return {
      error:
        `Unknown Site24x7 zone "${zone}". Expected one of: ${KNOWN_ZONES.join(', ')}. ` +
        `See ../README.md for the zone table.`,
    };
  }

  const zaaidRaw = request.headers.get('x-site24x7-zaaid') ?? env.DEFAULT_ZAAID ?? '';
  const accountTypeRaw = (
    request.headers.get('x-site24x7-account-type') ??
    env.DEFAULT_ACCOUNT_TYPE ??
    'standard'
  ).toLowerCase();
  const accountType: Creds['accountType'] =
    accountTypeRaw === 'msp' || accountTypeRaw === 'bu' ? accountTypeRaw : 'standard';

  return {
    clientId,
    clientSecret,
    refreshToken,
    zone,
    accountsBaseUrl: endpoints.accountsBaseUrl,
    apiBaseUrl: endpoints.apiBaseUrl,
    zaaid: zaaidRaw || undefined,
    accountType,
  };
}
