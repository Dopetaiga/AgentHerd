// A HerderHost that records what the Herder does, for unit tests.

import type { HerderHost, Task } from "@agentherd/core";
import { CORE_TEXTS } from "@agentherd/core";

export interface Recorded {
  said: string[];
  asked: { text: string; options: string[] }[];
  started: {
    profileId: string;
    cwd: string;
    title: string;
    prompt: string;
    model?: string;
    images?: string[];
  }[];
  prompted: { taskId: string; text: string; images?: string[] }[];
  renamed: { taskId: string; name: string }[];
  cancelled: string[];
  relays: string[];
  audits: { type: string; data: Record<string, unknown> }[];
  turns: { role: string; text: string }[];
  state: Map<string, unknown>;
}

export function task(id: string, title: string): Task {
  return {
    id,
    title,
    project: "app",
    agent: "Mock",
    stage: "working",
    lastReport: "",
    startedAt: "2026-11-04T07:00:00.000Z",
    updatedAt: "2026-11-04T07:00:00.000Z",
    automaticDecisions: [],
  };
}

export function fakeHost(
  opts: {
    tasks?: Task[];

    models?: { ref: string; agents: string[] }[];
    failing?: string[];
    profiles?: { id: string; name: string }[];
  } = {},
): {
  host: HerderHost;
  rec: Recorded;
} {
  const rec: Recorded = {
    said: [],
    asked: [],
    started: [],
    prompted: [],
    renamed: [],
    cancelled: [],
    relays: [],
    audits: [],
    turns: [],
    state: new Map(),
  };
  const tasks = opts.tasks ?? [];
  const host: HerderHost = {
    locale: "zh-CN",
    texts: CORE_TEXTS["zh-CN"],
    userHome: "/Users/me",
    profiles: () => opts.profiles ?? [{ id: "mock", name: "Mock" }],
    tasks: () => tasks,
    openTasks: () => tasks,
    relayTaskId: () => undefined,
    decisions: () => [],
    models: () => opts.models ?? [],
    checkModel: async (ref) =>
      opts.failing?.includes(ref) ? { ok: false, message: "down" } : { ok: true },
    startTask: async (profileId, cwd, title, prompt, model, images) => {
      rec.started.push({
        profileId,
        cwd,
        title,
        prompt,
        ...(model === undefined ? {} : { model }),
        ...(images === undefined ? {} : { images: images.map((i) => i.path) }),
      });
      return `task-${rec.started.length}-0000-0000`;
    },
    promptTask: (taskId, text, images) =>
      void rec.prompted.push({
        taskId,
        text,
        ...(images === undefined ? {} : { images: images.map((i) => i.path) }),
      }),
    renameTask: (taskId, name) => void rec.renamed.push({ taskId, name }),
    cancelTurn: async (taskId) => void rec.cancelled.push(taskId),
    startRelay: async (taskId) => void rec.relays.push(taskId),
    endRelay: async () => void rec.relays.push("end"),
    say: async (text) => void rec.said.push(text),
    ask: async (text, options) => void rec.asked.push({ text, options }),
    audit: (type, data) => void rec.audits.push({ type, data }),
    recordTurn: (role, text) => void rec.turns.push({ role, text }),
    getState: <T>(key: string) => rec.state.get(key) as T | undefined,
    setState: (key, value) => void rec.state.set(key, structuredClone(value)),
  };
  return { host, rec };
}
