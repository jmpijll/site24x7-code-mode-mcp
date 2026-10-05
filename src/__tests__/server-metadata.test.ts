import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../server/server.js';
import { buildOperationIndex } from '../spec/index-builder.js';
import { createZohoOAuthClient } from '../auth/zoho-oauth.js';
import { createSite24x7HttpClient } from '../client/http.js';

const packageInfo: unknown = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
if (
  typeof packageInfo !== 'object' ||
  packageInfo === null ||
  !('name' in packageInfo) ||
  typeof packageInfo.name !== 'string' ||
  !('version' in packageInfo) ||
  typeof packageInfo.version !== 'string'
) {
  throw new Error('Invalid package metadata');
}

describe('server metadata', () => {
  it.each([undefined, 'fixture-version'])(
    'advertises package version by default and preserves override %s',
    async (version) => {
      const spec = buildOperationIndex({
        sourceUrl: 'fixture',
        generatedAt: '2026-01-01T00:00:00Z',
        scraperVersion: 'fixture',
        title: 'Metadata fixture',
        operations: [],
      });
      const httpClient = createSite24x7HttpClient({ oauth: createZohoOAuthClient() });
      const server = createMcpServer({
        spec,
        client: httpClient,
        tenantResolver: () => {
          throw new Error('Metadata requests must not resolve credentials');
        },
        ...(version ? { version } : {}),
      });
      const client = new Client({ name: 'metadata-test', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        expect(client.getServerVersion()).toEqual({
          name: packageInfo.name,
          version: version ?? packageInfo.version,
        });
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
});
