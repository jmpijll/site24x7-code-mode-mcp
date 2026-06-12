/**
 * Zoho / Site24x7 data-center routing. Source of truth for the zone shape
 * the rest of the system passes around.
 *
 * Each zone maps to two host families:
 *   - Zoho accounts host: minting / refreshing OAuth tokens
 *   - Site24x7 API host:  actual REST calls
 *
 * Both pairs were taken verbatim from
 * https://www.site24x7.com/help/api/ ("API Root Endpoint" and
 * "Zoho Accounts Root Endpoint" tables).
 */

export const SITE24X7_ZONES = [
  'com',
  'eu',
  'in',
  'com.au',
  'cn',
  'jp',
  'ca',
  'uk',
  'ae',
  'sa',
] as const;

export type Site24x7Zone = (typeof SITE24X7_ZONES)[number];

export interface ZoneEndpoints {
  /** Zone identifier as used in env / headers. */
  zone: Site24x7Zone;
  /** Zoho accounts host (OAuth). */
  accountsBaseUrl: string;
  /** Site24x7 API root (omits the trailing `/api`). */
  apiBaseUrl: string;
  /** Display name. */
  label: string;
}

export const KNOWN_SITE24X7_ZONES: Record<Site24x7Zone, ZoneEndpoints> = {
  com: {
    zone: 'com',
    accountsBaseUrl: 'https://accounts.zoho.com',
    apiBaseUrl: 'https://www.site24x7.com',
    label: 'United States',
  },
  eu: {
    zone: 'eu',
    accountsBaseUrl: 'https://accounts.zoho.eu',
    apiBaseUrl: 'https://www.site24x7.eu',
    label: 'Europe',
  },
  in: {
    zone: 'in',
    accountsBaseUrl: 'https://accounts.zoho.in',
    apiBaseUrl: 'https://www.site24x7.in',
    label: 'India',
  },
  'com.au': {
    zone: 'com.au',
    accountsBaseUrl: 'https://accounts.zoho.com.au',
    apiBaseUrl: 'https://www.site24x7.net.au',
    label: 'Australia',
  },
  cn: {
    zone: 'cn',
    accountsBaseUrl: 'https://accounts.zoho.com.cn',
    apiBaseUrl: 'https://www.site24x7.cn',
    label: 'China',
  },
  jp: {
    zone: 'jp',
    accountsBaseUrl: 'https://accounts.zoho.jp',
    apiBaseUrl: 'https://app.site24x7.jp',
    label: 'Japan',
  },
  ca: {
    zone: 'ca',
    accountsBaseUrl: 'https://accounts.zohocloud.ca',
    apiBaseUrl: 'https://www.site24x7.ca',
    label: 'Canada',
  },
  uk: {
    zone: 'uk',
    accountsBaseUrl: 'https://accounts.zoho.uk',
    apiBaseUrl: 'https://app.site24x7.uk',
    label: 'United Kingdom',
  },
  ae: {
    zone: 'ae',
    accountsBaseUrl: 'https://accounts.zoho.ae',
    apiBaseUrl: 'https://app.site24x7.ae',
    label: 'United Arab Emirates',
  },
  sa: {
    zone: 'sa',
    accountsBaseUrl: 'https://accounts.zoho.sa',
    apiBaseUrl: 'https://www.site24x7.sa',
    label: 'Saudi Arabia',
  },
};

export function isSite24x7Zone(value: string): value is Site24x7Zone {
  return (SITE24X7_ZONES as readonly string[]).includes(value);
}

export function resolveZoneEndpoints(zone: Site24x7Zone): ZoneEndpoints {
  return KNOWN_SITE24X7_ZONES[zone];
}
