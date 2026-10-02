import type { SearchSource } from '../../types.js';
import type { AgentTool } from './types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SEARCH_TIMEOUT = 8000;
const PAGE_TIMEOUT = 5000;
const PAGE_CHARS = 1500;

interface SearchHit extends SearchSource {
  content?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ' };

const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });

const textOf = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const MAX_REDIRECTS = 5;

/**
 * Follows redirects by hand so cookies set along the way are sent back: search engines' anti-bot
 * layers (e.g. 360's WZWS) answer the first request with a cookie plus a redirect to the same URL,
 * which fetch's built-in redirect handling loops on because it drops the cookie.
 */
async function fetchText(url: string, timeout: number, signal?: AbortSignal) {
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const cookies = new Map<string, string>();
  let res: Response;
  for (let hop = 0; ; hop++) {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,*/*',
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      redirect: 'manual',
      signal: abort,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) break;
    if (hop >= MAX_REDIRECTS) throw new Error('重定向次数过多');
    url = new URL(location, url).toString();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type && !/html|text/i.test(type)) throw new Error('非网页内容');
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

async function searchDuckDuckGo(query: string, count: number, signal?: AbortSignal): Promise<SearchHit[]> {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`, SEARCH_TIMEOUT, signal);
  if (html.includes('anomaly-modal')) throw new Error('触发了人机验证');
  const hits: SearchHit[] = [];
  for (const [, block] of html.matchAll(/<div class="result results_links[\s\S]*?<div class="clear"><\/div>/g)) {
    const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    let url = decodeEntities(link[1]);
    const redirected = /[?&]uddg=([^&]+)/.exec(url)?.[1];
    if (redirected) url = decodeURIComponent(redirected);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:/.test(url)) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '';
    hits.push({ title: textOf(link[2]), url, site: siteOf(url), snippet: textOf(snippet) });
    if (hits.length >= count) break;
  }
  return hits;
}

async function search360(query: string, count: number, signal?: AbortSignal): Promise<SearchHit[]> {
  const html = await fetchText(`https://www.so.com/s?q=${encodeURIComponent(query)}`, SEARCH_TIMEOUT, signal);
  const hits: SearchHit[] = [];
  const titles = [...html.matchAll(/<h3 class="res-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)];
  titles.forEach((m, i) => {
    if (hits.length >= count) return;
    const link = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);
    if (!link) return;
    const url = decodeEntities(/data-mdurl="([^"]+)"/.exec(m[1])?.[1] ?? link[1]);
    if (!/^https?:/.test(url) || /(^|\.)so\.com\//.test(url)) return;
    const next = titles[i + 1]?.index ?? m.index! + 4000;
    const tail = html.slice(m.index! + m[0].length, Math.min(next, m.index! + 4000));
    const snippet = /class="(?:res-desc|res-comm-con|res-rich[^"]*)"[^>]*>([\s\S]*?)<\/(?:p|div)>/.exec(tail)?.[1] ?? '';
    hits.push({ title: textOf(link[2]), url, site: siteOf(url), snippet: textOf(snippet).slice(0, 300) });
  });
  return hits;
}

/** Bing wraps some result links as bing.com/ck/a?...&u=a1<base64url target>. */
function unwrapBingUrl(url: string) {
  const u = /[?&]u=a1([^&]+)/.exec(url)?.[1];
  if (!u) return url;
  try {
    return Buffer.from(decodeURIComponent(u), 'base64url').toString('utf8');
  } catch {
    return url;
  }
}

async function searchBing(query: string, count: number, signal?: AbortSignal): Promise<SearchHit[]> {
  const html = await fetchText(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN`, SEARCH_TIMEOUT, signal);
  const hits: SearchHit[] = [];
  for (const [, block] of html.matchAll(/<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g)) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const url = unwrapBingUrl(decodeEntities(link[1]));
    if (!/^https?:/.test(url)) continue;
    const snippet = /<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1]
      ?? /class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1]
      ?? '';
    hits.push({ title: textOf(link[2]), url, site: siteOf(url), snippet: textOf(snippet).slice(0, 300) });
    if (hits.length >= count) break;
  }
  return hits;
}

// Results are interleaved in this order, so the engine with the most relevant Chinese results goes first.
const ENGINES = [
  { name: '360', search: search360 },
  { name: 'bing', search: searchBing },
  { name: 'duckduckgo', search: searchDuckDuckGo },
];

async function readPage(url: string, signal?: AbortSignal) {
  const html = await fetchText(url, PAGE_TIMEOUT, signal);
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return textOf(
    body
      .replace(/<(script|style|noscript|svg|nav|footer|header|iframe|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h\d|tr|br)>/gi, '\n'),
  ).slice(0, PAGE_CHARS);
}

export async function webSearch(query: string, count = 6, signal?: AbortSignal): Promise<SearchHit[]> {
  const settled = await Promise.allSettled(ENGINES.map((e) => e.search(query, count, signal)));
  if (signal?.aborted) throw new Error('已取消');
  settled.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[search] ${ENGINES[i].name} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    else if (!r.value.length) console.warn(`[search] ${ENGINES[i].name} returned no results for ${JSON.stringify(query)}`);
  });
  const lists = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (let i = 0; hits.length < count && i < Math.max(...lists.map((l) => l.length)); i++) {
    for (const list of lists) {
      const hit = list[i];
      const key = hit?.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      if (!hit || !key || seen.has(key) || hits.length >= count) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  if (!hits.length && settled.every((r) => r.status === 'rejected')) throw new Error('搜索服务暂时不可用');
  await Promise.all(
    hits.slice(0, 3).map(async (hit) => {
      try {
        const content = await readPage(hit.url, signal);
        if (content.length > 80) hit.content = content;
      } catch {}
    }),
  );
  return hits;
}

export const webSearchTool: AgentTool<{ query: string; count?: number }> = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索工具：实时查询互联网网页，获取最新信息。遇到新闻、天气、价格、赛事、政策、人物近况、产品发布等时效性问题，或你不确定、需要事实核验的问题时调用。' +
        '返回若干搜索结果（标题、链接、摘要，靠前的结果附带网页正文节选）。可以针对不同子问题多次调用，每次使用简洁精准的关键词。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，简洁明确，必要时包含时间、地点等限定词' },
          count: { type: 'integer', description: '返回结果数量，默认 6，最多 10' },
        },
        required: ['query'],
      },
    },
  },
  async execute({ query, count }, { signal }) {
    const q = String(query ?? '').trim();
    if (!q) throw new Error('缺少搜索关键词');
    const hits = await webSearch(q, Math.min(Math.max(Number(count) || 6, 1), 10), signal);
    if (!hits.length) throw new Error('没有找到相关结果');
    return {
      sources: hits.map(({ title, url, site, snippet }) => ({ title, url, site, snippet })),
      content: JSON.stringify({
        query: q,
        searchedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
        results: hits.map((h, i) => ({ index: i + 1, title: h.title, url: h.url, snippet: h.snippet, content: h.content })),
      }),
    };
  },
};
