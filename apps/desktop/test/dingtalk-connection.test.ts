import { HOST_METHODS } from "@agentherd/host/api";
import { expect, it, vi } from "vitest";
import { applyDingTalkView } from "../src/renderer/src/components/DingTalkSection";

vi.mock("../src/renderer/src/store", () => ({ host: vi.fn() }));

it("registers only the account lifecycle IPC methods for DingTalk", () => {
  expect(HOST_METHODS.filter((method) => method.toLowerCase().includes("dingtalk"))).toEqual([
    "dingtalk",
    "startDingTalkLogin",
    "cancelDingTalkLogin",
    "disconnectDingTalk",
  ]);
});

it("does not let an old browser authorization status overwrite a cancelled login", () => {
  const disconnected = { state: "disconnected", capabilities: [] } as const;
  expect(applyDingTalkView(2, 1, { state: "connected", capabilities: [] })).toBeUndefined();
  expect(applyDingTalkView(2, 2, { ...disconnected, capabilities: [] })).toMatchObject(
    disconnected,
  );
});
