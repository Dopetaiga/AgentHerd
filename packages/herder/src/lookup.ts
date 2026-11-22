// Looking things up without a task (ADR 0071): a web search, reading one public page, and the
// facts of a GitHub repository. Read-only by construction: GET requests without cookies or keys,
// only to public hosts, with small timeouts and size limits. A question that takes many steps,
// files or commands still goes to a task.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { num, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

export const LOOKUP_TIMEOUT_MS = 15_000;
/** Bytes read from one response at most; the rest is ignored. */
export const LOOKUP_MAX_BYTES = 2_000_000;
/** Characters of a page the Herder gets by default, and at most. */
export const READ_CHARS = 8_000;
export const READ_CHARS_MAX = 30_000;
export const SEARCH_RESULTS = 8;
export const SEARCH_RESULTS_MAX = 10;
/** A research search waits this long at most for its sources (ADR 0086). */
export const RESEARCH_WAIT_MS = 8_000;
/** Results a research search lists by default: the sources together. */
export const RESEARCH_RESULTS = 12;
/** Where web_search looks: one source, or research = web, GitHub and Hacker News at once. */
export type SearchSource = "web" | "github" | "research";
/** Tools that only read: a turn that used them changed nothing and may be retried. */
export const LOOKUP_TOOL_NAMES: ReadonlySet<string> = new Set(["web_search", "web_read"]);
const MAX_REDIRECTS = 5;
const README_CHARS = 3_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export type Fetch = typeof fetch;
/** The addresses a host name resolves to. */
export type Resolve = (host: string) => Promise<string[]>;

export interface LookupOptions {
  fetch?: Fetch;
  resolve?: Resolve;
  /**
   * The owner's GitHub token (from `gh auth token`), sent only to api.github.com: without it
   * GitHub allows 60 reads an hour from this address. Asked once.
   */
  githubToken?: () => Promise<string | undefined>;
  /** How long a research search waits for its sources; RESEARCH_WAIT_MS unless a test sets it. */
  researchWaitMs?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const defaultResolve: Resolve = async (host) =>
  (await dnsLookup(host, { all: true })).map((a) => a.address);

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

/** True for loopback, private, link-local and other addresses that are not the public internet. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1];
  if (mapped !== undefined) return isPrivateAddress(mapped);
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    return (
      ip === "::" ||
      ip === "::1" ||
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb")
    );
  }
  return false;
}

/** Throws unless `url` is http(s) on a public host. */
export async function checkPublic(url: URL, resolve: Resolve): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`only http and https links can be read, not ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "")
    throw new Error("links with a login are not read");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("only public sites can be read, not this computer or the local network");
  }
  const addresses = isIP(host) === 0 ? await resolve(host) : [host];
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("only public sites can be read, not this computer or the local network");
  }
}

interface Got {
  url: string;
  status: number;
  type: string;
  text: string;
}

/** GET with redirects followed by hand, each hop checked to be public. */
const PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

interface GetOptions {
  fetch: Fetch;
  resolve: Resolve;
  /** Sent as a bearer token to api.github.com only, also after a redirect. */
  github?: string | undefined;
}

async function get(
  link: string,
  opts: GetOptions,
  headers: Record<string, string> = {},
): Promise<Got> {
  let url = new URL(link);
  for (let hop = 0; ; hop++) {
    await checkPublic(url, opts.resolve);
    const auth: Record<string, string> =
      opts.github !== undefined && url.hostname === "api.github.com"
        ? { Authorization: `Bearer ${opts.github}` }
        : {};
    const res = await opts.fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": UA, ...PAGE_HEADERS, ...headers, ...auth },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location !== null) {
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return {
      url: url.toString(),
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      text: await readCapped(res),
    };
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < LOOKUP_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  copy: "©",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<\/?(?:strong|b|em|i|span|mark|code)\b[^>]*>/gi, "").replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** A page's readable text: title, then the body without scripts, styles and markup. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = decodeEntities(
    body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|section|article|ul|ol|tr|table|pre|blockquote|h[1-6])>/gi, "\n")
      .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n${"#".repeat(Number(n))} `)
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

function clip(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more characters; pass maxChars to read more)`
    : text;
}

function linkTarget(href: string, base: string): string {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return "";
  }
}

/** Results on a DuckDuckGo HTML page (ads left out); links point at the real site. */
export function duckResults(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const block of html.split(/<div class="result\b/).slice(1)) {
    if (/result--ad\b/.test(block.slice(0, 200))) continue;
    const a = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (a === null) continue;
    let url = linkTarget(a[1] ?? "", "https://duckduckgo.com/");
    try {
      const u = new URL(url);
      if (u.hostname.endsWith("duckduckgo.com")) {
        const real = u.searchParams.get("uddg");
        if (real === null) continue;
        url = real;
      }
    } catch {
      continue;
    }
    const snippet = stripTags(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(block)?.[1] ?? "",
    );
    const title = stripTags(a[2] ?? "");
    if (title !== "" && url !== "") out.push({ title, url, snippet });
  }
  return out;
}

/** Results on a Bing page; Bing's own click links carry the real one in `u` (base64). */
export function bingResults(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const block of html.split(/<li class="b_algo\b/).slice(1)) {
    const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (a === null) continue;
    let url = linkTarget(a[1] ?? "", "https://www.bing.com/");
    const coded = /[?&]u=a1([^&]+)/.exec(url)?.[1];
    if (coded !== undefined) {
      url = Buffer.from(coded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    }
    if (!/^https?:\/\//.test(url)) continue;
    const snippet = stripTags(/<p\b[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? "");
    const title = stripTags(a[2] ?? "");
    if (title !== "") out.push({ title, url, snippet });
  }
  return out;
}

/** Where a web search goes, in order: the next is tried when one fails or finds nothing. */
const ENGINES: {
  name: string;
  url: (q: string) => string;
  parse: (html: string) => SearchResult[];
}[] = [
  {
    name: "DuckDuckGo",
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: duckResults,
  },
  {
    name: "Bing",
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=en-US&setlang=en`,
    parse: bingResults,
  },
];

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { spdx_id?: string; name?: string } | null;
  pushed_at: string;
  created_at: string;
  homepage: string | null;
  archived: boolean;
}

function day(iso: string | undefined | null): string {
  return iso === undefined || iso === null ? "?" : iso.slice(0, 10);
}

/** Narrower first, then wider: the words as given, without CJK words, the first three, two. */
export function githubQueries(query: string): string[] {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  const latin = words.filter((w) => !/[\u3000-\u9fff\uac00-\ud7af]/.test(w));
  const tries = [words, latin, latin.slice(0, 3), latin.slice(0, 2)];
  const out: string[] = [];
  for (const t of tries) {
    const q = t.join(" ");
    if (q !== "" && !out.includes(q)) out.push(q);
  }
  return out;
}

function repoLine(r: GithubRepo): string {
  const facts = [
    `★ ${r.stargazers_count}`,
    `${r.forks_count} forks`,
    r.language ?? undefined,
    `last push ${day(r.pushed_at)}`,
  ].filter((x) => x !== undefined);
  return `${r.full_name} — ${r.description ?? "(no description)"}\n  ${facts.join(" · ")}\n  ${r.html_url}`;
}

/** owner/repo of a github.com repository link (also its tree/blob pages); undefined otherwise. */
export function githubRepoOf(url: URL): string | undefined {
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
  const [owner, repo, more] = url.pathname.split("/").filter((p) => p !== "");
  if (owner === undefined || repo === undefined) return undefined;
  if (more !== undefined && more !== "tree") return undefined;
  if (["orgs", "users", "settings", "marketplace", "topics", "search"].includes(owner)) {
    return undefined;
  }
  return `${owner}/${repo.replace(/\.git$/, "")}`;
}

/** owner/repo and number of a github.com issue page; undefined otherwise. */
export function githubIssueOf(url: URL): { repo: string; number: number } | undefined {
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
  const [owner, repo, kind, n] = url.pathname.split("/").filter((p) => p !== "");
  if (owner === undefined || repo === undefined || kind !== "issues" || n === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(n)) return undefined;
  return { repo: `${owner}/${repo}`, number: Number(n) };
}

interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  user?: { login?: string } | null;
  repository_url?: string;
  pull_request?: { merged_at?: string | null } | null;
}

interface TimelineEvent {
  event?: string;
  source?: { issue?: GithubIssue };
}

interface IssuePull {
  number: number;
  title: string;
  state: string;
  user: string;
  url: string;
}

function pullOf(i: GithubIssue): IssuePull {
  const merged = i.pull_request?.merged_at !== undefined && i.pull_request?.merged_at !== null;
  return {
    number: i.number,
    title: i.title,
    state: merged ? "merged" : i.state === "closed" ? "closed, not merged" : i.state,
    user: `@${i.user?.login ?? "?"}`,
    url: i.html_url,
  };
}

interface HnStory {
  title: string;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  objectID: string;
  created_at?: string;
}

/** One result of a research search, before results from different sources are merged. */
interface Hit {
  title: string;
  url: string;
  lines: string[];
}

interface SourceRun {
  name: string;
  job: Promise<Hit[]>;
  hits?: Hit[];
  error?: string;
}

function webHit(r: SearchResult): Hit {
  return { title: r.title, url: r.url, lines: r.snippet === "" ? [] : [r.snippet] };
}

function githubHit(r: GithubRepo): Hit {
  const facts = [
    `★ ${r.stargazers_count}`,
    `${r.forks_count} forks`,
    r.language ?? undefined,
    `last push ${day(r.pushed_at)}`,
  ].filter((x) => x !== undefined);
  return {
    title: r.full_name,
    url: r.html_url,
    lines: [r.description ?? "(no description)", facts.join(" · ")],
  };
}

function hnHit(h: HnStory): Hit {
  const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`;
  const url = h.url === undefined || h.url === null || h.url === "" ? discussion : h.url;
  const facts = `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · ${day(h.created_at)}`;
  return {
    title: h.title,
    url,
    lines: url === discussion ? [facts] : [facts, `discussion: ${discussion}`],
  };
}

/** The same page however it is written: no scheme, www, query tracking, # or trailing slash. */
export function sameLink(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    const query = [...u.searchParams]
      .filter(([k]) => !/^(utm_|ref$|source$)/.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${host}${host === "github.com" ? path.toLowerCase() : path}${query === "" ? "" : `?${query}`}`;
  } catch {
    return url.trim();
  }
}

/**
 * Waits until the web and one more source have results, every source is done, or `waitMs`
 * passed. A source still running then is left out (ADR 0086).
 */
async function waitForSources(runs: SourceRun[], waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve) => {
    let left = runs.length;
    const check = () => {
      const done = runs.filter((r) => r.hits !== undefined || r.error !== undefined);
      const withHits = runs.filter((r) => (r.hits?.length ?? 0) > 0);
      const webDone = runs[0] !== undefined && done.includes(runs[0]);
      if (left === 0 || (webDone && withHits.length >= 2)) resolve();
    };
    for (const run of runs) {
      run.job
        .then(
          (hits) => {
            run.hits = hits;
          },
          (error: unknown) => {
            run.error = error instanceof Error ? error.message : String(error);
          },
        )
        .finally(() => {
          left -= 1;
          check();
        });
    }
    timer = setTimeout(resolve, waitMs);
  });
  clearTimeout(timer);
}

function sourceState(run: SourceRun): string {
  if (run.hits !== undefined) return String(run.hits.length);
  if (run.error !== undefined) return "failed";
  return "too slow, left out";
}

/** One list: a link found by several sources once, with all of them, and first (ADR 0086). */
export function mergeHits(
  runs: readonly { name: string; hits?: readonly Hit[] }[],
): (Hit & { sources: string[] })[] {
  const byLink = new Map<string, Hit & { sources: string[]; rank: number }>();
  for (const run of runs) {
    (run.hits ?? []).forEach((hit, i) => {
      const key = sameLink(hit.url);
      const seen = byLink.get(key);
      if (seen === undefined) {
        byLink.set(key, { ...hit, lines: [...hit.lines], sources: [run.name], rank: i });
        return;
      }
      if (!seen.sources.includes(run.name)) seen.sources.push(run.name);
      for (const line of hit.lines) if (!seen.lines.includes(line)) seen.lines.push(line);
      seen.rank = Math.min(seen.rank, i);
    });
  }
  return [...byLink.values()]
    .sort((a, b) => b.sources.length - a.sources.length || a.rank - b.rank)
    .map(({ rank: _rank, ...hit }) => hit);
}

export class Lookup {
  private readonly fetch: Fetch;
  private readonly resolve: Resolve;
  private readonly githubToken: (() => Promise<string | undefined>) | undefined;
  private token: Promise<string | undefined> | undefined;
  private readonly researchWaitMs: number;

  constructor(opts: LookupOptions = {}) {
    this.fetch = opts.fetch ?? fetch;
    this.resolve = opts.resolve ?? defaultResolve;
    this.githubToken = opts.githubToken;
    this.researchWaitMs = opts.researchWaitMs ?? RESEARCH_WAIT_MS;
  }

  private async opts(): Promise<GetOptions> {
    if (this.token === undefined) {
      this.token = (this.githubToken?.() ?? Promise.resolve(undefined)).then(
        (t) => (t === undefined || t.trim() === "" ? undefined : t.trim()),
        () => undefined,
      );
    }
    return { fetch: this.fetch, resolve: this.resolve, github: await this.token };
  }

  async search(query: string, source: SearchSource, limit: number): Promise<string> {
    if (source === "research") return this.research(query, limit);
    const n = Math.max(1, Math.min(SEARCH_RESULTS_MAX, Math.round(limit)));
    if (source === "github") {
      const found = await this.github(query, n);
      if (found.repos.length === 0) return "nothing found";
      const lines = found.repos.map(repoLine).join("\n");
      return found.words === query.trim()
        ? lines
        : `No repository matched every word of "${query.trim()}"; these match "${found.words}":\n${lines}`;
    }
    const results = await this.web(query, n);
    if (results.length === 0) return "nothing found";
    return results
      .map(
        (r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet === "" ? "" : `\n   ${r.snippet}`}`,
      )
      .join("\n");
  }

  /** Web pages: DuckDuckGo, then Bing when it fails or finds nothing. [] when both find nothing. */
  private async web(query: string, n: number): Promise<SearchResult[]> {
    const opts = await this.opts();
    const problems: string[] = [];
    for (const engine of ENGINES) {
      try {
        const got = await get(engine.url(query), opts);
        if (got.status !== 200) {
          problems.push(`${engine.name} answered ${got.status}`);
          continue;
        }
        const results = engine.parse(got.text).slice(0, n);
        if (results.length === 0) {
          problems.push(`${engine.name} found nothing`);
          continue;
        }
        return results;
      } catch (error) {
        problems.push(`${engine.name}: ${(error as Error).message}`);
      }
    }
    if (problems.every((p) => p.endsWith("found nothing"))) return [];
    throw new Error(`the web search did not work (${problems.join("; ")})`);
  }

  /**
   * Web pages for research: DuckDuckGo and Bing at once, the first with results wins. One of
   * them often turns a burst of searches away or takes seconds, and research waits for neither.
   */
  private async webAny(query: string, n: number): Promise<SearchResult[]> {
    const opts = await this.opts();
    const tries = ENGINES.map(async (engine) => {
      const got = await get(engine.url(query), opts);
      if (got.status !== 200) throw new Error(`${engine.name} answered ${got.status}`);
      const results = engine.parse(got.text).slice(0, n);
      if (results.length === 0) throw new Error(`${engine.name} found nothing`);
      return results;
    });
    try {
      return await Promise.any(tries);
    } catch (error) {
      const problems = (error as AggregateError).errors.map((e) => (e as Error).message);
      if (problems.every((p) => p.endsWith("found nothing"))) return [];
      throw new Error(`the web search did not work (${problems.join("; ")})`);
    }
  }

  /** GitHub repositories; a sentence matches nothing, so fewer words are tried in turn. */
  private async github(query: string, n: number): Promise<{ words: string; repos: GithubRepo[] }> {
    const opts = await this.opts();
    for (const words of githubQueries(query)) {
      const got = await get(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(words)}&per_page=${n}`,
        opts,
        { Accept: "application/vnd.github+json" },
      );
      if (got.status !== 200) throw new Error(`GitHub search answered ${got.status}`);
      const items = (JSON.parse(got.text) as { items?: GithubRepo[] }).items ?? [];
      if (items.length > 0) return { words, repos: items.slice(0, n) };
    }
    return { words: query.trim(), repos: [] };
  }

  /** Hacker News stories (Algolia's public search): what people discuss, with points. */
  private async hackerNews(query: string, n: number): Promise<HnStory[]> {
    const got = await get(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${n}`,
      await this.opts(),
    );
    if (got.status !== 200) throw new Error(`Hacker News answered ${got.status}`);
    return ((JSON.parse(got.text) as { hits?: HnStory[] }).hits ?? []).filter(
      (h) => typeof h.title === "string" && h.title !== "",
    );
  }

  /**
   * Research (ADR 0086): web, GitHub and Hacker News at once. Results found by several sources
   * come first; the same link is listed once with every source that found it. It waits for the
   * web and one more source with results, or for all of them, or RESEARCH_WAIT_MS.
   */
  private async research(query: string, limit: number): Promise<string> {
    const total = Math.max(1, Math.min(2 * SEARCH_RESULTS_MAX, Math.round(limit)));
    const each = SEARCH_RESULTS_MAX;
    const started = Date.now();
    const runs: SourceRun[] = [
      { name: "web", job: this.webAny(query, each).then((r) => r.map(webHit)) },
      {
        name: "GitHub",
        job: this.github(query, 6).then((r) => r.repos.map(githubHit)),
      },
      { name: "Hacker News", job: this.hackerNews(query, 6).then((r) => r.map(hnHit)) },
    ];
    await waitForSources(runs, this.researchWaitMs);
    const ms = Date.now() - started;
    const counts = runs.map((r) => `${r.name} ${sourceState(r)}`).join(", ");
    const merged = mergeHits(runs).slice(0, total);
    const head = `Searched the web, GitHub and Hacker News for "${query.trim()}" in ${(ms / 1000).toFixed(1)} s (${counts}).`;
    if (merged.length === 0) {
      if (runs.every((r) => r.error !== undefined)) {
        throw new Error(
          `the search did not work (${runs.map((r) => `${r.name}: ${r.error}`).join("; ")})`,
        );
      }
      return `${head}\nnothing found`;
    }
    const lines = merged.map((h, i) => {
      const more = h.lines.map((l) => `\n   ${l}`).join("");
      return `${i + 1}. [${h.sources.join(", ")}] ${h.title}\n   ${h.url}${more}`;
    });
    return `${head}\n${lines.join("\n")}`;
  }

  async read(link: string, max: number): Promise<string> {
    let url: URL;
    try {
      url = new URL(link.trim());
    } catch {
      throw new Error(`not a link: ${link}`);
    }
    const chars = Math.max(500, Math.min(READ_CHARS_MAX, Math.round(max)));
    const repo = githubRepoOf(url);
    if (repo !== undefined) {
      const facts = await this.repo(repo).catch(() => undefined);
      if (facts !== undefined) return clip(facts, chars);
    }
    const got = await get(url.toString(), await this.opts());
    if (got.status >= 400) throw new Error(`the site answered ${got.status}`);
    const type = got.type.toLowerCase();
    if (type.includes("html") || (type === "" && /<html|<body/i.test(got.text.slice(0, 2000)))) {
      const { title, text } = htmlToText(got.text);
      // An issue's pull requests, open and closed, come with it (ADR 0102): the page alone hides
      // closed ones, and a model told to check them did not.
      const issue = githubIssueOf(url);
      const prs =
        issue === undefined ? "" : await this.issuePulls(issue.repo, issue.number).catch(() => "");
      const head = `${title === "" ? "" : `${title}\n`}${got.url}\n\n`;
      return prs === ""
        ? clip(`${head}${text}`, chars)
        : `${clip(`${head}${text}`, chars)}\n\n${prs}`;
    }
    if (type.startsWith("text/") || type.includes("json") || type.includes("xml") || type === "") {
      return clip(`${got.url}\n\n${got.text.trim()}`, chars);
    }
    return `${got.url} is not text (${got.type}); a task can download and open it`;
  }

  /**
   * The pull requests linked to an issue, open, closed and merged (ADR 0102): those that mention it
   * in the issue's timeline, and those found by searching the repository's pull requests for its
   * number. Empty when there are none; throws when GitHub does not answer.
   */
  private async issuePulls(repo: string, number: number): Promise<string> {
    const opts = await this.opts();
    const json = { Accept: "application/vnd.github+json" };
    const found = new Map<number, IssuePull>();
    const timeline = await get(
      `https://api.github.com/repos/${repo}/issues/${number}/timeline?per_page=100`,
      opts,
      json,
    );
    if (timeline.status !== 200) throw new Error(`GitHub answered ${timeline.status}`);
    for (const e of JSON.parse(timeline.text) as TimelineEvent[]) {
      const src = e.source?.issue;
      if (e.event !== "cross-referenced" || src?.pull_request === undefined) continue;
      if (src.repository_url !== undefined && !src.repository_url.endsWith(`/repos/${repo}`))
        continue;
      found.set(src.number, pullOf(src));
    }
    const q = encodeURIComponent(`repo:${repo} is:pr ${number}`);
    const search = await get(
      `https://api.github.com/search/issues?q=${q}&per_page=20`,
      opts,
      json,
    ).catch(() => undefined);
    if (search?.status === 200) {
      const items = (JSON.parse(search.text) as { items?: GithubIssue[] }).items ?? [];
      const mention = new RegExp(`#${number}(?!\\d)`);
      for (const it of items) {
        if (found.has(it.number) || it.number === number) continue;
        if (mention.test(`${it.title}\n${it.body ?? ""}`)) found.set(it.number, pullOf(it));
      }
    }
    if (found.size === 0) {
      return `Pull requests linked to #${number} (GitHub API, open and closed): none.`;
    }
    const lines = [...found.values()]
      .sort((a, b) => b.number - a.number)
      .map((p) => `- #${p.number} ${p.state} · ${p.title} · ${p.user} · ${p.url}`);
    return [`Pull requests linked to #${number} (GitHub API, open and closed):`, ...lines].join(
      "\n",
    );
  }

  /** A repository's facts from the GitHub API; throws when the API does not answer. */
  private async repo(fullName: string): Promise<string> {
    const api = `https://api.github.com/repos/${fullName}`;
    const json = { Accept: "application/vnd.github+json" };
    const opts = await this.opts();
    const got = await get(api, opts, json);
    if (got.status !== 200) throw new Error(`GitHub answered ${got.status}`);
    const r = JSON.parse(got.text) as GithubRepo;
    const lines = [
      `${r.full_name} — ${r.description ?? "(no description)"}`,
      [
        `★ ${r.stargazers_count}`,
        `${r.forks_count} forks`,
        `${r.open_issues_count} open issues and pull requests`,
        r.language ?? undefined,
        r.license?.spdx_id ?? r.license?.name ?? "no license",
        `created ${day(r.created_at)}`,
        `last push ${day(r.pushed_at)}`,
        r.archived ? "archived" : undefined,
      ]
        .filter((x) => x !== undefined && x !== "")
        .join(" · "),
      r.html_url,
    ];
    if (r.homepage !== null && r.homepage !== "") lines.push(`Homepage: ${r.homepage}`);
    const release = await get(`${api}/releases/latest`, opts, json).catch(() => undefined);
    if (release?.status === 200) {
      const rel = JSON.parse(release.text) as { tag_name?: string; published_at?: string };
      lines.push(`Latest release: ${rel.tag_name ?? "?"} (${day(rel.published_at)})`);
    }
    const readme = await get(`${api}/readme`, opts, {
      Accept: "application/vnd.github.raw",
    }).catch(() => undefined);
    if (readme?.status === 200 && readme.text.trim() !== "") {
      lines.push("", "README (start):", clip(readme.text.trim(), README_CHARS));
    }
    return lines.join("\n");
  }
}

const searchSchema = obj({
  query: str({ description: "what to search for, in the words a page would use" }),
  source: opt(
    oneOf(["web", "github", "research"] as const, {
      description:
        "web (default): pages, for a fact, a price or what happened. github: repositories by name, description and topics; GitHub needs every word to match, so give two or three key words in English (maimai mcp), not a sentence. research: web, GitHub and Hacker News at once, for projects, comparisons, how people do something or what they think of it; give a few key words, in English for technical topics",
    }),
  ),
  limit: opt(
    num({
      description: `how many results, at most ${SEARCH_RESULTS_MAX} (default ${SEARCH_RESULTS}); research lists up to ${2 * SEARCH_RESULTS_MAX} (default ${RESEARCH_RESULTS})`,
    }),
  ),
});

const readSchema = obj({
  url: str({ description: "the http(s) link to read" }),
  maxChars: opt(
    num({ description: `characters to read, at most ${READ_CHARS_MAX} (default ${READ_CHARS})` }),
  ),
});

/** web_search and web_read: the Herder answers a simple question itself (ADR 0071). */
export function lookupTools(opts: LookupOptions = {}): AgentTool[] {
  const lookup = new Lookup(opts);
  const search = {
    name: "web_search",
    label: "Search the web",
    description:
      "Searches the web, GitHub repositories (source github), or all of web, GitHub and Hacker News at once (source research, a few seconds). Lists titles, links and snippets; research marks which sources found each one. Read-only: for answers you give yourself; work over many pages is a task.",
    parameters: searchSchema,
    execute: async (
      _id: string,
      args: { query: string; source?: SearchSource; limit?: number },
    ) => {
      const source = args.source ?? "web";
      const limit = args.limit ?? (source === "research" ? RESEARCH_RESULTS : SEARCH_RESULTS);
      return ok(await lookup.search(args.query, source, limit));
    },
  };
  const read = {
    name: "web_read",
    label: "Read a page",
    description:
      "Reads one public web page as text (GET, no login). A github.com repository link gives its facts: stars, forks, last push, license, latest release and the start of the README. Never reads this computer or the local network.",
    parameters: readSchema,
    execute: async (_id: string, args: { url: string; maxChars?: number }) =>
      ok(await lookup.read(args.url, args.maxChars ?? READ_CHARS)),
  };
  return [search, read] as unknown as AgentTool[];
}
