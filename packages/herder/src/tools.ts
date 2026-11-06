// The Herder's tools (docs/spec/04-herder.md §1). None of them answers an item, runs a command
// or writes a file.

import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { HerderHost, OwnerImage, Task } from "@agentherd/core";
import type { AgentTool, AgentToolResult } from "@agentherd/herder-loop";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import { agentForModel } from "./agent-models.ts";
import { TIERS, type TierPlacement, tiersText } from "./model-guide.ts";
import { findProjects, foundText } from "./project-find.ts";
import { composeTaskPrompt, HERDER_LABEL } from "./prompt.ts";

/** What the current Herder turn is about. */
export interface TurnContext {
  kind: "owner" | "answer" | "event";
  /** The owner's words this turn may pass on: the message, or the one the answer belongs to. */
  ownerText: string;
  /**
   * What the owner typed: the message, or for an answer the message it belongs to (a tapped
   * button is not their words). Memory evidence must come from it (ADR 0038).
   */
  typedText: string;
  /** The owner's images this turn; tasks started or messaged for the owner get them. */
  images: OwnerImage[];
  asked: boolean;
  notified: boolean;
  /**
   * Folders the owner typed or picked with a button this turn. session_start runs only in one of
   * them (ADR 0035): a folder from earlier turns or the Herder's own guess is never used.
   */
  pickedDirs: string[];
}

/** The answer that lets the owner type their own (ADR 0035). */
export function otherOption(locale: string): string {
  return locale === "en" ? "Other" : "其他";
}

const PATH_RE = /(?:^|[\s"'`(（「:：])((?:~|\/)[^\s"'`)）」，。；;,!?！？]*)/g;

/** Absolute and `~/` paths in the owner's words, resolved. */
export function pathsIn(text: string, home: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const raw = (m[1] ?? "").replace(/[.:：]+$/, "");
    if (raw === "" || raw === "/") continue;
    const dir =
      raw === "~" || raw.startsWith("~/") ? resolve(join(home, raw.slice(1))) : resolve(raw);
    if (!out.includes(dir)) out.push(dir);
  }
  return out;
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

/** A directory from an absolute path or `~/path`. Names go through project_find and the owner. */
export function resolveProject(host: HerderHost, project: string): string {
  const p = project.trim();
  if (p === "~" || p.startsWith("~/")) return resolve(join(host.userHome, p.slice(1)));
  if (isAbsolute(p)) return resolve(p);
  throw new Error(
    `"${p}" is not a path; call project_find with the name and ask the owner to pick the folder`,
  );
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
    description:
      "Project folder: an absolute or ~/ path the owner typed or picked this turn (find it with project_find and ask)",
  }),
  profile: opt(
    str({
      description:
        "Only when the owner names an agent (e.g. dsh). Omit otherwise: AgentHerd picks the agent from the model.",
    }),
  ),
  name: str({
    description:
      'A short name for the task, 4 to 12 words or about 6 to 15 Chinese characters, in the owner\'s language: what the agent does, e.g. "pi-desktop：梳理可做的 issue". Shown on every report.',
  }),
  ownerText: str({ description: "The owner's request, copied exactly from their message" }),
  addedContext: opt(str({ description: "Anything you add, sent below the owner's words" })),
  model: opt(
    str({
      description:
        "Model name from session_list (e.g. deepseek-v4-pro); AgentHerd uses the first service offering it that answers. service/model picks one service. Omit to use the agent's own settings.",
    }),
  ),
});
const taskSchema = obj({ task: str({ description: "Task id prefix or words of its title" }) });
const promptSchema = obj({
  task: str({ description: "Task id prefix or words of its title" }),
  text: str({
    description: "Text for the agent; the owner's words copied exactly if they are theirs",
  }),
  name: opt(
    str({ description: "A new short name for the task, only when this changes what it works on" }),
  ),
});
const askSchema = obj({
  question: str(),
  options: arr(str(), { minItems: 1, maxItems: 4 }),
});
const notifySchema = obj({ text: str() });
const findSchema = obj({
  name: str({ description: "The project's name as the owner said it, e.g. pi-desktop" }),
});
const emptySchema = obj({});

export function herderTools(
  host: HerderHost,
  turn: () => TurnContext,
  modelTiers?: () => TierPlacement,
): AgentTool[] {
  const tools = [
    {
      name: "session_list",
      label: "List tasks",
      description: "Tasks (open and ended), agent profiles, models and the active relay.",
      parameters: emptySchema,
      execute: async () => {
        const tasks = host.tasks();
        const open = new Set(host.openTasks().map((t) => t.id));
        const lines = [
          "Tasks:",
          ...(tasks.length === 0
            ? ["(none)"]
            : tasks.map((t) => `${taskLine(t)}${open.has(t.id) ? "" : " (ended)"}`)),
          `Agents: AgentHerd picks one from the model (GPT models run in Codex, the rest in Pi). Installed: ${host
            .profiles()
            .map((p) => `${p.id} (${p.name})`)
            .join(", ")}`,
          "Models (name: services offering it, in order of preference):",
          ...modelLines(host, modelTiers),
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
          name: string;
          profile?: string;
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
        const named = args.profile?.trim() || undefined;
        const ids = host.profiles().map((p) => p.id);
        if (named !== undefined && !ids.includes(named)) {
          throw new Error(`unknown profile "${named}"`);
        }
        const asked = args.model?.trim() || undefined;
        const picked =
          asked === undefined ? undefined : await pickService(host, asked, named, modelTiers?.());
        const model = picked?.ref;
        const profile = named ?? agentForModel(model, ids);
        const cwd = resolveProject(host, args.project);
        if (!t.pickedDirs.includes(cwd)) {
          throw new Error(
            `the owner did not pick ${cwd} in this message; call project_find and ask the owner to pick the folder`,
          );
        }
        if (!isDirectory(cwd)) throw new Error(`${cwd} is not a directory`);
        const prompt = composeTaskPrompt(args.ownerText.trim(), args.addedContext);
        const title = args.name.trim() || args.ownerText.trim();
        const taskId =
          t.images.length === 0
            ? await host.startTask(profile, cwd, title, prompt, model)
            : await host.startTask(profile, cwd, title, prompt, model, t.images);
        const using = model === undefined ? "its own model settings" : model;
        const switched =
          picked?.switched === undefined
            ? ""
            : `\nModel switched: ${picked.switched}. Tell the owner in one line.`;
        return ok(
          `started task ${taskId.slice(0, 8)} in ${cwd} with ${profile}, ${using}${switched}`,
        );
      },
    },
    {
      name: "session_prompt",
      label: "Message a task",
      description:
        "Sends text to a running task. The owner's words go unchanged; other text is labeled as yours.",
      parameters: promptSchema,
      execute: async (_id: string, args: { task: string; text: string; name?: string }) => {
        const t = turn();
        if (t.kind === "event") throw new Error("only the owner can message tasks; use notify");
        const task = oneTask(host, args.task);
        const verbatim = isVerbatim(args.text, t.ownerText);
        const name = args.name?.trim();
        if (name !== undefined && name !== "") host.renameTask(task.id, name);
        const text = verbatim
          ? `${"[Owner's message]"}\n${args.text.trim()}`
          : `${HERDER_LABEL}\n${args.text.trim()}`;
        if (t.images.length === 0) host.promptTask(task.id, text);
        else host.promptTask(task.id, text, t.images);
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
      name: "project_find",
      label: "Find a project",
      description:
        "Finds project folders (git repositories under the owner's home) by name. Then ask the owner to pick one; never pick yourself.",
      parameters: findSchema,
      execute: async (_id: string, args: { name: string }) => {
        return ok(foundText(args.name, findProjects(host.userHome, args.name)));
      },
    },
    {
      name: "ask",
      label: "Ask the owner",
      description:
        "Asks the owner one question with suggested answers as buttons; AgentHerd adds an 「其他」 button for typing their own. End your turn after it.",
      parameters: askSchema,
      execute: async (_id: string, args: { question: string; options: string[] }) => {
        const other = otherOption(host.locale);
        const options = args.options.map((o) => o.trim()).filter((o) => o !== "" && o !== other);
        const all = [...options.slice(0, 4), other];
        host.recordTurn("ask", `${args.question}\n${all.map((o) => `- ${o}`).join("\n")}`);
        await host.ask(args.question, all);
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

/** The owner's models grouped by name: services in list order, agents that can run any of them. */
export function modelsByName(
  models: { ref: string; agents: string[] }[],
): { name: string; refs: string[]; services: string[]; agents: string[] }[] {
  const out = new Map<
    string,
    { name: string; refs: string[]; services: string[]; agents: string[] }
  >();
  for (const m of models) {
    const slash = m.ref.indexOf("/");
    const service = m.ref.slice(0, slash);
    const name = m.ref.slice(slash + 1);
    const entry = out.get(name) ?? { name, refs: [], services: [], agents: [] };
    entry.refs.push(m.ref);
    entry.services.push(service);
    for (const a of m.agents) if (!entry.agents.includes(a)) entry.agents.push(a);
    out.set(name, entry);
  }
  return [...out.values()];
}

/** A model to run and, when it is not the one asked for, why it was swapped. */
export interface PickedModel {
  ref: string;
  /** Set when AgentHerd moved away from what was asked; the Herder tells the owner. */
  switched?: string;
}

/**
 * The `service/model` to run. Tries, in order, each answering a test call first: what was asked
 * (one service, or every service offering the name), other services offering the same name, the
 * other models of its tier, then the other tiers. Only models the agent can run count.
 */
/**
 * Refs to try for `asked`, in order: `asked` itself (one service, or every service offering the
 * name), other services offering the same name, the other models of its tier, then the other
 * tiers. Only models `profile` can run; with no profile, any model an agent can run (AgentHerd then
 * picks the agent from the model, ADR 0031). Throws when the name is unknown or nothing can run it.
 */
export function fallbackOrder(
  models: readonly { ref: string; agents: string[] }[],
  asked: string,
  profile: string | undefined,
  tiers?: TierPlacement,
): string[] {
  const nameOf = (ref: string) => ref.slice(ref.indexOf("/") + 1);
  const exact = models.find((m) => m.ref === asked);
  const name = exact !== undefined ? nameOf(exact.ref) : asked;
  const same = models.filter((m) => nameOf(m.ref) === name);
  if (same.length === 0) throw new Error(`unknown model "${asked}"; see session_list`);
  const runs = (m: { agents: string[] } | undefined) =>
    m !== undefined && (profile === undefined ? m.agents.length > 0 : m.agents.includes(profile));
  if (!same.some(runs)) {
    const can = [...new Set(same.flatMap((m) => m.agents))].join(", ") || "no agent";
    throw new Error(
      `${profile === undefined ? "no agent" : `agent "${profile}"`} cannot run ${asked} (can: ${can})`,
    );
  }
  const order: string[] = [];
  const add = (ref: string) => {
    if (!order.includes(ref)) order.push(ref);
  };
  if (exact !== undefined) add(exact.ref);
  for (const m of same) add(m.ref);
  const byName = (n: string) => models.filter((m) => nameOf(m.ref) === n).map((m) => m.ref);
  if (tiers !== undefined) {
    const home = TIERS.find((t) => tiers[t].some((e) => e.model === name));
    const rest = TIERS.filter((t) => t !== home);
    for (const tier of home === undefined ? rest : [home, ...rest]) {
      for (const e of tiers[tier]) for (const ref of byName(e.model)) add(ref);
    }
  }
  return order.filter((ref) => runs(models.find((m) => m.ref === ref)));
}

async function pickService(
  host: HerderHost,
  asked: string,
  profile: string | undefined,
  tiers?: TierPlacement,
): Promise<PickedModel> {
  const runnable = fallbackOrder(host.models(), asked, profile, tiers);
  const failures: string[] = [];
  for (const ref of runnable) {
    const check = await host.checkModel(ref);
    if (check.ok) {
      if (failures.length === 0) return { ref };
      return { ref, switched: `${failures.join("; ")}; switched to ${ref}` };
    }
    failures.push(`${ref} failed (${check.message})`);
  }
  throw new Error(`no model answers: ${failures.join("; ")}`);
}

function modelLines(host: HerderHost, modelTiers?: () => TierPlacement): string[] {
  const models = modelsByName(host.models());
  if (models.length === 0) return ["(none; agents use their own settings)"];
  const lines = models.map(
    (m) =>
      `- ${m.name}: ${m.services.join(", ")}${m.agents.length === 0 ? " (no agent can run it)" : ""}`,
  );
  const placement = modelTiers?.();
  const guide = placement === undefined ? "" : tiersText(placement);
  if (guide) lines.push(guide);
  return lines;
}
