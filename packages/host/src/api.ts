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
  /** Starts the one-scan Feishu setup; progress comes as "setup" events. */
  setupFeishu(): SetupState;
  cancelSetup(): SetupState;
  setupState(): SetupState;
  updateSettings(patch: SettingsPatch): HostStatus;
  /** Connects the channel again, e.g. after the owner allowed keychain access. */
  reconnect(): Promise<HostStatus>;
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
  "setupFeishu",
  "cancelSetup",
  "setupState",
  "updateSettings",
  "reconnect",
];

export type HostEvent =
  | { topic: "status"; data: HostStatus }
  | { topic: "tasks"; data: TasksView }
  | { topic: "models"; data: ModelsView }
  | { topic: "setup"; data: SetupState };

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
