/**
 * Pure markdown → BundledSpec.operations parser.
 *
 * Doc structure assumptions (validated against the live page on 2026-06-12):
 *
 *   # H1                    ← operation group (Monitors, MSP, Business Units, …)
 *   ## H2                   ← single operation (e.g. "Create Monitor")
 *     description paragraph(s)
 *     <method> <path>       ← e.g. "POST /monitors" or "GET /api/device_key"
 *     ```                   ← optional curl example
 *     ...
 *     ```
 *     ```                   ← optional response example
 *     ...
 *     ```
 *     `oauthscope : Site24x7.Admin.Create[, ...]`
 *     ### Request/Body Params (table)
 *     ### Response Attributes (table)
 *
 * The parser is intentionally lenient. Sections without a recognised
 * method+path line (e.g. the "Introduction", "Getting Started", "Errors"
 * meta-sections, or constant-value tables) are silently skipped.
 *
 * Bump SCRAPER_VERSION whenever this file changes meaningfully — the
 * loader uses it as part of cache-key invalidation.
 */

import type { HttpMethod, ParamSpec, RawOperation } from '../../src/types/spec.js';

export const SCRAPER_VERSION = '1';

const HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

const METHOD_PATH_REGEX = /^\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/?[A-Za-z0-9_./{}:?=&\-]+)/;
const OAUTHSCOPE_REGEX = /`?\s*oauthscope\s*:\s*([A-Za-z0-9_,.\s|]+?)\s*`?\s*$/i;
const VERSION_NOTE_REGEX = /version\s*=?\s*["']?(\d+\.\d+)["']?/i;
const ALT_OAUTHSCOPE_REGEX = /\bSite24x7\.[A-Za-z]+\.[A-Za-z]+\b/g;

/** Group H1 → { mspOnly, buOnly } classification. */
const GROUP_CLASSIFIERS: Array<{ matcher: RegExp; mspOnly?: boolean; buOnly?: boolean }> = [
  { matcher: /^MSP( |$)/i, mspOnly: true },
  { matcher: /^Business Unit/i, buOnly: true },
];

interface Section {
  group: string;
  title: string;
  bodyLines: string[];
}

function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  let currentGroup = 'general';
  let current: Section | null = null;
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      currentGroup = (h1[1] ?? '').trim();
      if (current) {
        sections.push(current);
        current = null;
      }
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      if (current) sections.push(current);
      current = { group: currentGroup, title: (h2[1] ?? '').trim(), bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function classifyGroup(group: string, path: string): { mspOnly: boolean; buOnly: boolean } {
  let mspOnly = false;
  let buOnly = false;
  for (const c of GROUP_CLASSIFIERS) {
    if (c.matcher.test(group)) {
      if (c.mspOnly) mspOnly = true;
      if (c.buOnly) buOnly = true;
    }
  }
  if (path.includes('/msp/') || path.includes('/short/msp/')) mspOnly = true;
  if (path.includes('/bu/') || path.includes('/short/bu/')) buOnly = true;
  return { mspOnly, buOnly };
}

function normalisePath(rawPath: string): string {
  // Strip query string if present in the heading (we re-attach via params).
  let p = rawPath.split('?')[0] ?? rawPath;
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.startsWith('/api/')) p = `/api${p}`;
  // Convert {foo} → :foo for our route shape.
  p = p.replaceAll(/\{([^}/]+)\}/g, ':$1');
  return p;
}

function tagFromGroup(group: string): string {
  return (
    group
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'general'
  );
}

function sanitiseId(method: HttpMethod, path: string): string {
  const body = path
    .replace(/^\/api\//, '')
    .replaceAll('/', '_')
    .replaceAll(':', '')
    .replace(/[^A-Za-z0-9_]/g, '');
  return `${method.toLowerCase()}_${body}` || `${method.toLowerCase()}_root`;
}

function extractScopes(bodyLines: string[]): string[] {
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const stripped = line.replace(/`/g, '').trim();
    if (/^oauthscope/i.test(stripped)) {
      const m = OAUTHSCOPE_REGEX.exec(stripped);
      if (m && m[1]) {
        const scopes: string[] = [];
        for (const candidate of m[1].split(/[,\s|]+/)) {
          if (/^Site24x7\.[A-Za-z]+\.[A-Za-z]+$/.test(candidate)) scopes.push(candidate);
        }
        if (scopes.length > 0) return Array.from(new Set(scopes));
      }
      // Some sections inline the scope without the keyword; pick scope-like tokens.
      const alt = stripped.match(ALT_OAUTHSCOPE_REGEX);
      if (alt && alt.length > 0) return Array.from(new Set(alt));
    }
  }
  return [];
}

function extractVersion(bodyLines: string[]): string | undefined {
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (/Note\s*:\s*API\s+Version/i.test(line)) {
      const m = VERSION_NOTE_REGEX.exec(line);
      if (m && m[1]) return m[1];
    }
  }
  return undefined;
}

function extractDescription(bodyLines: string[]): string | undefined {
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (METHOD_PATH_REGEX.test(line)) continue;
    if (line.startsWith('```')) continue;
    if (line.startsWith('### ')) continue;
    if (/^oauthscope/i.test(line.replace(/`/g, ''))) continue;
    if (/^Request Example/i.test(line)) continue;
    if (/^Response Example/i.test(line)) continue;
    if (line.startsWith('|')) continue;
    return line.slice(0, 400);
  }
  return undefined;
}

/**
 * Extract parameters from any "### Body Params" / "### Request Body Params" /
 * "### Query Params" / "### Header Params" tables. We do NOT include
 * "Response Attributes" tables — those describe responses, not requests.
 *
 * The docs sometimes label parameters as "Mandatory" inside the description
 * cell; we use that as the required-flag signal.
 */
function extractParams(bodyLines: string[]): ParamSpec[] {
  const params: ParamSpec[] = [];
  let currentLocation: ParamSpec['in'] | undefined;
  let inTable = false;
  for (const raw of bodyLines) {
    const line = raw.trim();
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      const heading = (h3[1] ?? '').toLowerCase();
      if (heading.includes('response')) {
        currentLocation = undefined;
        inTable = false;
        continue;
      }
      if (heading.includes('body') || heading.includes('payload')) currentLocation = 'body';
      else if (heading.includes('query')) currentLocation = 'query';
      else if (heading.includes('path')) currentLocation = 'path';
      else if (heading.includes('header')) currentLocation = 'header';
      else if (heading.includes('attribute') || heading.includes('param')) currentLocation = 'body';
      else currentLocation = undefined;
      inTable = false;
      continue;
    }
    if (currentLocation === undefined) continue;
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    // First row is the header; second is the separator. Detect & skip them.
    if (cells.some((c) => /^[-:]+$/.test(c))) {
      inTable = true;
      continue;
    }
    if (!inTable) {
      // The header row — remember its column order then continue.
      inTable = true;
      continue;
    }
    const name = cells[0];
    if (!name || /^[a-z_]+$/i.exec(name) === null) continue;
    const typeCell = cells[1] ?? '';
    const descCell = cells.slice(2).join(' | ');
    const required = /\bmandatory\b/i.test(descCell);
    params.push({
      name,
      in: currentLocation,
      required,
      type: typeCell || undefined,
      description: descCell.slice(0, 400) || undefined,
    });
  }
  // Deduplicate by name (path always wins over body if both present).
  const seen = new Map<string, ParamSpec>();
  for (const p of params) {
    const existing = seen.get(p.name);
    if (!existing) seen.set(p.name, p);
    else if (p.in === 'path' && existing.in !== 'path') seen.set(p.name, p);
  }
  return [...seen.values()];
}

export function parseMarkdownSpec(markdown: string): RawOperation[] {
  const sections = splitSections(markdown);
  const operations: RawOperation[] = [];
  const skipped: string[] = [];

  for (const section of sections) {
    if (/-\s*POST\s+not\s+allowed/i.test(section.title)) {
      // The docs label many AWS read-only endpoints this way. We still want
      // them — strip the suffix from the heading.
      section.title = section.title.replace(/\s*-\s*POST\s+not\s+allowed\s*$/i, '');
    }
    const methodPathLine = section.bodyLines
      .map((l) => l.trim())
      .find((l) => METHOD_PATH_REGEX.test(l));
    if (!methodPathLine) {
      skipped.push(`${section.group} → ${section.title}`);
      continue;
    }
    const m = METHOD_PATH_REGEX.exec(methodPathLine);
    if (!m || !m[1] || !m[2]) continue;
    const method = m[1] as HttpMethod;
    if (!HTTP_METHODS.has(method)) continue;
    const rawPath = m[2];
    const path = normalisePath(rawPath);
    const { mspOnly, buOnly } = classifyGroup(section.group, path);
    const description = extractDescription(section.bodyLines);
    const operationVersion = extractVersion(section.bodyLines);
    const operation: RawOperation = {
      operationId: sanitiseId(method, path),
      method,
      path,
      ...(operationVersion ? { version: operationVersion } : {}),
      summary: section.title,
      tag: tagFromGroup(section.group),
      ...(description ? { description } : {}),
      requiredScopes: extractScopes(section.bodyLines),
      mspOnly,
      buOnly,
      params: extractParams(section.bodyLines),
      docUrl: `https://www.site24x7.com/help/api/#${slug(section.title)}`,
    };
    operations.push(operation);
  }

  // De-duplicate by operationId; if two sections collide on the same id, keep
  // the one with more parameters (richer doc coverage).
  const seen = new Map<string, RawOperation>();
  for (const op of operations) {
    const existing = seen.get(op.operationId);
    if (!existing || op.params.length > existing.params.length) seen.set(op.operationId, op);
  }
  const deduped = [...seen.values()].sort((a, b) => a.operationId.localeCompare(b.operationId));

  if (skipped.length > 0) {
    console.warn(
      `[update-spec] skipped ${String(skipped.length)} non-operation sections (no method+path line)`,
    );
  }
  return deduped;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
