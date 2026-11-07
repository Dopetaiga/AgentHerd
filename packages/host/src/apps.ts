// The owner's apps through their own Composio key (docs/spec/09-agent-tools.md §3): settings
// (key, connect, disconnect) and the AppTools the gateway gives agents. The key stays here; views
// only say whether there is one.

import { randomBytes } from "node:crypto";
import type { AppToolInfo, AppTools, SecretStore } from "@agentherd/core";
import type { AppsView, AppView } from "./api.ts";
import {
  type ComposioClient,
  ComposioError,
  type ComposioToolkit,
  composioClient,
  hintsOf,
  type McpHttpClient,
  mcpHttpClient,
} from "./composio.ts";

export const COMPOSIO_ACCOUNT = "composio";
const DESCRIBE_TTL_MS = 24 * 60 * 60_000;
const POLL_MS = 2_000;
const CONNECT_TIMEOUT_MS = 5 * 60_000;
const FAILED = new Set(["FAILED", "EXPIRED", "REVOKED", "INACTIVE"]);

export type { AppsView, AppView };

export interface AppsOptions {
  secrets: SecretStore;
  /** The Composio user id of this AgentHerd, made once and kept in config.json. */
  userId: () => string;
  emit: (view: AppsView) => void;
  client?: (key: string) => ComposioClient;
  mcp?: (url: string, key: string) => McpHttpClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** A new Composio user id: agentherd-<16 hex>. */
export function newComposioUserId(): string {
  return `agentherd-${randomBytes(8).toString("hex")}`;
}

interface Session {
  id: string;
  mcp: McpHttpClient;
}

const why = (error: unknown) => (error as Error).message;

/** A key that may read but not make sessions (Composio's key permissions). */
const NO_SESSION_RIGHTS =
  "这个 Key 权限不够：AgentHerd 要能创建会话（session_management 的写权限）。请在 Composio 的 Settings → API Keys 新建一个有完整权限的 Key 再粘贴。";

function keyProblem(error: unknown): string | undefined {
  if (!(error instanceof ComposioError)) return undefined;
  if (error.status === 403 && /permission/i.test(error.message)) return NO_SESSION_RIGHTS;
  if (error.status === 401 || error.status === 403) {
    return `这个 Composio API Key 不能用：${error.message}`;
  }
  return undefined;
}

export class Apps {
  private readonly opts: AppsOptions;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Session for the settings (all toolkits). */
  private browse: Promise<Session> | undefined;
  /** Session agents use, with the connected toolkits; key = sorted slugs. */
  private work: { key: string; session: Promise<Session> } | undefined;
  private connected: ComposioToolkit[] = [];
  private readonly connecting = new Set<string>();
  private readonly described = new Map<string, { info: AppToolInfo; at: number }>();
  private problem: string | undefined;
  /** Bumped when the key changes; a poll from an older key stops. */
  private generation = 0;

  constructor(opts: AppsOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private key(): string | undefined {
    return this.opts.secrets.get(COMPOSIO_ACCOUNT);
  }

  private client(key: string): ComposioClient {
    return (this.opts.client ?? composioClient)(key);
  }

  private reset(): void {
    this.generation++;
    this.browse = undefined;
    this.work = undefined;
    this.connected = [];
    this.connecting.clear();
    this.described.clear();
  }

  private session(key: string, toolkits: readonly string[]): Promise<Session> {
    const made = this.client(key)
      .createSession(this.opts.userId(), toolkits)
      .then((s) => ({ id: s.id, mcp: (this.opts.mcp ?? mcpHttpClient)(s.mcpUrl, key) }));
    made.catch(() => {});
    return made;
  }

  /** Runs `work` on the settings session; a session Composio forgot is made again, once. */
  private async onBrowse<T>(key: string, work: (s: Session) => Promise<T>): Promise<T> {
    this.browse ??= this.session(key, []);
    const current = this.browse;
    try {
      return await work(await current);
    } catch (error) {
      if (this.browse === current) this.browse = undefined;
      if (!(error instanceof ComposioError) || error.status !== 404) throw error;
      this.browse = this.session(key, []);
      return await work(await this.browse);
    }
  }

  private async refreshConnected(key: string): Promise<void> {
    const list = await this.onBrowse(key, (s) =>
      this.client(key).toolkits(s.id, { connected: true }),
    );
    this.connected = list.filter((t) => t.account?.status === "ACTIVE");
  }

  /** Names of the connected apps, as last seen. */
  connectedNames(): string[] {
    return this.key() === undefined ? [] : this.connected.map((t) => t.name);
  }

  /** Loads the connected apps (at start), without failing. */
  async load(): Promise<void> {
    const key = this.key();
    if (key === undefined) return;
    try {
      await this.refreshConnected(key);
    } catch (error) {
      this.opts.log?.(`[apps] could not read connected apps: ${why(error)}`);
    }
  }

  async view(search?: string): Promise<AppsView> {
    const key = this.key();
    if (key === undefined) return { hasKey: false, apps: [] };
    const problem = this.problem;
    const q = search?.trim().toLowerCase() ?? "";
    try {
      await this.refreshConnected(key);
      const found = await this.onBrowse(key, (s) =>
        this.client(key).toolkits(s.id, q === "" ? {} : { search: q }),
      );
      const connected = new Set(this.connected.map((t) => t.slug));
      const rows = new Map<string, AppView>();
      const row = (t: ComposioToolkit): AppView => ({
        slug: t.slug,
        name: t.name,
        ...(t.logo === undefined ? {} : { logo: t.logo }),
        connected: connected.has(t.slug),
        connecting: this.connecting.has(t.slug),
      });
      // Composio also matches descriptions. Settings search is by app name or slug.
      for (const t of [...this.connected, ...found]) {
        if (
          !rows.has(t.slug) &&
          (q === "" || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
        ) {
          rows.set(t.slug, row(t));
        }
      }
      return {
        hasKey: true,
        ...(problem === undefined ? {} : { problem }),
        apps: [...rows.values()],
      };
    } catch (error) {
      const problem = keyProblem(error) ?? `读不到 Composio 的应用列表：${why(error)}`;
      return { hasKey: true, problem, apps: [] };
    }
  }

  private async changed(): Promise<void> {
    try {
      this.opts.emit(await this.view());
    } catch (error) {
      this.opts.log?.(`[apps] ${why(error)}`);
    }
  }

  /** Saves a key after checking it; "" removes it. A bad key is not saved. */
  async setKey(raw: string): Promise<AppsView> {
    const key = raw.trim();
    this.problem = undefined;
    if (key === "") {
      this.opts.secrets.delete(COMPOSIO_ACCOUNT);
      this.reset();
      return { hasKey: false, apps: [] };
    }
    // A key can be valid and still not allowed to make sessions, which everything here needs:
    // make the settings session now, so such a key is not saved.
    let browse: Session;
    try {
      await this.client(key).checkKey();
      browse = await this.session(key, []);
    } catch (error) {
      const text = keyProblem(error) ?? `没能检查这个 Composio API Key：${why(error)}`;
      return { ...(await this.view()), problem: text };
    }
    this.opts.secrets.set(COMPOSIO_ACCOUNT, key);
    this.reset();
    this.browse = Promise.resolve(browse);
    const view = await this.view();
    this.opts.emit(view);
    return view;
  }

  /** A sign-in link for the app; the result comes as an emitted view. */
  async connect(slug: string): Promise<{ url: string }> {
    const key = this.key();
    if (key === undefined) throw new Error("先填写 Composio API Key");
    this.problem = undefined;
    const link = await this.onBrowse(key, (s) => this.client(key).link(s.id, slug));
    this.connecting.add(slug);
    void this.poll(key, slug, link.accountId, this.generation);
    void this.changed();
    return { url: link.url };
  }

  private async poll(key: string, slug: string, accountId: string, gen: number): Promise<void> {
    const until = this.now() + CONNECT_TIMEOUT_MS;
    let status = "INITIATED";
    while (this.now() < until && gen === this.generation) {
      await this.sleep(POLL_MS);
      if (gen !== this.generation) return;
      try {
        status = (await this.client(key).account(accountId)).status;
      } catch (error) {
        this.opts.log?.(`[apps] ${slug}: ${why(error)}`);
        continue;
      }
      if (status === "ACTIVE" || FAILED.has(status)) break;
    }
    if (gen !== this.generation) return;
    this.connecting.delete(slug);
    if (status !== "ACTIVE") {
      this.problem = FAILED.has(status)
        ? `${slug} 没有连上（${status}）`
        : `${slug} 等了 5 分钟还没连上`;
    }
    await this.changed();
  }

  async disconnect(slug: string): Promise<AppsView> {
    const key = this.key();
    if (key === undefined) return { hasKey: false, apps: [] };
    this.problem = undefined;
    await this.refreshConnected(key);
    const account = this.connected.find((t) => t.slug === slug)?.account;
    if (account !== undefined) await this.client(key).disconnect(account.id);
    const view = await this.view();
    this.opts.emit(view);
    return view;
  }

  /** The session agents use: the connected toolkits only. */
  private workSession(key: string): Promise<Session> {
    const slugs = this.connected.map((t) => t.slug).sort();
    const id = slugs.join(",");
    if (this.work?.key !== id) {
      const session = this.session(key, slugs);
      this.work = { key: id, session };
      session.catch(() => {
        if (this.work?.session === session) this.work = undefined;
      });
    }
    return this.work.session;
  }

  private async describe(key: string, slugs: readonly string[]): Promise<Map<string, AppToolInfo>> {
    const out = new Map<string, AppToolInfo>();
    for (const slug of new Set(slugs)) {
      const cached = this.described.get(slug);
      if (cached !== undefined && this.now() - cached.at < DESCRIBE_TTL_MS) {
        out.set(slug, cached.info);
        continue;
      }
      try {
        const t = await this.client(key).tool(slug);
        const hints = hintsOf(t.tags);
        // /tools/{slug} names the toolkit by its slug ("gmail"); the toolkit list has "Gmail".
        const toolkitName = this.connected.find((c) => c.slug === t.toolkit)?.name ?? t.toolkitName;
        const info: AppToolInfo = {
          title: `${toolkitName}: ${t.name}`,
          toolkit: t.toolkit,
          ...(hints === undefined ? {} : { hints }),
        };
        this.described.set(slug, { info, at: this.now() });
        out.set(slug, info);
      } catch (error) {
        // Unknown tools go to the owner.
        this.opts.log?.(`[apps] no details for ${slug}: ${why(error)}`);
      }
    }
    return out;
  }

  /** What agents may use now; undefined without a key. */
  appTools(): AppTools | undefined {
    const key = this.key();
    if (key === undefined) return undefined;
    return {
      list: async () => (await this.workSession(key)).mcp.listTools(),
      describe: (slugs) => this.describe(key, slugs),
      call: async (name, args) => (await this.workSession(key)).mcp.callTool(name, args),
    };
  }
}
