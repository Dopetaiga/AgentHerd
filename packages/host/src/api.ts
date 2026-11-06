// The local API of the AgentHerd host (docs/spec/02-architecture.md §4). The desktop app and the
// CLI use it; agents do not. Items are read-only here: the owner decides in the channel.
// These types have no runtime imports, so the renderer can import them too.

import type {
  CustomApi,
  MemoryRow,
  ModelRef,
  ModelRole,
  ModelService,
  ModelSettings,
  Task,
  TranscriptEntry,
} from "@agentherd/core";
import type { Locale, Mode, Risk } from "@agentherd/protocol";

export const API_VERSION = 1;

export interface ChannelStatus {
  bound: boolean;
  appId?: string;
  /** Connected to the chat app and following tasks. */
  connected: boolean;
  error?: string;
}

export interface HerderStatus {
  on: boolean;
  /** "service/model" when on. */
  ref?: string;
  /** Why it is off. */
  reason?: string;
}

export interface HostStatus {
  version: string;
  home: string;
  channel: ChannelStatus;
  herder: HerderStatus;
  mode: Mode;
  locale: Locale;
  keepAwake: boolean;
  /** Agent profile ids the owner can start with /run. */
  profiles: string[];
}

/** Where an agent's CLI comes from. */
export type AgentSource = "managed" | "system" | "app" | "config";

export interface AgentView {
  id: string;
  name: string;
  /** ready: can run tasks. missing: not found and can be downloaded or needs its app. */
  state: "ready" | "missing" | "installing" | "unsupported";
  source?: AgentSource;
  path?: string;
  /** Version the app downloads. */
  version?: string;
  /** Bytes, while installing. */
  progress?: { received: number; total: number };
  /** Last install error. */
  error?: string;
  /** The app can download it. */
  canInstall: boolean;
  /** A downloaded copy the owner can remove. */
  canRemove: boolean;
  /** Model passed to it ("service/model"), when it uses one from the model list. */
  modelRef?: string;
}

/** Result of starting an agent once to check it works (the 验证 button). */
export interface AgentCheck {
  id: string;
  ok: boolean;
  /** It started but wants the owner to sign in first (ACP authMethods, or an auth error). */
  needsLogin: boolean;
  /** Name and version the agent reported. */
  agentName?: string;
  agentVersion?: string;
  /** Sign-in methods it offers. */
  authMethods: string[];
  /** Why it failed, from the error and the last stderr lines. */
  error?: string;
  ms: number;
}

export interface ItemSummary {
  id: string;
  sessionId: string;
  title: string;
  body: string;
  risk: Risk;
  createdAt: string;
  cwd: string;
  profileId: string;
  taskTitle?: string;
}

export interface TasksView {
  tasks: Task[];
  /** Open items, waiting for the owner in the channel. */
  items: ItemSummary[];
}

/** What was said in one task; the app polls it while the task is open. */
export interface TranscriptView {
  entries: TranscriptEntry[];
  /** Reply text the agent is still writing. */
  live: string;
}

/** The Herder's long-term memory for the 记忆 page (ADR 0038). */
export interface MemoryView {
  /** Active entries, newest first, and the last deleted ones (to restore). */
  entries: MemoryRow[];
  deleted: MemoryRow[];
  /** Characters used and allowed of the kinds kept in the Herder's prompt. */
  used: { owner: number; note: number };
  caps: { owner: number; note: number };
  /** False while AgentHerd is not following tasks (no herd): nothing to show or change. */
  ready: boolean;
}

export interface ServiceView extends ModelService {
  hasKey: boolean;
}

export interface ModelsView {
  services: ServiceView[];
  roles: ModelSettings["roles"];
}

export interface ProviderView {
  provider: string;
  models: { id: string; name: string }[];
}

export type SetupPhase =
  | "idle"
  | "starting"
  | "waiting-scan"
  | "waiting-confirm"
  | "verifying"
  | "connected"
  | "failed";

export interface SetupState {
  phase: SetupPhase;
  /** The QR code as a data: URL, while waiting for the scan. */
  qrDataUrl?: string;
  url?: string;
  expiresAt?: string;
  error?: string;
}

export type ModelTest = { ok: true; reply: string } | { ok: false; message: string };

/** What to ask for a model list: a saved service, or the fields of one not saved yet. */
export interface ProbeTarget {
  /** A saved service: its address, API and key are the defaults for the fields below. */
  serviceId?: string;
  baseUrl?: string;
  api?: CustomApi;
  /** Empty or missing: the saved key of `serviceId`, if any. */
  key?: string;
}

/**
 * The models a service lists. `baseUrl` is set when the list was found under a different
 * address than the one given (a missing `/v1`), so the form can fix the address.
 */
export type ModelProbe =
  | { ok: true; models: { id: string; name: string }[]; baseUrl?: string }
  | { ok: false; message: string };

export interface SettingsPatch {
  mode?: Mode;
  keepAwake?: boolean;
}

/** Everything the host offers. Each method is one request on the socket. */
export type Tier = "strong" | "balanced" | "fast";

/** One model in the tier board; a model several services offer is one entry. */
export interface TierModelView {
  model: string;
  /** Names of the services offering it, in the order AgentHerd tries them. */
  services: string[];
  /** True when placed by AgentHerd's name rules, not by the owner. */
  auto: boolean;
}

/** The owner's models in three tiers (ADR 0028). */
export interface ModelTiersView {
  tiers: Record<Tier, TierModelView[]>;
  /** True when the owner has placed any model. */
  custom: boolean;
}

export interface HostApi {
  status(): HostStatus;
  tasks(): TasksView;
  /** The conversation of one task: prompts, replies and tool calls. */
  transcript(taskId: string): TranscriptView;
  memories(): MemoryView;
  /** Changes an entry's text; the old text stays in its history. */
  editMemory(id: string, text: string): MemoryView;
  forgetMemory(id: string): MemoryView;
  restoreMemory(id: string): MemoryView;
  providers(): ProviderView[];
  models(): ModelsView;
  /** Adds or replaces a service. `key`: undefined keeps the saved key, "" removes it. */
  putService(service: ModelService, key?: string): Promise<ModelsView>;
  removeService(serviceId: string): Promise<ModelsView>;
  setKey(serviceId: string, key: string): Promise<ModelsView>;
  chooseModel(role: ModelRole, ref: ModelRef | null): Promise<ModelsView>;
  testModel(ref: ModelRef): Promise<ModelTest>;
  /** Asks an OpenAI- or Anthropic-compatible service which models it offers (GET /models). */
  probeModels(target: ProbeTarget): Promise<ModelProbe>;
  /** Starts the one-scan Feishu setup; progress comes as "setup" events. */
  setupFeishu(): SetupState;
  cancelSetup(): SetupState;
  setupState(): SetupState;
  updateSettings(patch: SettingsPatch): HostStatus;
  /** The owner's models in tiers; the Herder reads them to pick a task's model (ADR 0028). */
  modelTiers(): ModelTiersView;
  /** Saves where the owner put each model (by name); null forgets it and uses the name rules. */
  setModelTiers(tiers: Record<Tier, string[]> | null): ModelTiersView;
  /** Connects the channel again, e.g. after a network failure. */
  reconnect(): Promise<HostStatus>;
  agents(): AgentView[];
  /** Starts downloading an agent's CLI; progress comes as "agents" events. */
  installAgent(id: string): AgentView[];
  cancelInstall(id: string): AgentView[];
  /** Removes a downloaded CLI. */
  removeAgent(id: string): AgentView[];
  /** Starts the agent in an empty folder, opens a session and closes it. */
  verifyAgent(id: string): Promise<AgentCheck>;
}

export type HostMethod = keyof HostApi;

export const HOST_METHODS: readonly HostMethod[] = [
  "status",
  "tasks",
  "transcript",
  "memories",
  "editMemory",
  "forgetMemory",
  "restoreMemory",
  "providers",
  "models",
  "putService",
  "removeService",
  "setKey",
  "chooseModel",
  "testModel",
  "probeModels",
  "setupFeishu",
  "cancelSetup",
  "setupState",
  "updateSettings",
  "modelTiers",
  "setModelTiers",
  "reconnect",
  "agents",
  "installAgent",
  "cancelInstall",
  "removeAgent",
  "verifyAgent",
];

export type HostEvent =
  | { topic: "status"; data: HostStatus }
  | { topic: "tasks"; data: TasksView }
  | { topic: "models"; data: ModelsView }
  | { topic: "setup"; data: SetupState }
  | { topic: "agents"; data: AgentView[] };

/** The same API, asynchronous, as seen by a client. */
export type RemoteHost = {
  [K in HostMethod]: (...args: Parameters<HostApi[K]>) => Promise<Awaited<ReturnType<HostApi[K]>>>;
};

// Wire format: one JSON object per line.
export interface CallMessage {
  v: number;
  id: number;
  type: "call";
  method: HostMethod;
  params: unknown[];
}

export interface ResultMessage {
  v: number;
  id: number;
  type: "result";
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface EventMessage {
  v: number;
  type: "event";
  event: HostEvent;
}
