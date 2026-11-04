import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentConnection,
  type ExitEvent,
  type PermissionRequest,
  type SessionUpdateEvent,
  startAgent,
} from "../src/index.ts";

const BIN = fileURLToPath(new URL("../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-acp-"));
let open: AgentConnection[] = [];

afterEach(async () => {
  await Promise.all(open.map((c) => c.close()));
  open = [];
});

function profile(script: string, env: Record<string, string> = {}): AgentProfile {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, script);
  return {
    id: "mock",
    name: "Mock",
    command: [process.execPath, BIN, "--script", file],
    env,
    exporter: null,
  };
}

async function start(script: string, env?: Record<string, string>) {
  const conn = await startAgent(profile(script, env), { cwd: dir });
  open.push(conn);
  const updates: SessionUpdateEvent[] = [];
  const permissions: PermissionRequest[] = [];
  conn.on("update", (u) => updates.push(u));
  conn.on("permission", (p) => permissions.push(p));
  const exit = new Promise<ExitEvent>((resolve) => conn.on("exit", resolve));
  const sessionId = await conn.newSession(dir);
  return { conn, updates, permissions, exit, sessionId };
}

function nextPermission(conn: AgentConnection): Promise<PermissionRequest> {
  return new Promise((resolve) => {
    const off = conn.on("permission", (p) => {
      off();
      resolve(p);
    });
  });
}

const PERMISSION = `
turns:
  - - message: "starting"
    - request_permission:
        toolCall: { id: t1, title: "Run tests", kind: execute, command: "pnpm test", paths: ["src/a.ts"] }
        on_reject: end_turn
    - message: "ran"
`;

describe("startAgent with the mock agent", () => {
  it("initializes and reads the agent name", async () => {
    const { conn } = await start("name: scripted\nturns: []\n");
    expect(conn.agentName).toBe("scripted");
  });

  it("allow → allow_once, the turn continues", async () => {
    const { conn, updates, sessionId } = await start(PERMISSION);
    const asked = nextPermission(conn);
    const turn = conn.prompt(sessionId, "go");
    const p = await asked;
    expect(p.toolCall).toMatchObject({
      kind: "execute",
      title: "Run tests",
      command: "pnpm test",
      paths: ["src/a.ts"],
    });
    expect(p.options.map((o) => o.kind)).toContain("allow_always");
    expect(p.respond({ kind: "allow" })).toBe(true);
    expect(await turn).toEqual({ stopReason: "end_turn" });
    expect(updates.filter((u) => u.type === "message").map((u) => u.text)).toEqual([
      "starting",
      "ran",
    ]);
    expect(conn.stderr().join("\n")).toContain('"optionId":"allow"');
    expect(conn.stderr().join("\n")).not.toContain('"optionId":"always"');
  });

  it("deny → reject_once, the turn ends", async () => {
    const { conn, updates, sessionId } = await start(PERMISSION);
    const asked = nextPermission(conn);
    const turn = conn.prompt(sessionId, "go");
    (await asked).respond({ kind: "deny" });
    expect(await turn).toEqual({ stopReason: "end_turn" });
    expect(updates.filter((u) => u.type === "message").map((u) => u.text)).toEqual(["starting"]);
    expect(conn.stderr().join("\n")).toContain('"outcome":"deny"');
  });

  it("only the first respond counts", async () => {
    const { conn, sessionId } = await start(PERMISSION);
    const asked = nextPermission(conn);
    const turn = conn.prompt(sessionId, "go");
    const p = await asked;
    expect(p.respond({ kind: "deny" })).toBe(true);
    expect(p.respond({ kind: "allow" })).toBe(false);
    expect(p.answered).toBe(true);
    await turn;
    expect(conn.stderr().join("\n")).toContain('"outcome":"deny"');
  });

  it("cancel answers open requests cancelled and ends the turn cancelled", async () => {
    const { conn, sessionId } = await start(PERMISSION);
    const asked = nextPermission(conn);
    const turn = conn.prompt(sessionId, "go");
    const p = await asked;
    await conn.cancel(sessionId);
    expect(p.answered).toBe(true);
    expect(await turn).toEqual({ stopReason: "cancelled" });
  });

  it("cancel during a sleep ends the turn cancelled", async () => {
    const { conn, sessionId } = await start("turns:\n  - - sleep: 10000\n");
    const turn = conn.prompt(sessionId, "go");
    await new Promise((r) => setTimeout(r, 100));
    await conn.cancel(sessionId);
    expect(await turn).toEqual({ stopReason: "cancelled" });
  });

  it("a crash emits exit and rejects the prompt", async () => {
    const { conn, exit, sessionId } = await start("turns:\n  - - crash: 7\n");
    await expect(conn.prompt(sessionId, "go")).rejects.toThrow(/exited \(code 7/);
    const e = await exit;
    expect(e.code).toBe(7);
    expect(e.stderr.join("\n")).toContain("crash with code 7");
  });

  it("a crash with a request open answers it cancelled", async () => {
    const script = `
turns:
  - - request_permission:
        toolCall: { id: t1, title: "x", kind: execute, command: "ls" }
`;
    const { conn, exit, sessionId } = await start(script);
    const asked = nextPermission(conn);
    const turn = conn.prompt(sessionId, "go").catch((e: Error) => e);
    const p = await asked;
    // Kill the agent from outside while the request is open.
    process.kill(conn.pid ?? 0, "SIGKILL");
    const e = await exit;
    expect(e.signal).toBe("SIGKILL");
    expect(p.answered).toBe(true);
    expect(await turn).toBeInstanceOf(Error);
  });

  it("redacts env secrets in stderr", async () => {
    const script = 'turns:\n  - - stderr: "token is hunter2-very-secret"\n    - crash: 1\n';
    const { conn, exit, sessionId } = await start(script, { MOCK_SECRET: "hunter2-very-secret" });
    conn.prompt(sessionId, "go").catch(() => {});
    const e = await exit;
    expect(e.stderr.join("\n")).toContain("token is");
    expect(e.stderr.join("\n")).not.toContain("hunter2-very-secret");
  });

  it("an invalid script fails start with the reason", async () => {
    await expect(startAgent(profile("turns: 3\n"), { cwd: dir })).rejects.toThrow(
      /turns: expected a list/,
    );
  });
});
