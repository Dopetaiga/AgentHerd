import { FakeChannel } from "@agentherd/channel-fake";
import type { MessageRef, View } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { BOARD_MAX_ROWS, Board, boardView } from "../src/board.ts";
import { FakeClock } from "../src/clock.ts";
import { Store } from "../src/store.ts";
import type { Task } from "../src/tasks.ts";

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

function makeBoard(over: { debounceMs?: number } = {}) {
  const clock = new FakeClock();
  const channel = new FakeChannel("owner");
  const store = Store.open(":memory:");
  const tasks: Task[] = [];
  const instance = new Board({
    channel,
    store,
    clock,
    tasks: () => tasks,
    ...(over.debounceMs === undefined ? {} : { debounceMs: over.debounceMs }),
  });
  return { board: instance, channel, clock, store, tasks };
}

class ThrowingChannel extends FakeChannel {
  override async send(_view: View): Promise<MessageRef> {
    throw new Error("send boom");
  }
}

describe("boardView", () => {
  it("sorts and caps at BOARD_MAX_ROWS", () => {
    const tasks: Task[] = Array.from({ length: 25 }, (_, i) =>
      task({ id: `t${i}`, updatedAt: `2026-11-04T00:00:${String(i).padStart(2, "0")}.000Z` }),
    );
    const view = boardView(tasks);
    expect(view.kind).toBe("board");
    expect(view.rows).toHaveLength(BOARD_MAX_ROWS);
    expect(view.rows[0]?.taskId).toBe("t24");
    expect(view.rows.at(-1)?.taskId).toBe("t5");
  });
});

describe("Board", () => {
  it("coalesces two changed() calls into one pinned message", async () => {
    const { board, channel, clock } = makeBoard();
    board.changed();
    board.changed();
    await clock.advance(1000);

    const messages = channel.ofKind("board");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.pinned).toBe(true);
  });

  it("updates the same message in place on a later change", async () => {
    const { board, channel, clock, tasks } = makeBoard();
    board.changed();
    await clock.advance(1000);

    tasks.push(task({ id: "t2", stage: "done" }));
    board.changed();
    await clock.advance(1000);

    expect(channel.messages).toHaveLength(1);
    const message = channel.ofKind("board")[0];
    expect(message).toBeDefined();
    expect(message?.history).toHaveLength(2);
  });

  it("flush(true) sends a new pinned message", async () => {
    const { board, channel, clock } = makeBoard();
    board.changed();
    await clock.advance(1000);
    expect(channel.messages).toHaveLength(1);

    await board.flush(true);
    expect(channel.messages).toHaveLength(2);
    expect(channel.ofKind("board")[1]?.pinned).toBe(true);
  });

  it("records board.error and does not throw when the channel send fails", async () => {
    const clock = new FakeClock();
    const store = Store.open(":memory:");
    const instance = new Board({
      channel: new ThrowingChannel("owner"),
      store,
      clock,
      tasks: () => [task()],
    });

    await expect(instance.flush(true)).resolves.toBeUndefined();
    const rows = store.auditRows("board.error");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ message: "send boom" });
  });
});
