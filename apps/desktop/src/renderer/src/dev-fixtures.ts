// Sample data for the in-memory dev bridge (dev-bridge.ts): a placeholder QR code,
// tasks, model services and the provider catalog.

import type { ModelsView, ProviderView, TasksView } from "@agentherd/host/api";

export const PLACEHOLDER_QR = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">
<rect width="21" height="21" fill="#fff"/>
<path fill="#000" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM9 1h2v2H9zM8 4h3v2H8zM9 8h3v3H9zM13 9h2v2h-2zM16 9h3v2h-3zM8 13h2v3H8zM11 14h3v2h-3zM15 13h2v2h-2zM17 16h3v3h-3zM12 18h3v2h-3zM9 18h2v3H9z"/>
</svg>`,
)}`;

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

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

/** The sample tasks and approval items; none for the empty states. */
export function sampleTasks(empty: boolean): TasksView {
  return empty
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
          task("s4", "升级 Node 到 24", "infra", "stuck", "CI 里的镜像拉不下来，已经重试 3 次", 18),
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
}

/** The sample model services. */
export function sampleServices(): ModelsView["services"] {
  return [
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
      models: ["qwen3-coder-plus", "glm-4.6", "deepseek-chat"],
      hasKey: false,
    },
  ];
}

export const providers: ProviderView[] = [
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
