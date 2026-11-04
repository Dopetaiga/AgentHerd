// A fake bridge for previewing the UI in a plain browser (vite dev without Electron).
// It is installed only when the preload script did not set `window.agentherd`.
// `?sim=` picks the starting state:
//   fresh (default)  not bound, no Herder model: the first run opens
//   bound            bound and connected, no Herder model
//   network          bound, but connecting to Feishu failed; 重新连接 then works
//   ready            bound, connected, Herder chosen
//   empty            like ready, with no tasks
//   no-agent         like empty, with no agent profiles
//   offline          like ready, then the connection to the host drops
// `?open=` opens a dialog at once, for screenshots (see `devOpen`):
//   add-service      the 添加服务 chooser
//   add-builtin      the 添加服务 form of OpenRouter, with a few models chosen
//   add-custom       the 添加服务 form of an OpenAI-compatible address
//   edit-<id>        the edit dialog of the service <id> (deepseek, gateway)

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

const SIMS = ["fresh", "bound", "network", "ready", "empty", "no-agent", "offline"] as const;

type Sim = (typeof SIMS)[number];

const OPENROUTER_MODELS: readonly (readonly [string, string])[] = [
  ["anthropic/claude-sonnet-4.5", "Anthropic: Claude Sonnet 4.5"],
  ["anthropic/claude-opus-4.1", "Anthropic: Claude Opus 4.1"],
  ["anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5"],
  ["openai/gpt-5", "OpenAI: GPT-5"],
  ["openai/gpt-5-mini", "OpenAI: GPT-5 mini"],
  ["openai/gpt-5-codex", "OpenAI: GPT-5 Codex"],
  ["openai/gpt-oss-120b", "OpenAI: gpt-oss-120b"],
  ["google/gemini-2.5-pro", "Google: Gemini 2.5 Pro"],
  ["google/gemini-2.5-flash", "Google: Gemini 2.5 Flash"],
  ["google/gemini-2.5-flash-lite", "Google: Gemini 2.5 Flash Lite"],
  ["deepseek/deepseek-chat-v3.1", "DeepSeek: DeepSeek V3.1"],
  ["deepseek/deepseek-r1-0528", "DeepSeek: R1 0528"],
  ["qwen/qwen3-coder", "Qwen: Qwen3 Coder"],
  ["qwen/qwen3-max", "Qwen: Qwen3 Max"],
  ["qwen/qwen3-235b-a22b-2507", "Qwen: Qwen3 235B A22B 2507"],
  ["moonshotai/kimi-k2-0905", "MoonshotAI: Kimi K2 0905"],
  ["z-ai/glm-4.6", "Z.AI: GLM 4.6"],
  ["z-ai/glm-4.5-air", "Z.AI: GLM 4.5 Air"],
  ["x-ai/grok-4", "xAI: Grok 4"],
  ["x-ai/grok-code-fast-1", "xAI: Grok Code Fast 1"],
  ["mistralai/devstral-medium", "Mistral: Devstral Medium"],
  ["mistralai/mistral-medium-3.1", "Mistral: Mistral Medium 3.1"],
  ["meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick"],
  ["minimax/minimax-m2", "MiniMax: MiniMax M2"],
];

function simulation(): Sim {
  const value = new URLSearchParams(window.location.search).get("sim");
  return SIMS.find((s) => s === value) ?? "fresh";
}

function installFakeBridge(): void {
  const sim = simulation();
  const herderChosen = sim !== "fresh" && sim !== "bound" && sim !== "network";
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
        : sim === "network"
          ? {
              bound: true,
              appId: "cli_fake123",
              connected: false,
              error: "getaddrinfo ENOTFOUND open.feishu.cn",
            }
          : { bound: true, appId: "cli_fake123", connected: true },
    herder: herderChosen
      ? { on: true, ref: "deepseek/deepseek-chat" }
      : { on: false, reason: "no model chosen for the Herder" },
    mode: "observe",
    locale: "zh-CN",
    keepAwake: true,
    profiles: sim === "no-agent" ? [] : ["dsh"],
  };

  const task = (
    id: string,
    title: string,
    project: string,
    stage: TasksView["tasks"][number]["stage"],
    lastReport: string,
    updated: number,
  ): TasksView["tasks"][number] => ({
    id,
    title,
    project,
    agent: "dsh",
    stage,
    lastReport,
    startedAt: minutesAgo(updated + 30),
    updatedAt: minutesAgo(updated),
    automaticDecisions: [],
  });

  const tasks: TasksView =
    sim === "empty" || sim === "no-agent"
      ? { tasks: [], items: [] }
      : {
          tasks: [
            task(
              "s1",
              "修复登录页在 Safari 上的白屏",
              "web-portal",
              "needs-owner",
              "修好了，想发一个 next 版本验证，等你批准",
              3,
            ),
            task(
              "s2",
              "给订单服务补单元测试",
              "order-service",
              "working",
              "已写完 12 个测试，正在跑 npm test",
              1,
            ),
            task("s3", "把日志库换成 pino", "order-service", "queued", "", 6),
            task(
              "s4",
              "升级 Node 到 24",
              "infra",
              "stuck",
              "CI 里的镜像拉不下来，已经重试 3 次",
              18,
            ),
            task("s5", "整理 README 的安装步骤", "web-portal", "done", "已提交 PR #128", 55),
            task("s6", "迁移旧的用户表", "order-service", "failed", "迁移脚本报错：外键冲突", 120),
            task("s7", "给首页加骨架屏", "web-portal", "done", "已提交 PR #127", 240),
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
            {
              id: "i2",
              sessionId: "s0",
              title: "写入文件",
              body: "~/.npmrc: registry=https://npm.example.com/",
              risk: "medium",
              createdAt: minutesAgo(9),
              cwd: "/Users/me/code/scratch",
              profileId: "dsh",
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
      {
        id: "gateway",
        name: "公司网关",
        kind: "openai-compatible",
        baseUrl: "https://llm.example.com/v1",
        models: ["qwen3-coder-plus", "glm-4.6"],
        hasKey: false,
      },
    ],
    roles: herderChosen ? { herder: { serviceId: "deepseek", model: "deepseek-chat" } } : {},
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
      // Many models, so the model panes can be seen scrolling.
      models: OPENROUTER_MODELS.map(([id, name]) => ({ id, name })),
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
      // The second try connects.
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
      if (sim === "offline") setTimeout(() => listener(false), 1000);
      return () => connectionListeners.delete(listener);
    },
  };
  window.agentherd = fakeBridge;
  console.info("[AgentHerd] window.agentherd not found; using the in-memory dev bridge.");
}

let fakeInstalled = false;
if ((window as Partial<Window>).agentherd === undefined) {
  installFakeBridge();
  fakeInstalled = true;
}

/** The dialog named by `?open=`; only with the fake bridge, so never in the real app. */
export function devOpen(): string | null {
  return fakeInstalled ? new URLSearchParams(window.location.search).get("open") : null;
}
