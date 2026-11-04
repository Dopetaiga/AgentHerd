// Owner-facing strings for the Feishu channel, one table per locale. Commands and stage ids
// stay in English; everything else the owner reads defaults to Chinese (docs/spec/05-channels.md).

import type { Locale, Risk, Stage } from "@agentherd/protocol";

/** Board table column keys; `name` keys never change, only `display_name` is localized. */
export type BoardColumnName = "task" | "stage" | "project" | "agent" | "report" | "updated";

export interface CardTexts {
  risk: Record<Risk, string>;
  reasonPrefix: string;
  showAll: string;
  fullReply: string;
  automaticDecisions: string;
  boardHeader: string;
  noTasks: string;
  columns: Record<BoardColumnName, string>;
  stages: Record<Stage, string>;
  relayToTask: string;
  relayActive: (label: string) => string;
  endRelay: string;
  backToHerder: string;
  askAnswered: (answer: string) => string;
  toast: string;
  appName: string;
  appDesc: string;
}

export const CARD_TEXTS: Record<Locale, CardTexts> = {
  "zh-CN": {
    risk: { low: "低风险", medium: "中风险", high: "高风险" },
    reasonPrefix: "理由：",
    showAll: "展开全部",
    fullReply: "完整回复",
    automaticDecisions: "自动处理的审批",
    boardHeader: "任务看板",
    noTasks: "还没有任务。",
    columns: {
      task: "任务",
      stage: "阶段",
      project: "项目",
      agent: "Agent",
      report: "最新进展",
      updated: "更新时间",
    },
    stages: {
      queued: "排队中",
      working: "进行中",
      "needs-owner": "等你处理",
      stuck: "卡住了",
      done: "已完成",
      failed: "失败",
    },
    relayToTask: "转接到这个任务",
    relayActive: (label) =>
      `正在和 **${label}** 对话。直接发的消息都会转给这个任务，发 /end 结束。`,
    endRelay: "结束转接",
    backToHerder: "已回到主管",
    askAnswered: (answer) => `你选了：**${answer}**`,
    toast: "已收到",
    appName: "AgentHerd",
    appDesc: "只在你的 Agent 需要你时才打扰你",
  },
  en: {
    risk: { low: "Low risk", medium: "Medium risk", high: "High risk" },
    reasonPrefix: "Reason: ",
    showAll: "Show all",
    fullReply: "Full reply",
    automaticDecisions: "Automatic decisions",
    boardHeader: "Tasks",
    noTasks: "No tasks yet.",
    columns: {
      task: "Task",
      stage: "Stage",
      project: "Project",
      agent: "Agent",
      report: "Last report",
      updated: "Updated",
    },
    stages: {
      queued: "queued",
      working: "working",
      "needs-owner": "needs-owner",
      stuck: "stuck",
      done: "done",
      failed: "failed",
    },
    relayToTask: "Relay to this task",
    relayActive: (label) =>
      `Now talking to **${label}**. Plain messages go to this task. /end to stop.`,
    endRelay: "End relay",
    backToHerder: "Back to the Herder",
    askAnswered: (answer) => `You chose: **${answer}**`,
    toast: "Received",
    appName: "AgentHerd",
    appDesc: "Only pings you when your agents need you",
  },
};
