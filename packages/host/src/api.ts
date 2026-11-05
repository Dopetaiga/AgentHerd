// The local API of the AgentHerd host (docs/spec/02-architecture.md §4). The desktop app and the
// CLI use it; agents do not. Items are read-only here: the owner decides in the channel.
// These types have no runtime imports, so the renderer can import them too.

import type { ModelRef, ModelRole, ModelService, ModelSettings, Task } from "@agentherd/core";
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

export interface SettingsPatch {
  mode?: Mode;
  keepAwake?: boolean;
}

/** Everything the host offers. Each method is one request on the socket. */
export interface ModelGuideView {
  /** The guide in effect. */
  text: string;
  /** True when the owner wrote it; false when it is AgentHerd's default. */
  custom: boolean;
  defaultText: string;
}

export interface HostApi {
  status(): HostStatus;
  tasks(): TasksView;
  providers(): ProviderView[];
  models(): ModelsView;
  /** Adds or replaces a service. `key`: undefined keeps the saved key, "" removes it. */
  putService(service: ModelService, key?: string): Promise<ModelsView>;
  removeService(serviceId: string): Promise<ModelsView>;
  setKey(serviceId: string, key: string): Promise<ModelsView>;
  chooseModel(role: ModelRole, ref: ModelRef | null): Promise<ModelsView>;
  testModel(ref: ModelRef): Promise<ModelTest>;
  /** Copies PI-Desktop's model services and keys into the list (ADR 0027). */
  importPiDesktop(): Promise<PiDesktopImport>;
  /** Starts the one-scan Feishu setup; progress comes as "setup" events. */
  setupFeishu(): SetupState;
  cancelSetup(): SetupState;
  setupState(): SetupState;
  updateSettings(patch: SettingsPatch): HostStatus;
  /** The guide the Herder reads to pick a task's model (ADR 0026). */
  modelGuide(): ModelGuideView;
  /** Saves the owner's guide; null or "" goes back to AgentHerd's default. */
  setModelGuide(text: string | null): ModelGuideView;
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
  "providers",
  "models",
  "putService",
  "removeService",
  "setKey",
  "chooseModel",
  "testModel",
  "importPiDesktop",
  "setupFeishu",
  "cancelSetup",
  "setupState",
  "updateSettings",
  "modelGuide",
  "setModelGuide",
  "reconnect",
  "agents",
  "installAgent",
  "cancelInstall",
  "removeAgent",
  "verifyAgent",
];

export interface PiDesktopImport {
  /** Services added, by name. */
  added: string[];
  /** Services already in the list that gained models, by name. */
  merged: string[];
  skipped: { name: string; reason: string }[];
  models: ModelsView;
}

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
