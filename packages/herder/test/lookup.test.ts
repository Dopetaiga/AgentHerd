import { describe, expect, it } from "vitest";
import {
  bingResults,
  checkPublic,
  duckResults,
  type Fetch,
  githubIssueOf,
  githubQueries,
  githubRepoOf,
  htmlToText,
  isPrivateAddress,
  LOOKUP_TOOL_NAMES,
  Lookup,
  lookupTools,
  mergeHits,
  sameLink,
} from "../src/lookup.ts";
import { systemPrompt } from "../src/prompt.ts";

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A fake web: each URL prefix answers with a status, a type and a body (or a redirect). */
function web(
  routes: Record<string, { status?: number; type?: string; body?: string; to?: string }>,
) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    const key = Object.keys(routes)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    const route = key === undefined ? { status: 404, body: "not found" } : routes[key];
    if (route?.to !== undefined) {
      return new Response(null, { status: 302, headers: { location: route.to } });
    }
    return new Response(route?.body ?? "", {
      status: route?.status ?? 200,
      headers: { "content-type": route?.type ?? "text/html; charset=utf-8" },
    });
  }) as Fetch;
  return { fetch, calls };
}

const PUBLIC = async () => ["93.184.216.34"];

const DUCK = `
<div class="result results_links result--ad"><h2 class="result__title">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/y.js?ad_domain=x">An ad</a></h2>
<a class="result__snippet" href="#">Buy now</a></div>
<div class="result results_links web-result"><h2 class="result__title">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fyetone%2Fmagpie&amp;rut=1">GitHub - <b>yetone/magpie</b>: Every agent&#x27;s model</a></h2>
<a class="result__snippet" href="#">One place &amp; one switch.</a></div>
<div class="result results_links web-result"><h2 class="result__title">
<a rel="nofollow" class="result__a" href="https://usemagpie.ai/zh/">magpie：模型一处切换</a></h2>
<a class="result__snippet" href="#">每个 Agent 的模型</a></div>`;

const BING = `
<li class="b_algo"><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1aHR0cHM6Ly9naXRodWIuY29tL29icmEvc3VwZXJwb3dlcnM&amp;ntb=1">GitHub - <strong>obra/superpowers</strong>: skills</a></h2>
<div class="b_caption"><p class="b_lineclamp2">A complete methodology.</p></div></li>
<li class="b_algo"><h2><a href="https://example.org/page">Plain link</a></h2><p>Text here</p></li>`;

describe("public addresses only (ADR 0071)", () => {
  it("knows the private and local ranges", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["93.184.216.34", "140.82.112.3", "2606:4700::1111", "172.32.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it("refuses other schemes, logins, this computer and names that resolve inside", async () => {
    const inside = async () => ["192.168.0.8"];
    await expect(checkPublic(new URL("file:///etc/hosts"), PUBLIC)).rejects.toThrow(
      /only http and https/,
    );
    await expect(checkPublic(new URL("https://a:b@example.com/"), PUBLIC)).rejects.toThrow(/login/);
    await expect(checkPublic(new URL("http://localhost:18060/"), PUBLIC)).rejects.toThrow(
      /public sites/,
    );
    await expect(checkPublic(new URL("http://127.0.0.1:8080/"), PUBLIC)).rejects.toThrow(
      /public sites/,
    );
    await expect(checkPublic(new URL("http://[::1]/"), PUBLIC)).rejects.toThrow(/public sites/);
    await expect(checkPublic(new URL("https://router.example/"), inside)).rejects.toThrow(
      /public sites/,
    );
    await expect(checkPublic(new URL("https://example.com/"), PUBLIC)).resolves.toBeUndefined();
  });

  it("checks every redirect, so a public link cannot lead inside", async () => {
    const { fetch, calls } = web({
      "https://short.example/": { to: "http://127.0.0.1:9444/json" },
    });
    const lookup = new Lookup({ fetch, resolve: PUBLIC });
    await expect(lookup.read("https://short.example/x", 2000)).rejects.toThrow(/public sites/);
    expect(calls.map((c) => c.url)).toEqual(["https://short.example/x"]);
  });
});

describe("web_search (ADR 0071)", () => {
  it("reads DuckDuckGo results without ads and with the real links", () => {
    expect(duckResults(DUCK)).toEqual([
      {
        title: "GitHub - yetone/magpie: Every agent's model",
        url: "https://github.com/yetone/magpie",
        snippet: "One place & one switch.",
      },
      {
        title: "magpie：模型一处切换",
        url: "https://usemagpie.ai/zh/",
        snippet: "每个 Agent 的模型",
      },
    ]);
  });

  it("reads Bing results and decodes its click links", () => {
    expect(bingResults(BING)).toEqual([
      {
        title: "GitHub - obra/superpowers: skills",
        url: "https://github.com/obra/superpowers",
        snippet: "A complete methodology.",
      },
      { title: "Plain link", url: "https://example.org/page", snippet: "Text here" },
    ]);
  });

  it("lists numbered results, and tries Bing when DuckDuckGo turns it away", async () => {
    const { fetch, calls } = web({
      "https://html.duckduckgo.com/": { status: 202, body: "captcha" },
      "https://www.bing.com/search": { body: BING },
    });
    const text = await new Lookup({ fetch, resolve: PUBLIC }).search("obra superpowers", "web", 1);
    expect(text).toBe(
      "1. GitHub - obra/superpowers: skills\n   https://github.com/obra/superpowers\n   A complete methodology.",
    );
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      "html.duckduckgo.com",
      "www.bing.com",
    ]);
  });

  it("says nothing was found, and says why when no engine answered", async () => {
    const empty = web({ "https://": { body: "<html><body>no results</body></html>" } });
    await expect(
      new Lookup({ fetch: empty.fetch, resolve: PUBLIC }).search("zzz", "web", 5),
    ).resolves.toBe("nothing found");
    const down = web({ "https://": { status: 503 } });
    await expect(
      new Lookup({ fetch: down.fetch, resolve: PUBLIC }).search("x", "web", 5),
    ).rejects.toThrow("the web search did not work (DuckDuckGo answered 503; Bing answered 503)");
  });

  it("searches GitHub repositories with the owner's token, sent to api.github.com only", async () => {
    const { fetch, calls } = web({
      "https://api.github.com/search/repositories": {
        type: "application/json",
        body: JSON.stringify({
          items: [
            {
              full_name: "agent-infra/sandbox",
              description: "All-in-One Sandbox",
              html_url: "https://github.com/agent-infra/sandbox",
              stargazers_count: 6361,
              forks_count: 574,
              language: "Python",
              pushed_at: "2026-09-14T00:00:00Z",
            },
          ],
        }),
      },
      "https://html.duckduckgo.com/": { body: DUCK },
    });
    const lookup = new Lookup({ fetch, resolve: PUBLIC, githubToken: async () => "gho_secret\n" });
    expect(await lookup.search("agent sandbox", "github", 3)).toBe(
      "agent-infra/sandbox — All-in-One Sandbox\n  ★ 6361 · 574 forks · Python · last push 2026-09-14\n  https://github.com/agent-infra/sandbox",
    );
    await lookup.search("magpie", "web", 3);
    expect(calls[0]?.headers.Authorization).toBe("Bearer gho_secret");
    expect(calls[1]?.headers.Authorization).toBeUndefined();
  });
});

describe("GitHub search with fewer words (ADR 0085)", () => {
  it("tries the words as given, without Chinese words, then the first three and two", () => {
    expect(githubQueries("脉脉 maimai mcp")).toEqual(["脉脉 maimai mcp", "maimai mcp"]);
    expect(githubQueries("maimai mcp server model context protocol")).toEqual([
      "maimai mcp server model context protocol",
      "maimai mcp server",
      "maimai mcp",
    ]);
    expect(githubQueries(" agent  sandbox ")).toEqual(["agent sandbox"]);
    expect(githubQueries("脉脉")).toEqual(["脉脉"]);
  });

  it("says when it found repositories only with fewer words", async () => {
    const repo = {
      full_name: "a/maimai-mcp",
      description: "MCP for maimai",
      html_url: "https://github.com/a/maimai-mcp",
      stargazers_count: 12,
      forks_count: 1,
      language: "TypeScript",
      pushed_at: "2026-10-01T00:00:00Z",
    };
    const { fetch, calls } = web({
      "https://api.github.com/search/repositories": {
        type: "application/json",
        body: JSON.stringify({ items: [] }),
      },
      "https://api.github.com/search/repositories?q=maimai%20mcp&": {
        type: "application/json",
        body: JSON.stringify({ items: [repo] }),
      },
    });
    const lookup = new Lookup({ fetch, resolve: PUBLIC });
    expect(await lookup.search("maimai mcp server model context protocol", "github", 3)).toBe(
      'No repository matched every word of "maimai mcp server model context protocol"; these match "maimai mcp":\na/maimai-mcp — MCP for maimai\n  ★ 12 · 1 forks · TypeScript · last push 2026-10-01\n  https://github.com/a/maimai-mcp',
    );
    expect(calls).toHaveLength(3);
    calls.length = 0;
    expect(await lookup.search("zzz qqq", "github", 3)).toBe("nothing found");
    expect(calls.map((c) => new URL(c.url).searchParams.get("q"))).toEqual(["zzz qqq"]);
  });
});

describe("web_read (ADR 0071)", () => {
  it("turns a page into its title and readable text, without scripts and menus", () => {
    const html = `<html><head><title>Hi &amp; bye</title><style>p{}</style></head><body>
      <nav>Home | Login</nav><script>alert(1)</script><h1>Magpie</h1><p>One <b>place</b>.</p>
      <ul><li>Codex</li><li>Claude Code</li></ul><footer>© 2026</footer></body></html>`;
    expect(htmlToText(html)).toEqual({
      title: "Hi & bye",
      text: "# Magpie\nOne place.\n\n- Codex\n- Claude Code",
    });
  });

  it("reads a page and says how much is left", async () => {
    const { fetch } = web({
      "https://usemagpie.ai/": {
        body: `<title>magpie</title><body><p>${"x".repeat(3000)}</p></body>`,
      },
    });
    const text = await new Lookup({ fetch, resolve: PUBLIC }).read("https://usemagpie.ai/", 600);
    expect(text.startsWith("magpie\nhttps://usemagpie.ai/\n\nxxx")).toBe(true);
    expect(text).toMatch(/… \(\d+ more characters; pass maxChars to read more\)$/);
  });

  it("brings an issue's pull requests, open and closed, with its page (ADR 0102)", async () => {
    const pr = (n: number, state: string, merged: string | null, body: string) => ({
      number: n,
      title: `Fix ${n}`,
      body,
      state,
      html_url: `https://github.com/vastsa/PI-Desktop/pull/${n}`,
      user: { login: "dev" },
      repository_url: "https://api.github.com/repos/vastsa/PI-Desktop",
      pull_request: { merged_at: merged },
    });
    const { fetch } = web({
      "https://github.com/vastsa/PI-Desktop/issues/2391": {
        body: "<html><head><title>Login breaks · Issue #2391</title></head><body>It breaks.</body></html>",
      },
      "https://api.github.com/repos/vastsa/PI-Desktop/issues/2391/timeline": {
        type: "application/json",
        body: JSON.stringify([
          { event: "commented" },
          { event: "cross-referenced", source: { issue: pr(2392, "closed", null, "fixes #2391") } },
        ]),
      },
      "https://api.github.com/search/issues": {
        type: "application/json",
        body: JSON.stringify({
          items: [pr(2400, "open", null, "Closes #2391"), pr(2401, "open", null, "about #23910")],
        }),
      },
    });
    const text = await new Lookup({ fetch, resolve: PUBLIC }).read(
      "https://github.com/vastsa/PI-Desktop/issues/2391",
      5000,
    );
    expect(text).toContain("It breaks.");
    expect(text).toContain("Pull requests linked to #2391 (GitHub API, open and closed):");
    expect(text).toContain("- #2400 open · Fix 2400 · @dev");
    expect(text).toContain("- #2392 closed, not merged · Fix 2392");
    expect(text).not.toContain("#2401");
    expect(githubIssueOf(new URL("https://github.com/a/b/issues/7"))).toEqual({
      repo: "a/b",
      number: 7,
    });
    expect(githubIssueOf(new URL("https://github.com/a/b/pull/7"))).toBeUndefined();
  });

  it("gives a GitHub repository's facts from the API instead of its page", async () => {
    const { fetch, calls } = web({
      "https://api.github.com/repos/yetone/magpie/releases/latest": {
        type: "application/json",
        body: JSON.stringify({ tag_name: "v0.1.4434", published_at: "2026-11-18T01:00:00Z" }),
      },
      "https://api.github.com/repos/yetone/magpie/readme": {
        type: "text/plain",
        body: "# magpie\nEvery agent's model.",
      },
      "https://api.github.com/repos/yetone/magpie": {
        type: "application/json",
        body: JSON.stringify({
          full_name: "yetone/magpie",
          description: "Every agent's model. One place.",
          html_url: "https://github.com/yetone/magpie",
          stargazers_count: 38315,
          forks_count: 3465,
          open_issues_count: 4501,
          language: "Go",
          license: { spdx_id: "MIT" },
          created_at: "2026-09-23T00:00:00Z",
          pushed_at: "2026-11-18T00:00:00Z",
          homepage: "https://usemagpie.ai",
          archived: false,
        }),
      },
    });
    const text = await new Lookup({ fetch, resolve: PUBLIC }).read(
      "https://github.com/yetone/magpie",
      5000,
    );
    expect(text).toBe(
      [
        "yetone/magpie — Every agent's model. One place.",
        "★ 38315 · 3465 forks · 4501 open issues and pull requests · Go · MIT · created 2026-09-23 · last push 2026-11-18",
        "https://github.com/yetone/magpie",
        "Homepage: https://usemagpie.ai",
        "Latest release: v0.1.4434 (2026-11-18)",
        "",
        "README (start):",
        "# magpie\nEvery agent's model.",
      ].join("\n"),
    );
    expect(calls.some((c) => c.url.startsWith("https://github.com/"))).toBe(false);
  });

  it("falls back to the page when the API does not answer, and names files it cannot read", async () => {
    const { fetch } = web({
      "https://api.github.com/": { status: 403, type: "application/json", body: "{}" },
      "https://github.com/a/b": { body: "<title>a/b</title><body><p>Repo page</p></body>" },
      "https://example.com/x.zip": { type: "application/zip", body: "PK" },
    });
    const lookup = new Lookup({ fetch, resolve: PUBLIC });
    expect(await lookup.read("https://github.com/a/b", 2000)).toBe(
      "a/b\nhttps://github.com/a/b\n\nRepo page",
    );
    expect(await lookup.read("https://example.com/x.zip", 2000)).toBe(
      "https://example.com/x.zip is not text (application/zip); a task can download and open it",
    );
    await expect(lookup.read("not a link", 2000)).rejects.toThrow("not a link: not a link");
  });

  it("knows which links are repositories", () => {
    expect(githubRepoOf(new URL("https://github.com/yetone/magpie"))).toBe("yetone/magpie");
    expect(githubRepoOf(new URL("https://github.com/yetone/magpie.git"))).toBe("yetone/magpie");
    expect(githubRepoOf(new URL("https://github.com/yetone/magpie/tree/main/docs"))).toBe(
      "yetone/magpie",
    );
    expect(githubRepoOf(new URL("https://github.com/yetone/magpie/issues/3"))).toBeUndefined();
    expect(githubRepoOf(new URL("https://github.com/orgs/acme"))).toBeUndefined();
    expect(githubRepoOf(new URL("https://gitlab.com/a/b"))).toBeUndefined();
  });
});

describe("lookup tools (ADR 0071)", () => {
  it("are web_search and web_read, the ones a retry may repeat", async () => {
    const { fetch } = web({ "https://html.duckduckgo.com/": { body: DUCK } });
    const tools = lookupTools({ fetch, resolve: PUBLIC });
    expect(tools.map((t) => t.name)).toEqual(["web_search", "web_read"]);
    expect([...LOOKUP_TOOL_NAMES]).toEqual(["web_search", "web_read"]);
    const result = await tools[0]?.execute("1", { query: "magpie", limit: 1 });
    expect(result?.content).toEqual([
      {
        type: "text",
        text: "1. GitHub - yetone/magpie: Every agent's model\n   https://github.com/yetone/magpie\n   One place & one switch.",
      },
    ]);
  });
});

describe("asked for projects or about a file (ADR 0085)", () => {
  it("names real projects first, and sends a task to read a file without asking", () => {
    const system = systemPrompt("zh-CN");
    expect(system).toContain("Search with source research (or github and web)");
    expect(system).toContain("Put the projects first, each with its link, stars, last push");
    expect(system).toContain(
      "start a small task\n  for it at once with the path in it; do not ask first",
    );
    const tools = lookupTools({});
    expect(JSON.stringify(tools[0]?.parameters)).toContain(
      "give two or three key words in English",
    );
  });
});

const REPO = {
  full_name: "yetone/magpie",
  description: "Every agent's model",
  html_url: "https://github.com/yetone/magpie",
  stargazers_count: 1200,
  forks_count: 40,
  language: "TypeScript",
  pushed_at: "2026-11-01T00:00:00Z",
};

const HN = {
  hits: [
    {
      title: "Show HN: Magpie, one switch for every agent's model",
      url: "https://www.github.com/yetone/magpie/",
      points: 210,
      num_comments: 64,
      objectID: "42",
      created_at: "2026-10-30T00:00:00Z",
    },
    {
      title: "Ask HN: How do you route models?",
      url: null,
      points: 12,
      num_comments: 9,
      objectID: "7",
    },
  ],
};

describe("research search (ADR 0086)", () => {
  it("treats the same page written differently as one link", () => {
    expect(sameLink("https://www.github.com/Yetone/Magpie/")).toBe(
      sameLink("https://github.com/yetone/magpie"),
    );
    expect(sameLink("https://example.org/a?utm_source=x#top")).toBe(
      sameLink("http://example.org/a"),
    );
    expect(sameLink("https://example.org/a?id=1")).not.toBe(sameLink("https://example.org/a?id=2"));
  });

  it("puts results several sources found first, each listed once with all its sources", () => {
    const hit = (title: string, url: string) => ({ title, url, lines: [title] });
    const merged = mergeHits([
      {
        name: "web",
        hits: [hit("a", "https://a.example/"), hit("m", "https://github.com/yetone/magpie")],
      },
      { name: "GitHub", hits: [hit("yetone/magpie", "https://github.com/yetone/magpie")] },
      { name: "Hacker News", hits: [hit("b", "https://b.example/")] },
    ]);
    expect(merged.map((h) => [h.url, h.sources])).toEqual([
      ["https://github.com/yetone/magpie", ["web", "GitHub"]],
      ["https://a.example/", ["web"]],
      ["https://b.example/", ["Hacker News"]],
    ]);
    expect(merged[0]?.lines).toEqual(["m", "yetone/magpie"]);
  });

  it("searches the web, GitHub and Hacker News at once and merges them", async () => {
    const { fetch, calls } = web({
      "https://html.duckduckgo.com/": { body: DUCK },
      "https://api.github.com/search/repositories": {
        type: "application/json",
        body: JSON.stringify({ items: [REPO] }),
      },
      "https://hn.algolia.com/api/v1/search": {
        type: "application/json",
        body: JSON.stringify(HN),
      },
    });
    const text = await new Lookup({ fetch, resolve: PUBLIC }).search(
      "magpie agent model",
      "research",
      12,
    );
    expect(new Set(calls.map((c) => new URL(c.url).hostname))).toEqual(
      new Set(["html.duckduckgo.com", "www.bing.com", "api.github.com", "hn.algolia.com"]),
    );
    const lines = text.split("\n");
    expect(lines[0]).toMatch(
      /^Searched the web, GitHub and Hacker News for "magpie agent model" in \d+\.\d s \(web 2, GitHub 1, Hacker News 2\)\.$/,
    );
    expect(lines[1]).toBe(
      "1. [web, GitHub, Hacker News] GitHub - yetone/magpie: Every agent's model",
    );
    expect(text).toContain("★ 1200 · 40 forks · TypeScript · last push 2026-11-01");
    expect(text).toContain("210 points · 64 comments · 2026-10-30");
    expect(text).toContain("discussion: https://news.ycombinator.com/item?id=42");
    expect(text).toContain(
      "[Hacker News] Ask HN: How do you route models?\n   https://news.ycombinator.com/item?id=7",
    );
  });

  it("does not wait for a slow source once the web and another have results", async () => {
    const fast = web({
      "https://html.duckduckgo.com/": { body: DUCK },
      "https://hn.algolia.com/api/v1/search": {
        type: "application/json",
        body: JSON.stringify(HN),
      },
    });
    const fetch = (async (input: string | URL, init?: RequestInit) => {
      if (input.toString().startsWith("https://api.github.com/")) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
      return fast.fetch(input, init);
    }) as Fetch;
    const started = Date.now();
    const text = await new Lookup({ fetch, resolve: PUBLIC, researchWaitMs: 4_000 }).search(
      "magpie",
      "research",
      12,
    );
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(text).toContain("GitHub too slow, left out");
  });

  it("stops at its time limit, and says when no source worked", async () => {
    const fetch = (async (input: string | URL) => {
      if (input.toString().startsWith("https://html.duckduckgo.com/")) {
        await new Promise((r) => setTimeout(r, 5_000));
      }
      return new Response("", { status: 503 });
    }) as Fetch;
    const started = Date.now();
    const text = await new Lookup({ fetch, resolve: PUBLIC, researchWaitMs: 300 }).search(
      "x",
      "research",
      12,
    );
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(text).toContain("web too slow, left out, GitHub failed, Hacker News failed");
    expect(text).toContain("nothing found");
    const down = web({ "https://": { status: 503 } });
    await expect(
      new Lookup({ fetch: down.fetch, resolve: PUBLIC }).search("x", "research", 12),
    ).rejects.toThrow(/^the search did not work \(web: the web search did not work/);
  });

  it("lets the Herder pick research for projects and comparisons", () => {
    const system = systemPrompt("zh-CN");
    expect(system).toContain("one plain web_search is enough");
    expect(system).toContain("web_search with source research");
    const tools = lookupTools({});
    expect(JSON.stringify(tools[0]?.parameters)).toContain(
      "research: web, GitHub and Hacker News at once",
    );
  });
});
