/**
 * scripts/update-spec.ts — refresh `src/spec/site24x7-fallback.json` from
 * the public Site24x7 REST API reference at
 * https://www.site24x7.com/help/api/.
 *
 * Site24x7 publishes no OpenAPI document, so we scrape the HTML into a
 * minimal internal spec format defined in `src/types/spec.ts`.
 *
 * Usage:
 *   tsx scripts/update-spec.ts             # fetch live HTML and parse
 *   tsx scripts/update-spec.ts --cached    # parse from the bundled snapshot
 *
 * The script is intentionally tolerant: sections it can't confidently parse
 * are skipped with a warning, so the bundled spec is always a *subset* of
 * the documented surface that actually compiles. The compiled spec is then
 * cached at `src/spec/site24x7-fallback.json`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadHtml } from 'cheerio';
import { fetch as undiciFetch } from 'undici';
import { parseMarkdownSpec, SCRAPER_VERSION } from './lib/parse-markdown-spec.js';
import type { BundledSpec } from '../src/types/spec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOCS_URL = 'https://www.site24x7.com/help/api/';
const HTML_CACHE_PATH = resolve(__dirname, 'docs-snapshot.html');
const OUT_PATH = resolve(__dirname, '..', 'src', 'spec', 'site24x7-fallback.json');

async function main(): Promise<void> {
  const useCached = process.argv.includes('--cached');
  const html = useCached ? await loadCachedHtml() : await fetchLiveHtml();
  console.warn(`[update-spec] converting ${String(html.length)} chars of HTML...`);
  const markdown = htmlToMarkdown(html);

  console.warn(`[update-spec] parsing ${String(markdown.length)} chars of markdown...`);
  const operations = parseMarkdownSpec(markdown);
  console.warn(`[update-spec] parsed ${String(operations.length)} operations`);

  const bundled: BundledSpec = {
    sourceUrl: useCached ? `cached:${HTML_CACHE_PATH}` : DOCS_URL,
    generatedAt: new Date().toISOString(),
    scraperVersion: SCRAPER_VERSION,
    title: 'Site24x7 REST API',
    operations,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(bundled, null, 2) + '\n', 'utf-8');
  console.warn(`[update-spec] wrote ${OUT_PATH}`);
}

async function loadCachedHtml(): Promise<string> {
  if (!existsSync(HTML_CACHE_PATH)) {
    throw new Error(
      `--cached requested but ${HTML_CACHE_PATH} is missing. Run without --cached to fetch the live HTML (and the file will be cached for next time).`,
    );
  }
  return readFile(HTML_CACHE_PATH, 'utf-8');
}

async function fetchLiveHtml(): Promise<string> {
  console.warn(`[update-spec] fetching ${DOCS_URL} ...`);
  const res = await undiciFetch(DOCS_URL, {
    method: 'GET',
    headers: { 'User-Agent': 'site24x7-code-mode-mcp/update-spec' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${DOCS_URL}: HTTP ${String(res.status)} ${res.statusText}`);
  }
  const html = await res.text();
  // Cache for offline re-runs (gitignored).
  await writeFile(HTML_CACHE_PATH, html, 'utf-8');
  return html;
}

/**
 * Convert the Site24x7 docs HTML to a markdown-like text stream that the
 * regex-based parser can consume. We don't need a full HTML-to-markdown
 * converter — only the elements the parser actually inspects (h1, h2, h3,
 * h4, p, pre/code, table, tr, td, code, li).
 */
export function htmlToMarkdown(html: string): string {
  const $ = loadHtml(html);
  // Drop the TOC sidebar and any chrome that just clutters the output.
  $(
    'nav, aside, header, footer, script, style, .tocify-wrapper, #toc, .top-band, .page-wrapper > .dark-box',
  ).remove();
  const content = $('div.content').first();
  const root = content.length > 0 ? content : $('body').length > 0 ? $('body') : $.root();
  const lines: string[] = [];

  function walk(node: cheerio.Cheerio): void {
    const el = node[0] as { tagName?: string } | undefined;
    const tag = el?.tagName?.toLowerCase();
    const cls = (node.attr('class') ?? '').toLowerCase();
    // Site24x7 puts the operation's "METHOD /path" line in <div class="resourceURI">.
    if (tag === 'div' && cls.includes('resourceuri')) {
      const text = node.text().trim();
      if (text.length > 0) lines.push(text, '');
      return;
    }
    switch (tag) {
      case 'h1':
        lines.push('', `# ${node.text().trim()}`, '');
        break;
      case 'h2':
        lines.push('', `## ${node.text().trim()}`, '');
        break;
      case 'h3':
        lines.push('', `### ${node.text().trim()}`, '');
        break;
      case 'h4':
        lines.push('', `#### ${node.text().trim()}`, '');
        break;
      case 'p': {
        const inlineCode = node.find('> code').first();
        if (inlineCode.length > 0 && inlineCode.text().toLowerCase().includes('oauthscope')) {
          lines.push('`' + inlineCode.text().trim() + '`', '');
        } else {
          lines.push(node.text().trim(), '');
        }
        break;
      }
      case 'pre':
        lines.push('```', node.text().replace(/^\n+|\n+$/g, ''), '```', '');
        break;
      case 'code':
        lines.push('`' + node.text().trim() + '`');
        break;
      case 'blockquote':
        node.children().each((_, child) => {
          walk($(child));
        });
        break;
      case 'table':
        node.find('tr').each((_, tr) => {
          const cells = $(tr)
            .find('th,td')
            .map((__, cell) => $(cell).text().trim().replace(/\s+/g, ' '))
            .get();
          if (cells.length > 0) lines.push('| ' + cells.join(' | ') + ' |');
        });
        lines.push('');
        break;
      case 'li':
        // List items inside the actual content are usually narrative
        // bullets, not navigation. Render them as hyphen-prefixed text.
        lines.push('- ' + node.text().trim().replace(/\s+/g, ' '));
        break;
      default:
        node.children().each((_, child) => {
          walk($(child));
        });
        break;
    }
  }

  root.children().each((_, child) => {
    walk($(child));
  });
  return lines.join('\n');
}

const isMain =
  import.meta.url === `file://${process.argv[1] ?? ''}` ||
  process.argv[1]?.endsWith('update-spec.ts') === true;
if (isMain) {
  main().catch((err: unknown) => {
    console.error('[update-spec] failed:', err);
    process.exit(1);
  });
}
