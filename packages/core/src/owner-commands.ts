// Inbound from the owner: commands, relay messages, Herder questions and their answers.

import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AskView, Inbound, InboundFile, InboundImage, MessageRef } from "@agentherd/protocol";
import { parseCommand } from "./commands.ts";
import { type HerdContext, openTasks, say, type TaskOps } from "./herd-context.ts";
import type { OwnerImage } from "./herder-port.ts";
import { HERDER_RETRY_TARGET } from "./herder-port.ts";
import { forgetMemory, memoryListText, restoreMemory } from "./memory-commands.ts";
import type { Relay } from "./relay.ts";
import type { Task } from "./tasks.ts";
import { taskTitle } from "./tasks.ts";

export class OwnerCommands {
  /** Open questions from the Herder, by ask id. */
  private readonly asks = new Map<string, { ref: MessageRef; view: AskView }>();

  private readonly ctx: HerdContext;
  private readonly relay: Relay;
  private readonly tasks: TaskOps;

  constructor(ctx: HerdContext, relay: Relay, tasks: TaskOps) {
    this.ctx = ctx;
    this.relay = relay;
    this.tasks = tasks;
  }

  /** Inbound from the channel. Errors are recorded, never thrown back into the channel. */
  async handle(inbound: Inbound): Promise<void> {
    const { ctx } = this;
    try {
      if (inbound.from !== ctx.opts.binding.ownerId) {
        // The inbox drops and audits everything that does not come from the owner.
        await ctx.inbox.handle(inbound);
        return;
      }
      if (inbound.kind === "action") {
        if (this.asks.has(inbound.target))
          return await this.onAskAnswer(inbound.target, inbound.action);
        if (inbound.target === HERDER_RETRY_TARGET) return ctx.herder()?.retry?.();
        if (inbound.action === "relay") return await this.relay.start(inbound.target);
        if (inbound.action === "end-relay") return await this.relay.end("ended by you");
        await ctx.inbox.handle(inbound);
        return;
      }
      const text = [inbound.text, ...this.saveFiles(inbound.files ?? [])]
        .filter((t) => t !== "")
        .join("\n");
      await this.onOwnerMessage(text, this.saveImages(inbound.images ?? []));
    } catch (error) {
      ctx.store.audit("inbound.error", { message: (error as Error).message });
    }
  }

  /** Sends a question with buttons; the answer goes to the Herder. */
  async ask(text: string, options: string[]): Promise<void> {
    const askId = `ask-${randomUUID()}`;
    const view: AskView = {
      kind: "ask",
      askId,
      text,
      options: options.map((label, i) => ({ action: String(i), label })),
    };
    const ref = await this.ctx.opts.channel.send(view);
    this.asks.set(askId, { ref, view });
  }

  /** Saves the owner's images under `<home>/attachments`, so agents can open them as files. */
  private saveImages(images: InboundImage[]): OwnerImage[] {
    if (images.length === 0) return [];
    const dir = join(this.ctx.opts.home, "attachments");
    mkdirSync(dir, { recursive: true });
    return images.map((image) => {
      const ext = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      const path = join(dir, `${new Date().toISOString().slice(0, 10)}-${randomUUID()}.${ext}`);
      writeFileSync(path, image.data);
      this.ctx.store.audit("owner.image", { path, bytes: image.data.byteLength });
      return { mimeType: image.mimeType, data: Buffer.from(image.data).toString("base64"), path };
    });
  }

  /**
   * Saves the owner's files under `<home>/attachments` with their own names; the text the
   * Herder or agent gets carries one line per file with where it is.
   */
  private saveFiles(files: InboundFile[]): string[] {
    if (files.length === 0) return [];
    const dir = join(this.ctx.opts.home, "attachments");
    mkdirSync(dir, { recursive: true });
    return files.map((file) => {
      const id = randomUUID().slice(0, 8);
      const path = join(
        dir,
        `${new Date().toISOString().slice(0, 10)}-${id}-${safeName(file.name)}`,
      );
      writeFileSync(path, file.data);
      this.ctx.store.audit("owner.file", { path, bytes: file.data.byteLength });
      return this.ctx.texts.fileAttached(file.name, path);
    });
  }

  private async onOwnerMessage(text: string, images: OwnerImage[] = []): Promise<void> {
    const { ctx } = this;
    const command = parseCommand(text);
    const relay = this.relay.current();
    if (relay !== undefined) this.relay.touch();
    switch (command.kind) {
      case "status":
        await ctx.board.flush(true);
        return;
      case "help":
        await say(ctx, ctx.texts.help);
        return;
      case "invalid":
        await say(ctx, ctx.texts.usage(command.usage));
        return;
      case "run":
        await this.runCommand(command.agent, command.dir, command.text, images);
        return;
      case "relay": {
        const matches = this.findTasks(command.query);
        if (matches.length === 1 && matches[0] !== undefined) {
          await this.relay.start(matches[0].id);
        } else if (matches.length === 0) {
          await say(ctx, ctx.texts.noMatch(command.query));
        } else {
          const list = matches.map((t) => `- ${t.id.slice(0, 8)} ${t.title}`).join("\n");
          await say(ctx, ctx.texts.manyMatches(command.query, list));
        }
        return;
      }
      case "end":
        if (relay === undefined) await say(ctx, ctx.texts.noRelay);
        else await this.relay.end("ended by you");
        return;
      case "interrupt":
        if (relay === undefined) {
          await say(ctx, ctx.texts.noRelay);
          return;
        }
        ctx.store.audit("relay.interrupt", { taskId: relay.taskId });
        void this.tasks.interruptTask(relay.taskId, command.text, images).catch(() => {});
        return;
      case "herder":
        await this.toHerder(command.text, images);
        return;
      case "memory":
        await say(ctx, memoryListText(ctx.store.memory, command.query, ctx.texts));
        return;
      case "forget":
        await say(ctx, forgetMemory(ctx.store.memory, command.target, ctx.texts));
        return;
      case "restore":
        await say(ctx, restoreMemory(ctx.store.memory, command.target, ctx.texts));
        return;
      case "text": {
        if (relay === undefined) {
          await this.toHerder(command.text, images);
          return;
        }
        const f = ctx.following.get(relay.taskId);
        ctx.store.audit("relay.message", { taskId: relay.taskId });
        if (f?.busy === true) await say(ctx, ctx.texts.queued);
        void this.tasks.promptTask(relay.taskId, command.text, images).catch(() => {});
        return;
      }
    }
  }

  private async toHerder(text: string, images: OwnerImage[] = []): Promise<void> {
    const herder = this.ctx.herder();
    if (herder === undefined) await say(this.ctx, this.ctx.texts.noHerder);
    else if (images.length === 0) herder.ownerMessage(text);
    else herder.ownerMessage(text, images);
  }

  private async onAskAnswer(askId: string, action: string): Promise<void> {
    const { ctx } = this;
    const ask = this.asks.get(askId);
    const option = ask?.view.options.find((o) => o.action === action);
    if (ask === undefined || option === undefined) return;
    this.asks.delete(askId);
    ctx.store.audit("herder.answer", { askId, answer: option.label });
    try {
      await ctx.opts.channel.update(ask.ref, { ...ask.view, final: option.label });
    } catch (error) {
      ctx.store.audit("send.error", { kind: "ask", message: (error as Error).message });
    }
    ctx.herder()?.ownerAnswer(ask.view.text, option.label);
  }

  private async runCommand(
    agent: string,
    dir: string,
    text: string,
    images: OwnerImage[],
  ): Promise<void> {
    const { ctx } = this;
    const { profiles, userHome } = ctx.opts;
    if (!profiles.some((p) => p.id === agent)) {
      const known = profiles.map((p) => p.id).join(", ");
      await say(ctx, ctx.texts.unknownAgent(agent, known));
      return;
    }
    const cwd = resolve(dir === "~" || dir.startsWith("~/") ? join(userHome, dir.slice(1)) : dir);
    if (!isDirectory(cwd)) {
      await say(ctx, ctx.texts.notDirectory(cwd));
      return;
    }
    await say(ctx, ctx.texts.runAccepted(taskTitle(text)));
    try {
      const { turn } = await this.tasks.startTask(agent, cwd, text, text, undefined, images);
      turn.catch(() => {});
    } catch {
      // startTask already sent a report.
    }
  }

  /** Open tasks whose id starts with the query, or whose title has every word of it. */
  private findTasks(query: string): Task[] {
    const q = query.trim().toLowerCase();
    const open = openTasks(this.ctx);
    const byId = open.filter((t) => t.id.startsWith(q));
    if (byId.length > 0) return byId;
    const words = q.split(/\s+/).filter((w) => w !== "");
    return open.filter((t) => words.every((w) => t.title.toLowerCase().includes(w)));
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A file name that is safe on every OS: no separators, no reserved characters, not too long. */
export function safeName(name: string): string {
  const base = [...name]
    .map((c) => (c.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(c) ? "_" : c))
    .join("")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (base === "") return "file";
  if (base.length <= 120) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 120 - ext.length) + ext;
}
