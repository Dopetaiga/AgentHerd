// The Herder's tools (docs/spec/04-herder.md §1). None of them answers an item, runs a command
// or writes a file.

import { statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { HerderHost, Task } from "@agentherd/core";
import type { AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import { composeTaskPrompt, HERDER_LABEL } from "./prompt.ts";

/** What the current Herder turn is about. */
export interface TurnContext {
  kind: "owner" | "answer" | "event";
  /** The owner's words this turn may pass on: the message, or the one the answer belongs to. */
  ownerText: string;
  asked: boolean;
  notified: boolean;
}

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** True when `part` appears in `whole`, ignoring whitespace differences. */
export function isVerbatim(part: string, whole: string): boolean {
  const p = normalize(part);
  return p !== "" && normalize(whole).includes(p);
}

/** Open tasks whose id starts with the query, or whose title has every word of it. */
export function findTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  const byId = tasks.filter((t) => t.id.startsWith(q));
  if (byId.length > 0) return byId;
  const words = q.split(/\s+/).filter((w) => w !== "");
  return tasks.filter((t) => words.every((w) => t.title.toLowerCase().includes(w)));
}

/** A directory from a path, `~/path`, or the name of a recent project. */
export function resolveProject(host: HerderHost, project: string): string {
  const p = project.trim();
  if (p === "~" || p.startsWith("~/")) return resolve(join(host.userHome, p.slice(1)));
  if (isAbsolute(p)) return resolve(p);
  const recent = host.recentProjects().filter((dir) => basename(dir) === p);
  if (recent.length === 1 && recent[0] !== undefined) return recent[0];
  if (recent.length > 1)
    throw new Error(`several recent projects are named ${p}: ${recent.join(", ")}`);
  throw new Error(`unknown project "${p}"; use an absolute path or ask the owner`);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function oneTask(host: HerderHost, query: string): Task {
  const matches = findTasks(host.openTasks(), query);
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  if (matches.length === 0) throw new Error(`no open task matches "${query}"`);
  throw new Error(
    `several open tasks match "${query}": ${matches.map((t) => t.id.slice(0, 8)).join(", ")}`,
  );
}

function taskLine(t: Task): string {
  return `- ${t.id.slice(0, 8)} [${t.stage}] "${t.title}" project=${t.project} agent=${t.agent} last="${t.lastReport}" updated=${t.updatedAt}`;
}

const sessionStartSchema = obj({
  project: str({
    description: "Project directory: absolute path, ~/path, or a recent project name",
  }),
  profile: str({ description: "Agent profile id from session_list" }),
  ownerText: str({ description: "The owner's request, copied exactly from their message" }),
  addedContext: opt(str({ description: "Anything you add, sent below the owner's words" })),
  model: opt(
    str({
      description:
        "Model for this task as service/model from session_list, one the chosen agent can run. Omit to use the agent's own settings.",
    }),
  ),
});
const taskSchema = obj({ task: str({ description: "Task id prefix or words of its title" }) });
const promptSchema = obj({
  task: str({ description: "Task id prefix or words of its title" }),
  text: str({
    description: "Text for the agent; the owner's words copied exactly if they are theirs",
  }),
});
const askSchema = obj({
  question: str(),
  options: arr(str(), { minItems: 1, maxItems: 4 }),
});
const notifySchema = obj({ text: str() });
const emptySchema = obj({});

export function herderTools(
  host: HerderHost,
  turn: () => TurnContext,
  modelGuide?: () => string,
): AgentTool[] {
  const tools = [
    {
      name: "session_list",
      label: "List tasks",
      description: "Tasks (open and ended), agent profiles, recent projects and the active relay.",
      parameters: emptySchema,
      execute: async () => {
        const tasks = host.tasks();
        const open = new Set(host.openTasks().map((t) => t.id));
        const lines = [
          "Tasks:",
          ...(tasks.length === 0
            ? ["(none)"]
            : tasks.map((t) => `${taskLine(t)}${open.has(t.id) ? "" : " (ended)"}`)),
          `Agent profiles: ${host
            .profiles()
            .map((p) => `${p.id} (${p.name})`)
            .join(", ")}`,
          "Models (service/model: agents that can run it):",
          ...modelLines(host, modelGuide),
          `Recent projects: ${host.recentProjects().join(", ") || "(none)"}`,
          `Relay: ${host.relayTaskId()?.slice(0, 8) ?? "none"}`,
        ];
        return ok(lines.join("\n"));
      },
    },
    {
      name: "decisions_list",
      label: "Recent decisions",
      description: "Recent approval decisions (by rules or by the owner). Read only.",
      parameters: emptySchema,
      execute: async () => {
        const rows = host.decisions(20);
        if (rows.length === 0) return ok("(no decisions)");
        return ok(
          rows.map((d) => `- ${d.createdAt} ${d.source} ${d.action}: ${d.reason}`).join("\n"),
        );
      },
    },
    {
      name: "session_start",
      label: "Start a task",
      description: "Starts an agent session in a project with the owner's request.",
      parameters: sessionStartSchema,
      execute: async (
        _id: string,
        args: {
          project: string;
          profile: string;
          ownerText: string;
          addedContext?: string;
          model?: string;
        },
      ) => {
        const t = turn();
        if (t.kind === "event") throw new Error("tasks start only when the owner asks");
        if (!isVerbatim(args.ownerText, t.ownerText)) {
          throw new Error("ownerText must be the owner's words copied exactly from their message");
        }
        if (!host.profiles().some((p) => p.id === args.profile)) {
          throw new Error(`unknown profile "${args.profile}"`);
        }
        const model = args.model?.trim() || undefined;
        if (model !== undefined) {
          const choice = host.models().find((m) => m.ref === model);
          if (choice === undefined) throw new Error(`unknown model "${model}"; see session_list`);
          if (!choice.agents.includes(args.profile)) {
            const can = choice.agents.join(", ") || "no agent";
            throw new Error(`agent "${args.profile}" cannot run ${model} (can: ${can})`);
          }
        }
        const cwd = resolveProject(host, args.project);
        if (!isDirectory(cwd)) throw new Error(`${cwd} is not a directory`);
        const prompt = composeTaskPrompt(args.ownerText.trim(), args.addedContext);
        const title = args.ownerText.trim();
        const taskId = await host.startTask(args.profile, cwd, title, prompt, model);
        const using = model === undefined ? "its own model settings" : model;
        return ok(`started task ${taskId.slice(0, 8)} in ${cwd} with ${args.profile}, ${using}`);
      },
    },
    {
      name: "session_prompt",
      label: "Message a task",
      description:
        "Sends text to a running task. The owner's words go unchanged; other text is labeled as yours.",
      parameters: promptSchema,
      execute: async (_id: string, args: { task: string; text: string }) => {
        const t = turn();
        if (t.kind === "event") throw new Error("only the owner can message tasks; use notify");
        const task = oneTask(host, args.task);
        const verbatim = isVerbatim(args.text, t.ownerText);
        host.promptTask(
          task.id,
          verbatim
            ? `${"[Owner's message]"}\n${args.text.trim()}`
            : `${HERDER_LABEL}\n${args.text.trim()}`,
        );
        return ok(
          `sent to ${task.id.slice(0, 8)}${verbatim ? "" : " (labeled as from the Herder)"}`,
        );
      },
    },
    {
      name: "session_cancel",
      label: "Cancel a turn",
      description: "Cancels the running turn of a task. The task stays open.",
      parameters: taskSchema,
      execute: async (_id: string, args: { task: string }) => {
        if (turn().kind === "event") throw new Error("only the owner can cancel");
        const task = oneTask(host, args.task);
        await host.cancelTurn(task.id);
        return ok(`cancelled the turn of ${task.id.slice(0, 8)}`);
      },
    },
    {
      name: "relay_start",
      label: "Relay to a task",
      description: "Owner messages go straight to this task until /end.",
      parameters: taskSchema,
      execute: async (_id: string, args: { task: string }) => {
        if (turn().kind === "event") throw new Error("only the owner can start a relay");
        const task = oneTask(host, args.task);
        await host.startRelay(task.id);
        return ok(`relay to ${task.id.slice(0, 8)} started`);
      },
    },
    {
      name: "relay_end",
      label: "End the relay",
      description: "Ends the active relay.",
      parameters: emptySchema,
      execute: async () => {
        await host.endRelay();
        return ok("relay ended");
      },
    },
    {
      name: "ask",
      label: "Ask the owner",
      description:
        "Asks the owner one question with suggested answers as buttons. End your turn after it.",
      parameters: askSchema,
      execute: async (_id: string, args: { question: string; options: string[] }) => {
        await host.ask(args.question, args.options);
        turn().asked = true;
        return ok("asked; the answer comes as a new message");
      },
    },
    {
      name: "notify",
      label: "Tell the owner",
      description: "Sends a short message to the owner.",
      parameters: notifySchema,
      execute: async (_id: string, args: { text: string }) => {
        await host.say(args.text);
        turn().notified = true;
        return ok("sent");
      },
    },
  ];
  return tools.map((t) => t as unknown as AgentTool);
}

function modelLines(host: HerderHost, modelGuide?: () => string): string[] {
  const models = host.models();
  if (models.length === 0) return ["(none; agents use their own settings)"];
  const lines = models.map((m) => `- ${m.ref}: ${m.agents.join(", ") || "(no agent can run it)"}`);
  const guide = modelGuide?.().trim();
  if (guide) lines.push(guide);
  return lines;
}
