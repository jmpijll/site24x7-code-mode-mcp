/**
 * In-process mock Site24x7 + Zoho accounts upstream for integration tests.
 *
 * The mock listens on an ephemeral port and routes:
 *   POST /oauth/v2/token              → returns a synthetic access token
 *   GET  /api/current_status          → returns a status envelope
 *   GET  /api/short/msp/customers     → returns [{ name, zaaid }]
 *   GET  /api/current_status (with Cookie: zaaid=foo) → echoes the zaaid
 *
 * Tests point the client at this mock by passing per-zone URL overrides.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
  /** Headers seen on the last request, lower-cased. */
  lastHeaders: Record<string, string>;
  /** Path seen on the last request. */
  lastPath: string;
}

export async function startMockUpstream(): Promise<MockServerHandle> {
  const handle: MockServerHandle = {
    url: '',
    close: () => Promise.resolve(),
    lastHeaders: {},
    lastPath: '',
  };
  const server: Server = createServer((req, res) => {
    handleMock(req, res, handle);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('mock server address');
  handle.url = `http://127.0.0.1:${String(addr.port)}`;
  handle.close = () => new Promise<void>((r) => server.close(() => { r(); }));
  return handle;
}

function handleMock(req: IncomingMessage, res: ServerResponse, handle: MockServerHandle): void {
  handle.lastPath = req.url ?? '';
  handle.lastHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    handle.lastHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : (v ?? '');
  }
  const url = req.url ?? '/';
  if (url.startsWith('/oauth/v2/token')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'mock-token', expires_in: 3600, token_type: 'Bearer' }));
    return;
  }
  if (url.startsWith('/api/short/msp/customers')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        code: 0,
        message: 'success',
        data: [
          { name: 'Acme Corp', zaaid: '111' },
          { name: 'Globex',    zaaid: '222' },
        ],
      }),
    );
    return;
  }
  if (url.startsWith('/api/current_status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          zaaid_echo: handle.lastHeaders['cookie'] ?? '',
          monitors_status: { up: 10, down: 0, trouble: 0 },
        },
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'mock: no route', path: url }));
}
