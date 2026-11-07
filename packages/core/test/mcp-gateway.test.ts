import { describe, expect, it } from "vitest";
import { type HerdReport, McpGateway, parseReport, UnknownTokenError } from "../src/mcp-gateway.ts";

function gateway() {
  const reports: [string, HerdReport][] = [];
  const g = new McpGateway((taskId, report) => reports.push([taskId, report]));
  return { g, reports, token: g.register("task-1") };
}

const call = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0" as const,
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe("McpGateway", () => {
  it("gives each registration a fresh 64-hex token", () => {
    const g = new McpGateway(() => {});
    const a = g.register("t");
    const b = g.register("t");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(g.taskOf(a)).toBeUndefined();
    expect(g.taskOf(b)).toBe("t");
  });

  it("refuses an unknown or revoked token", () => {
    const { g, token } = gateway();
    expect(() => g.handle("nope", call(1, "ping"))).toThrow(UnknownTokenError);
    g.revoke("task-1");
    expect(() => g.handle(token, call(1, "ping"))).toThrow(UnknownTokenError);
  });

  it("answers initialize with a version it speaks", () => {
    const { g, token } = gateway();
    const known = g.handle(token, call(1, "initialize", { protocolVersion: "2025-03-26" }));
    expect(known?.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "agentherd" },
    });
    const other = g.handle(token, call(2, "initialize", { protocolVersion: "2099-01-01" }));
    expect(other?.result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("answers ping, lists herd_report and ignores notifications", () => {
    const { g, token } = gateway();
    expect(g.handle(token, call(1, "ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    const list = g.handle(token, call(2, "tools/list"))?.result as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["herd_report"]);
    expect(
      g.handle(token, { jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeUndefined();
  });

  it("hands a valid herd_report to the core for the token's task", () => {
    const { g, token, reports } = gateway();
    const answer = g.handle(
      token,
      call(1, "tools/call", {
        name: "herd_report",
        arguments: { state: "blocked", summary: "need keys", risks: ["no tests"] },
      }),
    );
    expect(answer?.result).toEqual({ content: [{ type: "text", text: "reported" }] });
    expect(reports).toEqual([
      ["task-1", { state: "blocked", summary: "need keys", risks: ["no tests"] }],
    ]);
  });

  it("answers a bad report or unknown tool as a tool error", () => {
    const { g, token, reports } = gateway();
    const bad = g.handle(
      token,
      call(1, "tools/call", { name: "herd_report", arguments: { state: "great" } }),
    );
    expect(bad?.result).toMatchObject({ isError: true });
    const unknown = g.handle(token, call(2, "tools/call", { name: "rm_rf", arguments: {} }));
    expect(unknown?.result).toMatchObject({ isError: true });
    expect(reports).toEqual([]);
  });

  it("answers other methods with -32601", () => {
    const { g, token } = gateway();
    expect(g.handle(token, call(1, "resources/list"))?.error).toMatchObject({ code: -32601 });
  });
});

describe("parseReport", () => {
  it("cuts a long summary to 600 characters", () => {
    const r = parseReport({ state: "ready", summary: "x".repeat(700) });
    expect(typeof r === "string" ? r : r.summary.length).toBe(600);
  });

  it("rejects a missing summary and non-string lists", () => {
    expect(typeof parseReport({ state: "ready" })).toBe("string");
    expect(typeof parseReport({ state: "ready", summary: "s", tests: [1] })).toBe("string");
    expect(typeof parseReport("nope")).toBe("string");
  });
});
