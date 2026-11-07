// herd_report end to end (docs/spec/09-agent-tools.md §5): a real agent process starts the
// agentherd relay from session/new, which reaches the gateway through the host's MCP socket.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeChannel } from "@agentherd/channel-fake";
import { Herd, Store } from "@agentherd/core";
import type { ReportView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type McpServer, mcpServerFor, mcpSocketPath, serveMcp } from "../src/mcp-socket.ts";

const BIN = fileURLToPath(new URL("../../mock-agent/bin/mock-agent.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "agentherd-mcp-e2e-"));
const open: { stop(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((o) => o.stop()));
});

describe("E2E-MCP-RELAY", () => {
  it("an agent's herd_report through the relay marks the task stuck", async () => {
    const script = join(dir, "report.yaml");
    writeFileSync(
      script,
      `turns:
  - - mcp_call:
        tool: herd_report
        arguments: { state: blocked, summary: "need the Gmail keys" }
    - end_turn: end_turn
`,
    );
    const channel = new FakeChannel("owner");
    let herd: Herd | undefined;
    const socket = mcpSocketPath(dir);
    const server: McpServer = await serveMcp(socket, (token, msg) => {
      if (herd === undefined) throw new Error("no herd");
      return herd.mcp(token, msg);
    });
    herd = new Herd({
      home: dir,
      userHome: dir,
      channel,
      binding: { channelId: "fake", ownerId: "owner", data: {} },
      mode: "assist",
      locale: "en",
      profiles: [
        {
          id: "mock",
          name: "Mock",
          command: [process.execPath, BIN, "--script", script],
          env: {},
          exporter: null,
        },
      ],
      store: Store.open(":memory:"),
      boardDebounceMs: 10,
      mcpServer: (token) => mcpServerFor(socket, token),
    });
    const h = herd;
    open.push({ stop: () => h.stop() }, { stop: () => server.close() });
    await h.start();
    await h.run("mock", dir, "Deploy the mail monitor");
    const [report] = channel.ofKind("report").map((m) => m.view as ReportView);
    expect(report?.body).toBe("reported");
    expect(h.tasks()[0]?.stage).toBe("stuck");
  });
});
