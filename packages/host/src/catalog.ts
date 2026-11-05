// The agents AgentHerd knows how to download and start (ADR 0031: Pi, Codex for GPT models, and
// DSH when the owner names it), and where each one's latest release is
// published (ADR 0024). Like OpenBot, downloads follow upstream's latest release; the digest comes
// from the publisher (GitHub asset digest, npm integrity, the DSH update feed's sha512).

import type { AgentProfile } from "@agentherd/protocol";
import type { ArchiveRelease, Digest, NpmRelease, Release } from "./runtimes.ts";
import { nodeEnv } from "./runtimes.ts";

export type FetchJson = (url: string) => Promise<unknown>;
export type FetchText = (url: string) => Promise<string>;

export interface Fetchers {
  json: FetchJson;
  text: FetchText;
}

export interface AgentDef {
  id: string;
  name: string;
  /** Env variable naming an explicit CLI path. */
  envVar: string;
  /** Command names to look for on PATH. */
  systemNames: string[];
  /** Arguments that start the ACP server. */
  acpArgs: string[];
  /** Env the agent runs with so that writes and commands ask the owner. */
  env: Record<string, string>;
  /** Latest release for a target (`darwin-arm64`, …); undefined when there is no build for it. */
  latest?: (target: string, fetch: Fetchers) => Promise<Release | undefined>;
  /** npm releases need npm itself, downloaded as the `npm` runtime. */
  npm?: boolean;
}

const GITHUB = "https://api.github.com/repos";
const NPM = "https://registry.npmjs.org";
const DSH_FEED = "https://download.deepseek.com/dsh-desk/feeds";

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

/** Latest GitHub release asset; the version is the tag without a leading "v". */
export async function githubAsset(
  fetch: Fetchers,
  repo: string,
  name: string,
): Promise<{ version: string; url: string; digest: Digest; bytes: number } | undefined> {
  const release = (await fetch.json(`${GITHUB}/${repo}/releases/latest`)) as GithubRelease;
  const asset = release.assets.find((a) => a.name === name);
  if (asset === undefined) return undefined;
  const [algorithm, value] = (asset.digest ?? "").split(":");
  if (algorithm !== "sha256" || value === undefined || value === "") {
    throw new Error(`${repo} ${name} has no SHA-256 digest`);
  }
  return {
    version: release.tag_name.replace(/^v/, ""),
    url: asset.browser_download_url,
    digest: { algorithm: "sha256", encoding: "hex", value },
    bytes: asset.size,
  };
}

/** Latest version of an npm package with its tarball and integrity. */
export async function npmLatest(
  fetch: Fetchers,
  name: string,
): Promise<{ version: string; tarball: string; digest: Digest }> {
  const meta = (await fetch.json(`${NPM}/${name}/latest`)) as {
    version: string;
    dist: { tarball: string; integrity?: string };
  };
  const integrity = meta.dist.integrity ?? "";
  if (!integrity.startsWith("sha512-")) throw new Error(`${name} has no sha512 integrity`);
  return {
    version: meta.version,
    tarball: meta.dist.tarball,
    digest: { algorithm: "sha512", encoding: "base64", value: integrity.slice("sha512-".length) },
  };
}

function split(target: string): { os: string; arch: string } {
  const [os = "", arch = ""] = target.split("-");
  return { os, arch };
}

async function piLatest(target: string, fetch: Fetchers) {
  const { os, arch } = split(target);
  if (!["darwin", "linux", "win32"].includes(os) || !["arm64", "x64"].includes(arch)) {
    return undefined;
  }
  if (os === "win32") {
    // The Windows build is a zip with pi.exe at its top level.
    const asset = await githubAsset(fetch, "earendil-works/pi", `pi-windows-${arch}.zip`);
    return asset === undefined ? undefined : archive("pi", asset, "zip", "pi.exe", "exec");
  }
  const asset = await githubAsset(fetch, "earendil-works/pi", `pi-${os}-${arch}.tar.gz`);
  if (asset === undefined) return undefined;
  return archive("pi", asset, "tar.gz", "pi/pi", "exec");
}

function npmAgent(id: string, pkg: string, bin: string) {
  return async (_target: string, fetch: Fetchers): Promise<NpmRelease> => {
    const { version } = await npmLatest(fetch, pkg);
    return {
      kind: "npm",
      id,
      version,
      package: pkg,
      executable: `node_modules/${pkg}/${bin}`,
    };
  };
}

/** npm itself, used to install npm-published agents. */
export async function npmRuntime(fetch: Fetchers): Promise<ArchiveRelease> {
  const npm = await npmLatest(fetch, "npm");
  return {
    kind: "archive",
    id: "npm",
    version: npm.version,
    url: npm.tarball,
    digest: npm.digest,
    bytes: 0,
    format: "tar.gz",
    executable: "package/bin/npm-cli.js",
    check: "node",
  };
}

const DSH_FEEDS: Record<string, string> = { "darwin-arm64": "mac-arm64", "darwin-x64": "mac-x64" };

/** Reads `version`, the zip's url, sha512 and size from DSH's electron-builder feed. */
export function parseDshFeed(text: string, feedUrl: string) {
  // Enough YAML for electron-builder feeds: `key: value` and folded `key: >-` + indented lines.
  const entries: { key: string; value: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(/^(\s*)(?:-\s+)?([A-Za-z0-9_]+):\s*(.*)$/);
    if (m === null) continue;
    let value = (m[3] ?? "").trim();
    if (value === ">-" || value === ">" || value === "|" || value === "|-") {
      const parts: string[] = [];
      // Column of the key: for "  - url:" it is 4, so "    sha512:" ends the folded value.
      const indent = (lines[i] ?? "").indexOf(m[2] ?? "");
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? "";
        const nextIndent = next.length - next.trimStart().length;
        if (next.trim() !== "" && nextIndent <= indent) break;
        parts.push(next.trim());
        i++;
      }
      value = parts.join(" ").trim();
    }
    entries.push({ key: m[2] ?? "", value: value.replace(/^['"]|['"]$/g, "") });
  }
  const first = (key: string) => entries.find((e) => e.key === key)?.value;
  const zipAt = entries.findIndex((e) => e.key === "url" && e.value.endsWith(".zip"));
  const version = first("version");
  if (version === undefined || zipAt < 0)
    throw new Error("DeepSeek Harness update feed has no zip");
  const after = entries.slice(zipAt + 1);
  const sha512 = after.find((e) => e.key === "sha512")?.value;
  const size = Number(after.find((e) => e.key === "size")?.value ?? 0);
  if (sha512 === undefined) throw new Error("DeepSeek Harness update feed has no sha512");
  const url = new URL(entries[zipAt]?.value ?? "", feedUrl).toString();
  return { version, url, sha512, size };
}

async function dshLatest(target: string, fetch: Fetchers) {
  const feed = DSH_FEEDS[target];
  if (feed === undefined) return undefined;
  const feedUrl = `${DSH_FEED}/${feed}/nightly-mac.yml`;
  const parsed = parseDshFeed(await fetch.text(feedUrl), feedUrl);
  return archive(
    "dsh",
    {
      version: parsed.version,
      url: parsed.url,
      digest: { algorithm: "sha512", encoding: "base64", value: parsed.sha512 },
      bytes: parsed.size,
    },
    "zip",
    DSH_APP_LAUNCHER,
    // The launcher needs the whole app; its digest already proves the download.
    "none",
  );
}

function archive(
  id: string,
  asset: { version: string; url: string; digest: Digest; bytes: number },
  format: ArchiveRelease["format"],
  executable: string,
  check: ArchiveRelease["check"],
): ArchiveRelease {
  return { kind: "archive", id, ...asset, format, executable, check };
}

/** The CLI launcher inside DeepSeek Harness.app. */
export const DSH_APP_LAUNCHER = "DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";

export const AGENTS: AgentDef[] = [
  {
    id: "dsh",
    name: "DeepSeek Harness",
    envVar: "AGENTHERD_DSH",
    systemNames: ["dsh"],
    acpArgs: ["acp"],
    // read-only: every write and network command becomes a permission request.
    env: { DSH_PERMISSION_MODE: "read-only" },
    latest: dshLatest,
  },
  {
    id: "pi",
    name: "Pi",
    envVar: "AGENTHERD_PI",
    systemNames: ["pi"],
    acpArgs: [],
    env: {},
    latest: piLatest,
  },
  {
    id: "codex",
    name: "Codex",
    envVar: "AGENTHERD_CODEX",
    systemNames: ["codex-acp"],
    acpArgs: [],
    // read-only: Codex asks before editing files or using the network. No ChatGPT browser login:
    // AgentHerd hands Codex the owner's GPT model and key (ADR 0031).
    env: { INITIAL_AGENT_MODE: "read-only", NO_BROWSER: "1" },
    latest: npmAgent("codex", "@agentclientprotocol/codex-acp", "dist/index.js"),
    npm: true,
  },
];

export function agentDef(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Scripts run with AgentHerd's own Node (Electron's in the app); binaries run directly. */
export function isScript(path: string): boolean {
  return /\.(c|m)?js$/.test(path);
}

/**
 * A profile that starts `def` from `bin`. Pi goes through AgentHerd's ACP bridge (ADR 0022),
 * which `piCommand` supplies.
 */
export function agentProfile(
  def: AgentDef,
  bin: string,
  extraEnv: Record<string, string> = {},
): AgentProfile {
  const script = isScript(bin);
  return {
    id: def.id,
    name: def.name,
    command: script ? [process.execPath, bin, ...def.acpArgs] : [bin, ...def.acpArgs],
    env: { ...(script ? nodeEnv() : {}), ...def.env, ...extraEnv },
    exporter: null,
  };
}

/** Default fetchers: GitHub and npm JSON, plain text for feeds. */
export const httpFetchers: Fetchers = {
  json: async (url) => {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "AgentHerd" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  },
  text: async (url) => {
    const response = await fetch(url, { headers: { "user-agent": "AgentHerd" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  },
};
