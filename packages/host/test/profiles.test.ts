import { describe, expect, it } from "vitest";
import { availableProfiles, DSH_APP_BIN, findDsh, resolveProfile } from "../src/profiles.ts";

describe("findDsh", () => {
  const has =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);

  it("prefers AGENTHERD_DSH", () => {
    expect(findDsh({ AGENTHERD_DSH: "/x/dsh", PATH: "/usr/bin" }, has("/usr/bin/dsh"))).toBe(
      "/x/dsh",
    );
  });
  it("then searches PATH in order", () => {
    expect(findDsh({ PATH: "/a:/b" }, has("/b/dsh", DSH_APP_BIN))).toBe("/b/dsh");
  });
  it("then falls back to the app bundle", () => {
    expect(findDsh({ PATH: "/a" }, has(DSH_APP_BIN))).toBe(DSH_APP_BIN);
  });
  it("returns undefined when DSH is not installed", () => {
    expect(findDsh({ PATH: "" }, has())).toBeUndefined();
  });
});

describe("resolveProfile", () => {
  it("builds the dsh profile in read-only mode", () => {
    const p = resolveProfile("dsh", { configured: [], findDsh: () => "/x/dsh" });
    expect(p.command).toEqual(["/x/dsh", "acp"]);
    expect(p.env).toEqual({ DSH_PERMISSION_MODE: "read-only" });
  });
  it("lets a config.json profile replace a built-in one", () => {
    const mine = { id: "dsh", name: "Mine", command: ["dsh", "acp"], env: {}, exporter: null };
    expect(resolveProfile("dsh", { configured: [mine], findDsh: () => undefined })).toBe(mine);
  });
  it("explains how to install DSH when it is missing", () => {
    expect(() => resolveProfile("dsh", { configured: [], findDsh: () => undefined })).toThrow(
      /AGENTHERD_DSH/,
    );
  });
  it("requires a script for the mock profile", () => {
    expect(() => resolveProfile("mock", { configured: [] })).toThrow(/--script/);
    expect(resolveProfile("mock", { configured: [], script: "/s.yaml" }).command).toContain(
      "/s.yaml",
    );
  });
  it("lists known profiles for an unknown id", () => {
    expect(() => resolveProfile("nope", { configured: [] })).toThrow(/known: mock, dsh/);
  });
});

describe("availableProfiles", () => {
  it("lists configured profiles, then dsh when installed, then mock with a script", () => {
    const custom = { id: "x", name: "X", command: ["x"], env: {}, exporter: null };
    const ids = availableProfiles({
      configured: [custom],
      script: "/s.yaml",
      findDsh: () => "/bin/dsh",
    }).map((p) => p.id);
    expect(ids).toEqual(["x", "dsh", "mock"]);
  });

  it("skips dsh when not installed and mock without a script", () => {
    expect(availableProfiles({ configured: [], findDsh: () => undefined })).toEqual([]);
  });

  it("a configured dsh profile wins over the built-in one", () => {
    const mine = { id: "dsh", name: "My DSH", command: ["d"], env: {}, exporter: null };
    const list = availableProfiles({ configured: [mine], findDsh: () => "/bin/dsh" });
    expect(list).toEqual([mine]);
  });
});
