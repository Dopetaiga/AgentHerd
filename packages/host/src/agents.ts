// The agents the owner can run, where each CLI comes from, and downloads of the ones the app can
// install (runtimes.ts). The host keeps one Agents and rebuilds profiles when it changes.

import type { AgentProfile } from "@agentherd/protocol";
import type { AgentView } from "./api.ts";
import { DSH_APP_BIN, findDsh, findPi } from "./profiles.ts";
import { PI_RUNTIME, type RuntimeLock, type RuntimeStore } from "./runtimes.ts";

export interface AgentsOptions {
  store: RuntimeStore;
  /** Pinned Pi build (tests pass a local one). */
  piRuntime?: RuntimeLock;
  env?: NodeJS.ProcessEnv;
  findDsh?: () => string | undefined;
  /** Pi on the system (not downloaded by the app). */
  findSystemPi?: () => string | undefined;
  onChange: () => void;
  log?: (line: string) => void;
}

interface Install {
  progress: { received: number; total: number };
  abort: AbortController;
}

export class Agents {
  private readonly opts: AgentsOptions;
  private readonly installs = new Map<string, Install>();
  private readonly errors = new Map<string, string>();

  constructor(opts: AgentsOptions) {
    this.opts = opts;
  }

  private get pi(): RuntimeLock {
    return this.opts.piRuntime ?? PI_RUNTIME;
  }

  /** Pi to run: AGENTHERD_PI, then the app's download, then `pi` on PATH. */
  piPath(): string | undefined {
    const explicit = (this.opts.env ?? process.env).AGENTHERD_PI;
    if (explicit !== undefined && explicit !== "") return explicit;
    return this.opts.store.installed(this.pi) ?? this.systemPi();
  }

  dshPath(): string | undefined {
    return (this.opts.findDsh ?? (() => findDsh(this.opts.env ?? process.env)))();
  }

  private systemPi(): string | undefined {
    return (
      this.opts.findSystemPi ?? (() => findPi({ PATH: (this.opts.env ?? process.env).PATH }))
    )();
  }

  views(configured: AgentProfile[], modelRefs: Record<string, string>): AgentView[] {
    const views: AgentView[] = [this.dshView(), this.piView()];
    for (const p of configured) {
      const i = views.findIndex((v) => v.id === p.id);
      const view: AgentView = {
        id: p.id,
        name: p.name,
        state: "ready",
        source: "config",
        path: p.command[0] ?? "",
        canInstall: false,
        canRemove: false,
      };
      if (i >= 0) views[i] = view;
      else views.push(view);
    }
    return views.map((v) => {
      const ref = modelRefs[v.id];
      return ref === undefined || v.source === "config" ? v : { ...v, modelRef: ref };
    });
  }

  private dshView(): AgentView {
    const path = this.dshPath();
    if (path === undefined) {
      return {
        id: "dsh",
        name: "DeepSeek Harness",
        state: "missing",
        canInstall: false,
        canRemove: false,
      };
    }
    return {
      id: "dsh",
      name: "DeepSeek Harness",
      state: "ready",
      source: path === DSH_APP_BIN ? "app" : "system",
      path,
      canInstall: false,
      canRemove: false,
    };
  }

  private piView(): AgentView {
    const lock = this.pi;
    const base = { id: "pi", name: "Pi", version: lock.version };
    const error = this.errors.get("pi");
    const withError = error === undefined ? {} : { error };
    const install = this.installs.get("pi");
    if (install !== undefined) {
      return {
        ...base,
        state: "installing",
        progress: install.progress,
        canInstall: false,
        canRemove: false,
      };
    }
    const managed = this.opts.store.installed(lock);
    const path = this.piPath();
    if (path !== undefined) {
      return {
        ...base,
        state: "ready",
        source: path === managed ? "managed" : "system",
        path,
        canInstall: false,
        canRemove: managed !== undefined,
      };
    }
    if (!this.opts.store.supported(lock)) {
      return { ...base, state: "unsupported", canInstall: false, canRemove: false };
    }
    return { ...base, state: "missing", canInstall: true, canRemove: false, ...withError };
  }

  /** Starts a download in the background; onChange fires on progress and at the end. */
  install(id: string): void {
    if (id !== "pi") throw new Error(`AgentHerd cannot download "${id}"`);
    if (this.installs.has(id)) return;
    const install: Install = { progress: { received: 0, total: 0 }, abort: new AbortController() };
    this.installs.set(id, install);
    this.errors.delete(id);
    this.opts.onChange();
    this.opts.store
      .install(
        this.pi,
        (p) => {
          install.progress = p;
          this.opts.onChange();
        },
        install.abort.signal,
      )
      .then(
        (bin) => this.opts.log?.(`[agents] installed ${id} at ${bin}`),
        (error: Error) => {
          if (!install.abort.signal.aborted) this.errors.set(id, error.message);
          this.opts.log?.(`[agents] could not install ${id}: ${error.message}`);
        },
      )
      .finally(() => {
        this.installs.delete(id);
        this.opts.onChange();
      });
  }

  cancel(id: string): void {
    this.installs.get(id)?.abort.abort();
  }

  remove(id: string): void {
    if (id !== "pi") throw new Error(`"${id}" was not downloaded by AgentHerd`);
    if (this.installs.has(id)) throw new Error("wait for the download to finish or cancel it");
    this.opts.store.remove(this.pi);
    this.errors.delete(id);
    this.opts.onChange();
  }

  /** Waits for running downloads (tests). */
  async idle(): Promise<void> {
    while (this.installs.size > 0) await new Promise((r) => setTimeout(r, 20));
  }

  stop(): void {
    for (const i of this.installs.values()) i.abort.abort();
  }
}
