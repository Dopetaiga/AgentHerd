import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import {
  availableProfiles,
  commandCandidates,
  DSH_APP_BIN,
  findAgent,
  resolveProfile,
  searchPath,
} from "../src/profiles.ts";

describe("findAgent dsh", () => {
  const has =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);

  it("prefers AGENTHERD_DSH", () => {
    expect(
      findAgent(
        "dsh",
        { AGENTHERD_DSH: "/x/dsh", PATH: "/usr/bin" },
        has("/usr/bin/dsh"),
        "darwin",
      ),
    ).toBe("/x/dsh");
  });
  it("then searches PATH in order", () => {
    expect(findAgent("dsh", { PATH: "/a:/b" }, has("/b/dsh", DSH_APP_BIN), "darwin")).toBe(
      "/b/dsh",
    );
  });
  it("then falls back to the app bundle", () => {
    expect(findAgent("dsh", { PATH: "/a" }, has(DSH_APP_BIN), "darwin")).toBe(DSH_APP_BIN);
  });
  it("returns undefined when DSH is not installed", () => {
    expect(findAgent("dsh", { PATH: "" }, has(), "darwin")).toBeUndefined();
  });
});

describe("resolveProfile", () => {
  it("builds the dsh profile in read-only mode", () => {
    const p = resolveProfile("dsh", {
      configured: [],
      find: (id) => (id === "dsh" ? "/x/dsh" : undefined),
    });
    expect(p.command).toEqual(["/x/dsh", "acp"]);
    expect(p.env).toEqual({ DSH_PERMISSION_MODE: "read-only" });
  });
  it("lets a config.json profile replace a built-in one", () => {
    const mine = { id: "dsh", name: "Mine", command: ["dsh", "acp"], env: {}, exporter: null };
    expect(resolveProfile("dsh", { configured: [mine], find: () => undefined })).toBe(mine);
  });
  it("explains how to install DSH when it is missing", () => {
    expect(() => resolveProfile("dsh", { configured: [], find: () => undefined })).toThrow(
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
      find: (id) => (id === "dsh" ? "/bin/dsh" : undefined),
    }).map((p) => p.id);
    expect(ids).toEqual(["x", "dsh", "mock"]);
  });

  it("skips dsh when not installed and mock without a script", () => {
    expect(availableProfiles({ configured: [], find: () => undefined })).toEqual([]);
  });

  it("a configured dsh profile wins over the built-in one", () => {
    const mine = { id: "dsh", name: "My DSH", command: ["d"], env: {}, exporter: null };
    const list = availableProfiles({
      configured: [mine],
      find: (id) => (id === "dsh" ? "/bin/dsh" : undefined),
    });
    expect(list).toEqual([mine]);
  });
});

describe("pi", () => {
  const has =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);

  it("finds Pi from AGENTHERD_PI, then PATH", () => {
    expect(findAgent("pi", { AGENTHERD_PI: "/x/pi", PATH: "/b" }, has("/b/pi"), "darwin")).toBe(
      "/x/pi",
    );
    expect(findAgent("pi", { PATH: "/a:/b" }, has("/b/pi"), "darwin")).toBe("/b/pi");
    expect(findAgent("pi", { PATH: "/a" }, has(), "darwin")).toBeUndefined();
  });

  it("runs Pi behind the bundled bridge, with the chosen model in env", () => {
    const p = resolveProfile("pi", {
      configured: [],
      find: () => "/b/pi",
      piModelEnv: { AGENTHERD_PI_MODEL: "{}", AGENTHERD_PI_KEY: "k" },
    });
    expect(p.command.slice(1)).toEqual([
      expect.stringMatching(/pi-acp[\\/]bin[\\/]pi-acp\.ts$/),
      "--pi",
      "/b/pi",
    ]);
    expect(p.env).toMatchObject({ AGENTHERD_PI_MODEL: "{}", AGENTHERD_PI_KEY: "k" });
  });

  it("explains where to get Pi", () => {
    expect(() => resolveProfile("pi", { configured: [], find: () => undefined })).toThrow(
      /Agent page.*AGENTHERD_PI/,
    );
  });

  it("is listed after dsh when installed", () => {
    const ids = availableProfiles({
      configured: [],
      find: (id) => ({ dsh: "/bin/dsh", pi: "/bin/pi" })[id],
    }).map((p) => p.id);
    expect(ids).toEqual(["dsh", "pi"]);
  });
});

describe("findAgent on Windows", () => {
  const has =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p);
  const PATH = "C:\\a;C:\\nodejs";

  it("finds npm's .cmd shim, not the shell script beside it", () => {
    const found = findAgent(
      "dsh",
      { PATH },
      has("C:\\nodejs\\dsh", "C:\\nodejs\\dsh.cmd"),
      "win32",
    );
    expect(found).toBe("C:\\nodejs\\dsh.cmd");
  });
  it("finds an .exe", () => {
    expect(findAgent("pi", { PATH }, has("C:\\a\\pi.exe"), "win32")).toBe("C:\\a\\pi.exe");
  });
  it("does not look for the macOS app bundle", () => {
    expect(findAgent("dsh", { PATH: "" }, () => true, "win32")).toBeUndefined();
  });
});

describe("commandCandidates", () => {
  it("tries each PATHEXT extension on Windows", () => {
    expect(commandCandidates("C:\\b", "pi", "win32", ".EXE;.CMD")).toEqual([
      "C:\\b\\pi.exe",
      "C:\\b\\pi.cmd",
    ]);
  });
  it("keeps a name that already has an extension", () => {
    expect(commandCandidates("C:\\b", "pi.exe", "win32", ".EXE;.CMD")).toEqual(["C:\\b\\pi.exe"]);
  });
  it("uses the bare name elsewhere", () => {
    expect(commandCandidates("/b", "pi", "linux")).toEqual(["/b/pi"]);
  });
});

describe("searchPath", () => {
  it("keeps PATH and adds the usual install folders without duplicates", () => {
    const path = searchPath({
      PATH: ["/usr/bin", "/opt/homebrew/bin"].join(delimiter),
    }).split(delimiter);
    expect(path.slice(0, 2)).toEqual(["/usr/bin", "/opt/homebrew/bin"]);
    expect(path).toContain("/usr/local/bin");
    expect(path.filter((d) => d === "/opt/homebrew/bin")).toHaveLength(1);
  });
});
