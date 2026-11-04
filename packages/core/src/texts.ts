// Everything the core says to the owner, per locale (docs/spec/05-channels.md "Language").
// Commands stay in English in every locale. Agent words are never translated (verbatim rule).

import type { Locale, ReportResult } from "@agentherd/protocol";

export interface CoreTexts {
  help: string;
  noHerder: string;
  usage(usage: string): string;
  noMatch(query: string): string;
  manyMatches(query: string, list: string): string;
  noRelay: string;
  queued: string;
  unknownAgent(agent: string, known: string): string;
  notDirectory(path: string): string;
  taskEnded: string;
  noReply: string;
  // Board "last report" column.
  starting: string;
  couldNotStart(message: string): string;
  relayed(line: string): string;
  reported(line: string): string;
  watchdog(detail: string): string;
  // Report bodies written by AgentHerd (not by the agent).
  couldNotStartBody(message: string): string;
  failedBody(message: string): string;
  result: Record<ReportResult, string>;
  /** Between the result and the task in a report title. */
  titleSep: string;
  // Watchdog details.
  repeatedToolCall(count: number, label: string): string;
  quiet(minutes: number): string;
  exited(code: string): string;
  // Automatic decisions in the report.
  byRule(allowed: boolean, ruleId: string | undefined, what: string): string;
  // Items.
  allow: string;
  deny: string;
  reason(text: string): string;
  allowedByYou: string;
  deniedByYou: string;
  expired(why: string): string;
  stillWaiting(title: string): string;
  // Why an item expired or a task ended.
  turnEnded: string;
  agentStoppedWaiting: string;
  agentherdStopped: string;
  runFinished: string;
  agentCouldNotStart: string;
  agentExited: string;
  turnFailed: string;
  // Prompts to the agent, labeled as from AgentHerd.
  replyHint(chars: number): string;
  summaryPrompt(chars: number): string;
}

const HELP_ZH = `status — 查看任务看板
/run <agent> <目录> <任务> — 开始一个任务
/relay <任务> — 直接和某个任务对话
/end — 结束转接
/interrupt <内容> — 打断当前这一轮，再发送内容
/herder <内容> — 转接期间和主管说话
/help — 显示这个列表`;

const HELP_EN = `status — show the task board
/run <agent> <dir> <task> — start a task
/relay <task> — talk to a task directly
/end — end the relay
/interrupt <text> — stop the current turn and send text
/herder <text> — talk to the Herder during a relay
/help — this list`;

const zh: CoreTexts = {
  help: HELP_ZH,
  noHerder: `还没有配置主管模型，现在只能用命令：\n${HELP_ZH}`,
  usage: (u) => `用法：${u}`,
  noMatch: (q) => `没有找到和"${q}"匹配的进行中任务。`,
  manyMatches: (q, list) => `有多个任务和"${q}"匹配：\n${list}`,
  noRelay: "现在没有在转接。",
  queued: "已排队：Agent 这一轮结束后会收到这条消息。",
  unknownAgent: (a, known) => `没有叫"${a}"的 Agent。可用的有：${known}。`,
  notDirectory: (p) => `不是一个目录：${p}`,
  taskEnded: "这个任务已经结束，没法转接。",
  noReply: "（没有回复）",
  starting: "启动中",
  couldNotStart: (m) => `启动失败：${m}`,
  relayed: (l) => `转接中：${l}`,
  reported: (l) => `已报告：${l}`,
  watchdog: (d) => `看门狗：${d}`,
  couldNotStartBody: (m) => `Agent 启动失败：${m}`,
  failedBody: (m) => `任务失败：${m}`,
  result: { done: "已完成", failed: "失败", blocked: "受阻", stopped: "已停止" },
  titleSep: "：",
  repeatedToolCall: (n, label) => `同一个工具调用重复了 ${n} 次：${label}`,
  quiet: (m) => `Agent 已经 ${m} 分钟没有动静`,
  exited: (code) => `Agent 进程退出了（代码 ${code}）`,
  byRule: (allowed, id, what) =>
    `${allowed ? "已按规则批准" : "已按规则拒绝"}${id === undefined ? "" : ` ${id}`}：${what}`,
  allow: "批准",
  deny: "拒绝",
  reason: (t) => `理由：${t}`,
  allowedByYou: "你已批准",
  deniedByYou: "你已拒绝",
  expired: (why) => `已失效：${why}`,
  stillWaiting: (t) => `还在等你处理：${t}`,
  turnEnded: "Agent 这一轮已结束",
  agentStoppedWaiting: "Agent 不再等待",
  agentherdStopped: "AgentHerd 已停止",
  runFinished: "任务已运行结束",
  agentCouldNotStart: "Agent 启动失败",
  agentExited: "Agent 已退出",
  turnFailed: "这一轮执行失败",
  replyHint: (n) =>
    `[AgentHerd] 你的回复会在手机上阅读。每条回复不超过 ${n} 字，先写结论；细节写进文件或提交说明，不要贴长代码或日志。下面是任务原文。`,
  summaryPrompt: (n) =>
    [
      `[AgentHerd] 请用不超过 ${n} 字，向负责人总结你在这个任务里做了什么：`,
      "改了什么、验证了什么、产出（文件、提交、PR）、风险或没做完的部分。",
      "不要调用工具。",
    ].join("\n"),
};

const en: CoreTexts = {
  help: HELP_EN,
  noHerder: `No Herder model is configured yet. Commands:\n${HELP_EN}`,
  usage: (u) => `Usage: ${u}`,
  noMatch: (q) => `No open task matches "${q}".`,
  manyMatches: (q, list) => `More than one task matches "${q}":\n${list}`,
  noRelay: "No relay is active.",
  queued: "Queued: the agent gets this when its turn ends.",
  unknownAgent: (a, known) => `Unknown agent "${a}". Known: ${known}.`,
  notDirectory: (p) => `Not a directory: ${p}`,
  taskEnded: "That task has ended; there is nothing to relay to.",
  noReply: "(no reply)",
  starting: "Starting",
  couldNotStart: (m) => `Could not start: ${m}`,
  relayed: (l) => `Relayed: ${l}`,
  reported: (l) => `Reported: ${l}`,
  watchdog: (d) => `Watchdog: ${d}`,
  couldNotStartBody: (m) => `Could not start the agent: ${m}`,
  failedBody: (m) => `The task failed: ${m}`,
  result: { done: "Done", failed: "Failed", blocked: "Blocked", stopped: "Stopped" },
  titleSep: ": ",
  repeatedToolCall: (n, label) => `the same tool call ran ${n} times: ${label}`,
  quiet: (m) => `no event from the agent for ${m} minutes`,
  exited: (code) => `the agent exited (code ${code})`,
  byRule: (allowed, id, what) =>
    `${allowed ? "Allowed" : "Denied"} by rule${id === undefined ? "" : ` ${id}`}: ${what}`,
  allow: "Allow",
  deny: "Deny",
  reason: (t) => `Reason: ${t}`,
  allowedByYou: "Allowed by you",
  deniedByYou: "Denied by you",
  expired: (why) => `Expired: ${why}`,
  stillWaiting: (t) => `Still waiting for you: ${t}`,
  turnEnded: "the agent's turn ended",
  agentStoppedWaiting: "the agent stopped waiting",
  agentherdStopped: "AgentHerd stopped",
  runFinished: "the run finished",
  agentCouldNotStart: "the agent could not start",
  agentExited: "the agent exited",
  turnFailed: "the turn failed",
  replyHint: (n) =>
    [
      "[AgentHerd] Your replies are read on a phone. Keep each reply under",
      `${n} characters, conclusion first. Put details in files or commit messages;`,
      "do not paste long code or logs. The owner's task follows.",
    ].join(" "),
  summaryPrompt: (n) =>
    [
      `[AgentHerd] Summarize for the owner what you did in this task, in at most ${n} characters:`,
      "what changed, what you verified, outputs (files, commits, PR), risks or open parts.",
      "Do not call tools.",
    ].join("\n"),
};

export const CORE_TEXTS: Record<Locale, CoreTexts> = { "zh-CN": zh, en };

export function coreTexts(locale: Locale): CoreTexts {
  return CORE_TEXTS[locale];
}
