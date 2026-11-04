// Chinese labels and small formatters shared by pages.

import type { SetupPhase } from "@agentherd/host/api";
import type { ItemSummary, Stage } from "../store";
import type { Tone } from "./ui";

export const STAGE_LABEL: Record<Stage, { text: string; tone: Tone }> = {
  queued: { text: "排队中", tone: "gray" },
  working: { text: "进行中", tone: "blue" },
  "needs-owner": { text: "等你处理", tone: "amber" },
  stuck: { text: "卡住了", tone: "orange" },
  done: { text: "已完成", tone: "green" },
  failed: { text: "失败", tone: "red" },
};

export const STAGE_ORDER: Record<Stage, number> = {
  "needs-owner": 0,
  stuck: 1,
  working: 2,
  queued: 3,
  failed: 4,
  done: 5,
};

export const RISK_LABEL: Record<ItemSummary["risk"], { text: string; tone: Tone }> = {
  low: { text: "低风险", tone: "green" },
  medium: { text: "中风险", tone: "amber" },
  high: { text: "高风险", tone: "red" },
};

export const SETUP_PHASE_LABEL: Record<SetupPhase, string> = {
  idle: "未开始",
  starting: "正在准备二维码…",
  "waiting-scan": "等待扫码",
  "waiting-confirm": "已扫码，请在飞书里确认",
  verifying: "正在验证…",
  connected: "已连接",
  failed: "失败",
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  xai: "xAI",
  groq: "Groq",
  mistral: "Mistral",
  cerebras: "Cerebras",
  zai: "智谱 Z.ai",
  moonshot: "Moonshot (Kimi)",
  "amazon-bedrock": "Amazon Bedrock",
  "github-copilot": "GitHub Copilot",
  "vercel-ai-gateway": "Vercel AI Gateway",
  minimax: "MiniMax",
  huggingface: "Hugging Face",
};

/** A readable name for a pi-ai provider id. */
export function providerName(provider: string): string {
  const known = PROVIDER_NAMES[provider];
  if (known !== undefined) return known;
  return provider
    .split("-")
    .map((w) => (w === "" ? w : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** "HH:MM" in local time, or "—" for a bad date. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A service id made from a name: lowercase letters, digits and "-". */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug === "" ? "custom" : slug;
}

/** `base`, or `base-2`, `base-3`… if taken. */
export function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base.slice(0, 37)}-${i}`;
    if (!taken.includes(id)) return id;
  }
}

/** Splits a comma/newline separated list of model ids, without blanks or repeats. */
export function parseModelList(text: string): string[] {
  const ids = text
    .split(/[,\n，]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return [...new Set(ids)];
}

/** The host explains in English (shared with the CLI); show the known reasons in Chinese. */
export function herderReasonLabel(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  if (reason === "no model chosen for the Herder") return "还没给主管选模型";
  const key = /^no key for service "(.+)"$/.exec(reason);
  if (key) return `服务「${key[1]}」没有 Key`;
  return reason;
}

/** The channel error in Chinese where it is a known one; other errors as the host wrote them. */
export function channelErrorLabel(error: string): string {
  if (/^no App Secret for /.test(error))
    return "找不到飞书机器人的密钥（~/.agentherd/secrets.json），请重新扫码绑定飞书。";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(error))
    return "连不上飞书，检查一下网络后点「重新连接」。";
  return error;
}

/** The channel is bound but could not connect, and the host says why: the owner can retry. */
export function canReconnect(channel: {
  bound: boolean;
  connected: boolean;
  error?: string | undefined;
}): boolean {
  return channel.bound && !channel.connected && channel.error !== undefined && channel.error !== "";
}
