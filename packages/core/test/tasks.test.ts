import { describe, expect, it } from "vitest";
import {
  projectName,
  type StageInput,
  sortForBoard,
  stageOf,
  type Task,
  TITLE_MAX_CHARS,
  taskTitle,
} from "../src/tasks.ts";

describe("taskTitle", () => {
  it("returns the first non-empty trimmed line", () => {
    expect(taskTitle("\n\n  Build the thing  \nsecond line")).toBe("Build the thing");
  });

  it("cuts a long line to 60 chars with an ellipsis", () => {
    const long = "x".repeat(70);
    const title = taskTitle(long);
    expect(title).toHaveLength(TITLE_MAX_CHARS);
    expect(title).toBe(`${"x".repeat(TITLE_MAX_CHARS - 1)}…`);
  });

  it("keeps an exactly-60-char line unchanged", () => {
    const exact = "y".repeat(TITLE_MAX_CHARS);
    expect(taskTitle(exact)).toBe(exact);
  });

  it("returns the placeholder for a blank prompt", () => {
    expect(taskTitle("")).toBe("(empty task)");
    expect(taskTitle("  \n\t \n")).toBe("(empty task)");
  });
});

describe("projectName", () => {
  it("returns the basename of the working directory", () => {
    expect(projectName("/work/proj")).toBe("proj");
    expect(projectName("/work/proj/")).toBe("proj");
  });

  it("falls back to the whole path when there is no basename", () => {
    expect(projectName("/")).toBe("/");
  });
});

describe("stageOf", () => {
  function input(over: Partial<StageInput> = {}): StageInput {
    return {
      session: "working",
      openItems: 0,
      alarm: false,
      report: undefined,
      finished: false,
      ...over,
    };
  }

  it("open items beat a ready report", () => {
    expect(stageOf(input({ openItems: 1, report: "ready" }))).toBe("needs-owner");
  });

  it("ready and dropped reports are done", () => {
    expect(stageOf(input({ report: "ready" }))).toBe("done");
    expect(stageOf(input({ report: "dropped" }))).toBe("done");
  });

  it("failed report is failed", () => {
    expect(stageOf(input({ report: "failed" }))).toBe("failed");
  });

  it("blocked report is stuck", () => {
    expect(stageOf(input({ report: "blocked" }))).toBe("stuck");
  });

  it("waiting report needs the owner", () => {
    expect(stageOf(input({ report: "waiting" }))).toBe("needs-owner");
  });

  it("progress report falls through to the session state", () => {
    expect(stageOf(input({ report: "progress" }))).toBe("working");
  });

  it("session error is failed", () => {
    expect(stageOf(input({ session: "error" }))).toBe("failed");
  });

  it("an alarm is stuck", () => {
    expect(stageOf(input({ alarm: true }))).toBe("stuck");
  });

  it("a looping session is stuck", () => {
    expect(stageOf(input({ session: "looping" }))).toBe("stuck");
  });

  it("a finished turn is done", () => {
    expect(stageOf(input({ finished: true }))).toBe("done");
  });

  it("idle and ended without finishing are failed", () => {
    expect(stageOf(input({ session: "idle" }))).toBe("failed");
    expect(stageOf(input({ session: "ended" }))).toBe("failed");
  });

  it("starting is queued", () => {
    expect(stageOf(input({ session: "starting" }))).toBe("queued");
  });

  it("working is working", () => {
    expect(stageOf(input({ session: "working" }))).toBe("working");
  });
});

describe("sortForBoard", () => {
  function task(over: Partial<Task> = {}): Task {
    return {
      id: "t1",
      title: "T1",
      project: "p",
      agent: "a",
      stage: "working",
      lastReport: "",
      startedAt: "2026-11-04T00:00:00.000Z",
      updatedAt: "2026-11-04T00:00:00.000Z",
      automaticDecisions: [],
      ...over,
    };
  }

  it("orders by stage then newest update first, without mutating input", () => {
    const tasks: Task[] = [
      task({ id: "done-old", stage: "done", updatedAt: "2026-11-04T00:01:00.000Z" }),
      task({ id: "working-new", stage: "working", updatedAt: "2026-11-04T00:03:00.000Z" }),
      task({ id: "needs", stage: "needs-owner", updatedAt: "2026-11-04T00:01:00.000Z" }),
      task({ id: "stuck-old", stage: "stuck", updatedAt: "2026-11-04T00:01:00.000Z" }),
      task({ id: "working-old", stage: "working", updatedAt: "2026-11-04T00:02:00.000Z" }),
      task({ id: "failed", stage: "failed", updatedAt: "2026-11-04T00:01:00.000Z" }),
      task({ id: "queued", stage: "queued", updatedAt: "2026-11-04T00:01:00.000Z" }),
      task({ id: "stuck-new", stage: "stuck", updatedAt: "2026-11-04T00:02:00.000Z" }),
    ];
    const original = JSON.parse(JSON.stringify(tasks)) as Task[];

    expect(sortForBoard(tasks).map((t) => t.id)).toEqual([
      "needs",
      "stuck-new",
      "stuck-old",
      "working-new",
      "working-old",
      "queued",
      "failed",
      "done-old",
    ]);
    expect(tasks).toEqual(original);
  });
});
