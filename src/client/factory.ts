/**
 * Single-factory wiring for the HTTP client + OAuth client.
 *
 * Keeps the sandbox + server layers from having to know about either
 * concrete class — they accept a `Site24x7HttpClient` and call `request`.
 */

import { createZohoOAuthClient, type ZohoOAuthClient } from '../auth/zoho-oauth.js';
import { createSite24x7HttpClient, type Site24x7HttpClient } from './http.js';

export interface BuiltClient {
  http: Site24x7HttpClient;
  oauth: ZohoOAuthClient;
}

export function buildClient(): BuiltClient {
  const oauth = createZohoOAuthClient();
  const http = createSite24x7HttpClient({ oauth });
  return { http, oauth };
}
