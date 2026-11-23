import { afterEach, expect, it, vi } from "vitest";

const fakeUrl = (domain: string, token: string) =>
  `https://qyapi.weixin.qq.com/mcp/v2/bot/${domain}?token=${token}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

it("previews multiple WeCom connections without exposing credentials", async () => {
  const location = { search: "?sim=ready" };
  const browser: Partial<Window> = {};
  Object.assign(browser, { location });
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", browser);
  await import("../src/renderer/src/dev-bridge.js");
  const host = window.agentherd.host;

  await expect(host.wecom()).resolves.toEqual({ connections: [] });
  const config = JSON.stringify(
    {
      mcpServers: {
        docs: { type: "streamable-http", url: fakeUrl("doc", "fake-doc-only") },
        calendar: { type: "streamable-http", url: fakeUrl("calendar", "fake-calendar-only") },
      },
    },
    null,
    2,
  );
  const added = await host.configureWecom(config);
  expect(added.connections.map(({ id }) => id)).toEqual(["doc", "calendar"]);
  expect(JSON.stringify(added)).not.toMatch(/fake-|qyapi/);

  const replaced = await host.configureWecom(fakeUrl("doc", "fake-replacement-only"));
  expect(replaced.connections.map(({ id }) => id)).toEqual(["doc", "calendar"]);
  const checked = await host.checkWecom();
  expect(checked.connections.map(({ state }) => state)).toEqual(["ready", "ready"]);
  expect(checked.connections.every(({ toolCount }) => toolCount > 0)).toBe(true);

  const removed = await host.removeWecom("doc");
  expect(removed.connections.map(({ id }) => id)).toEqual(["calendar"]);
  await expect(host.wecom()).resolves.toEqual(removed);
});
