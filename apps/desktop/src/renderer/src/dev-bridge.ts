// A fake bridge for previewing the UI in a plain browser (vite dev without Electron).
// It is installed only when the preload script did not set `window.agentherd`.
// `?sim=` picks the starting state:
//   fresh (default)  not bound, no Herder model: the first run opens
//   bound            bound and connected, no Herder model
//   keychain         bound, but reading the keychain was cancelled; 重新连接 then works
//   ready            bound, connected, Herder chosen

import type {
  HostEvent,
  HostStatus,
  ModelsView,
  ProviderView,
  RemoteHost,
  SetupState,
  TasksView,
} from "@agentherd/host/api";
import type { Bridge } from "../../shared/bridge";

type Listener<T> = (value: T) => void;

const PLACEHOLDER_QR = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">
<rect width="21" height="21" fill="#fff"/>
<path fill="#000" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM9 1h2v2H9zM8 4h3v2H8zM9 8h3v3H9zM13 9h2v2h-2zM16 9h3v2h-3zM8 13h2v3H8zM11 14h3v2h-3zM15 13h2v2h-2zM17 16h3v3h-3zM12 18h3v2h-3zM9 18h2v3H9z"/>
</svg>`,
)}`;

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

type Sim = "fresh" | "bound" | "keychain" | "ready";

function simulation(): Sim {
  const value = new URLSearchParams(window.location.search).get("sim");
  return value === "bound" || value === "keychain" || value === "ready" ? value : "fresh";
}

function installFakeBridge(): void {
  const sim = simulation();
  const eventListeners = new Set<Listener<HostEvent>>();
  const connectionListeners = new Set<Listener<boolean>>();
  const keys = new Map<string, string>([["deepseek", "sk-fake"]]);
  let setupTimers: ReturnType<typeof setTimeout>[] = [];

  let status: HostStatus = {
    version: "0.0.0-dev",
    home: "~/.agentherd",
    channel:
      sim === "fresh"
        ? { bound: false, connected: false }
        : sim === "keychain"
          ? {
              bound: true,
              appId: "cli_fake123",
              connected: false,
              error: "Platform failure: User canceled the operation.",
            }
          : { bound: true, appId: "cli_fake123", connected: true },
    herder:
      sim === "ready"
        ? { on: true, ref: "deepseek/deepseek-chat" }
        : { on: false, reason: "no model chosen for the Herder" },
    mode: "observe",
    locale: "zh-CN",
    keepAwake: true,
    profiles: ["dsh"],
  };

  const tasks: TasksView = {
    tasks: [
      {
        id: "s1",
        title: "修复登录页在 Safari 上的白屏",
        project: "web-portal",
        agent: "dsh",
        stage: "needs-owner",
        lastReport: "想执行 npm publish，等你批准",
        startedAt: minutesAgo(42),
        updatedAt: minutesAgo(3),
        automaticDecisions: [],
      },
      {
        id: "s2",
        title: "给订单服务补单元测试",
        project: "order-service",
        agent: "dsh",
        stage: "working",
        lastReport: "已写完 12 个测试，正在跑 npm test",
        startedAt: minutesAgo(25),
        updatedAt: minutesAgo(1),
        automaticDecisions: ["按规则 r1 自动批准：npm test"],
      },
    ],
    items: [
      {
        id: "i1",
        sessionId: "s1",
        title: "执行命令",
        body: "npm publish --access public --tag next ./packages/web-portal",
        risk: "high",
        createdAt: minutesAgo(3),
        cwd: "/Users/me/code/web-portal",
        profileId: "dsh",
        taskTitle: "修复登录页在 Safari 上的白屏",
      },
    ],
  };

  let models: ModelsView = {
    services: [
      {
        id: "deepseek",
        name: "DeepSeek",
        kind: "builtin",
        provider: "deepseek",
        models: ["deepseek-chat", "deepseek-reasoner"],
        hasKey: true,
      },
    ],
    roles: sim === "ready" ? { herder: { serviceId: "deepseek", model: "deepseek-chat" } } : {},
  };

  const providers: ProviderView[] = [
    {
      provider: "deepseek",
      models: [
        { id: "deepseek-chat", name: "DeepSeek Chat" },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
      ],
    },
    {
      provider: "anthropic",
      models: [
        { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
        { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
      ],
    },
    {
      provider: "openai",
      models: [
        { id: "gpt-5", name: "GPT-5" },
        { id: "gpt-5-mini", name: "GPT-5 mini" },
      ],
    },
    {
      provider: "google",
      models: [
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      ],
    },
    {
      provider: "openrouter",
      models: [
        { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5" },
        { id: "qwen/qwen3-coder", name: "Qwen: Qwen3 Coder" },
      ],
    },
  ];

  let setup: SetupState = { phase: "idle" };

  const emit = (event: HostEvent): void => {
    for (const l of eventListeners) l(event);
  };
  const delay = <T>(value: T, ms = 150): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));

  const herderStatus = (): HostStatus["herder"] => {
    const ref = models.roles.herder;
    return ref === undefined
      ? { on: false, reason: "no model chosen for the Herder" }
      : { on: true, ref: `${ref.serviceId}/${ref.model}` };
  };
  const modelsChanged = (): ModelsView => {
    // Like core: roles that point at models no longer listed are cleared.
    const roles: ModelsView["roles"] = {};
    for (const role of ["herder", "reviewer"] as const) {
      const ref = models.roles[role];
      if (ref === undefined) continue;
      const s = models.services.find((x) => x.id === ref.serviceId);
      if (s?.models.includes(ref.model)) roles[role] = ref;
    }
    models = { ...models, roles };
    status = { ...status, herder: herderStatus() };
    emit({ topic: "models", data: structuredClone(models) });
    emit({ topic: "status", data: structuredClone(status) });
    return models;
  };
  const setSetup = (next: SetupState): void => {
    setup = next;
    emit({ topic: "setup", data: structuredClone(setup) });
  };

  const fake: RemoteHost = {
    status: () => delay(status),
    reconnect: () => {
      // The second try reads the keychain fine.
      if (status.channel.bound) {
        status = {
          ...status,
          channel: { bound: true, appId: status.channel.appId, connected: true },
        };
        emit({ topic: "status", data: structuredClone(status) });
      }
      return delay(status, 900);
    },
    tasks: () => delay(tasks),
    providers: () => delay(providers),
    models: () => delay(models),
    putService: (service, key) => {
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(service.id)) {
        return Promise.reject(new Error(`service id "${service.id}" is invalid`));
      }
      if (service.models.length === 0) {
        return Promise.reject(new Error(`service "${service.id}" has no models`));
      }
      if (key === "") keys.delete(service.id);
      else if (key !== undefined) keys.set(service.id, key);
      const others = models.services.filter((s) => s.id !== service.id);
      models = {
        ...models,
        services: [...others, { ...service, hasKey: keys.has(service.id) }],
      };
      return delay(modelsChanged());
    },
    removeService: (serviceId) => {
      keys.delete(serviceId);
      models = { ...models, services: models.services.filter((s) => s.id !== serviceId) };
      return delay(modelsChanged());
    },
    setKey: (serviceId, key) => {
      if (key === "") keys.delete(serviceId);
      else keys.set(serviceId, key);
      models = {
        ...models,
        services: models.services.map((s) =>
          s.id === serviceId ? { ...s, hasKey: keys.has(serviceId) } : s,
        ),
      };
      return delay(modelsChanged());
    },
    chooseModel: (role, ref) => {
      const roles = { ...models.roles };
      if (ref === null) delete roles[role];
      else roles[role] = ref;
      models = { ...models, roles };
      return delay(modelsChanged());
    },
    testModel: (ref) => {
      const s = models.services.find((x) => x.id === ref.serviceId);
      if (s === undefined) return delay({ ok: false, message: `no service "${ref.serviceId}"` });
      if (!keys.has(s.id) && s.kind === "builtin") {
        return delay({ ok: false, message: "401 Unauthorized: missing API key" }, 700);
      }
      return delay({ ok: true, reply: `你好，我是 ${ref.model}。` }, 900);
    },
    setupFeishu: () => {
      for (const t of setupTimers) clearTimeout(t);
      setupTimers = [];
      setSetup({
        phase: "waiting-scan",
        qrDataUrl: PLACEHOLDER_QR,
        url: "https://open.feishu.cn/example",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      setupTimers.push(
        setTimeout(() => setSetup({ phase: "waiting-confirm" }), 5000),
        setTimeout(() => setSetup({ phase: "verifying" }), 8000),
        setTimeout(() => {
          status = {
            ...status,
            channel: { bound: true, appId: "cli_fake123", connected: true },
          };
          setSetup({ phase: "connected" });
          emit({ topic: "status", data: structuredClone(status) });
        }, 10000),
      );
      return delay(setup);
    },
    cancelSetup: () => {
      for (const t of setupTimers) clearTimeout(t);
      setupTimers = [];
      setup = { phase: "idle" };
      return delay(setup);
    },
    setupState: () => delay(setup),
    updateSettings: (patch) => {
      status = { ...status, ...patch };
      emit({ topic: "status", data: structuredClone(status) });
      return delay(status);
    },
  };

  const fakeBridge: Bridge = {
    host: fake,
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onConnection: (listener) => {
      connectionListeners.add(listener);
      setTimeout(() => listener(true), 0);
      return () => connectionListeners.delete(listener);
    },
  };
  window.agentherd = fakeBridge;
  console.info("[AgentHerd] window.agentherd not found; using the in-memory dev bridge.");
}

if ((window as Partial<Window>).agentherd === undefined) installFakeBridge();
