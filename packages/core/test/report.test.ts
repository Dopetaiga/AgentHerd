import { describe, expect, it, vi } from "vitest";
import type { ReportBody, SummaryAnswer } from "../src/report.ts";
import { formatDuration, replyHint, reportBody, reportView, summaryPrompt } from "../src/report.ts";
import type { Task } from "../src/tasks.ts";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "T",
    project: "P",
    agent: "A",
    stage: "done",
    lastReport: "",
    startedAt: "2026-11-04T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
    automaticDecisions: [],
    ...over,
  };
}

describe("reportBody", () => {
  it("returns a short reply verbatim without asking for a summary", async () => {
    const askSummary = vi.fn();
    const result = await reportBody("All done", askSummary);
    expect(result).toEqual({ body: "All done", summarized: false });
    expect(askSummary).not.toHaveBeenCalled();
  });

  it("uses the placeholder for an empty reply", async () => {
    const askSummary = vi.fn();
    expect(await reportBody("", askSummary)).toEqual({ body: "(no reply)", summarized: false });
    expect(await reportBody("   \n", askSummary)).toEqual({
      body: "(no reply)",
      summarized: false,
    });
    expect(askSummary).not.toHaveBeenCalled();
  });

  it("uses a good summary for a long reply, keeping the trimmed full reply", async () => {
    const reply = `  ${"x".repeat(700)}  `;
    const result = await reportBody(
      reply,
      async (): Promise<SummaryAnswer> => ({
        text: "a concise summary",
        toolCalls: 0,
      }),
    );
    expect(result).toEqual({
      body: "a concise summary",
      summarized: true,
      fullReply: reply.trim(),
    });
  });

  it("falls back to the reply when the summary called tools", async () => {
    const reply = "x".repeat(700);
    const result = await reportBody(
      reply,
      async (): Promise<SummaryAnswer> => ({
        text: "a summary",
        toolCalls: 1,
      }),
    );
    expect(result).toEqual({ body: reply, summarized: false });
  });

  it("falls back to the reply when the summary is empty", async () => {
    const reply = "x".repeat(700);
    const result = await reportBody(
      reply,
      async (): Promise<SummaryAnswer> => ({
        text: "   ",
        toolCalls: 0,
      }),
    );
    expect(result).toEqual({ body: reply, summarized: false });
  });

  it("falls back to the reply when the summary is too long", async () => {
    const reply = "x".repeat(700);
    const result = await reportBody(
      reply,
      async (): Promise<SummaryAnswer> => ({
        text: "y".repeat(700),
        toolCalls: 0,
      }),
    );
    expect(result).toEqual({ body: reply, summarized: false });
  });

  it("falls back to the reply when askSummary throws", async () => {
    const reply = "x".repeat(700);
    const result = await reportBody(reply, async () => {
      throw new Error("boom");
    });
    expect(result).toEqual({ body: reply, summarized: false });
  });
});

describe("summaryPrompt", () => {
  it("names AgentHerd, the limit, and forbids tools", () => {
    const prompt = summaryPrompt(250);
    expect(prompt).toContain("[AgentHerd]");
    expect(prompt).toContain("250");
    expect(prompt).toContain("Do not call tools.");
  });
});

describe("replyHint", () => {
  it("names the character limit", () => {
    const hint = replyHint(300);
    expect(hint).toContain("[AgentHerd]");
    expect(hint).toContain("300");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatDuration(40_000)).toBe("40s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(65 * 60_000)).toBe("1h 5m");
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("reportView", () => {
  const now = new Date("2026-11-04T00:00:40.000Z");
  const body: ReportBody = { body: "b", summarized: false };

  it("builds a Done title with project, agent, and duration", () => {
    const view = reportView(task(), body, now);
    expect(view.title).toBe("T");
    expect(view.subtitle).toBe("Done · P · A · 40s");
  });

  it("builds a Failed title for a failed stage", () => {
    const view = reportView(task({ stage: "failed" }), body, now);
    expect(view.subtitle).toBe("Failed · P · A · 40s");
  });

  it("copies the automatic decisions", () => {
    const t = task({ automaticDecisions: ["Allowed by rule r1: npm test"] });
    const view = reportView(t, body, now);
    expect(view.automaticDecisions).toEqual(["Allowed by rule r1: npm test"]);
    expect(view.automaticDecisions).not.toBe(t.automaticDecisions);
  });

  it("includes fullReply only when given", () => {
    expect("fullReply" in reportView(task(), body, now)).toBe(false);
    const withFull = reportView(task(), { body: "b", summarized: true, fullReply: "full" }, now);
    expect(withFull.fullReply).toBe("full");
  });
});
