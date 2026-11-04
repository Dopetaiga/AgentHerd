// Downloads of agent CLIs (runtimes.ts) and the Agents view, against a local HTTP server that
// serves a fake Pi archive.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import { afterEach, describe, expect, it } from "vitest";
import type { HostEvent } from "../src/api.ts";
import { writeConfig } from "../src/config.ts";
import { Host } from "../src/host.ts";
import { type RuntimeArtifact, type RuntimeLock, RuntimeStore } from "../src/runtimes.ts";

const TARGET = "test-target";
let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

function withArtifact(lock: RuntimeLock, patch: Partial<RuntimeArtifact>): RuntimeLock {
  const artifact = lock.artifacts[TARGET];
  if (artifact === undefined) throw new Error("no artifact");
  return { ...lock, artifacts: { [TARGET]: { ...artifact, ...patch } } };
}

/** A tar.gz with pi/pi printing `version`, served on localhost. */
async function fakePi(version = "9.9.9", reported = version) {
  const dir = mkdtempSync(join(tmpdir(), "fake-pi-"));
  mkdirSync(join(dir, "pi"));
  writeFileSync(join(dir, "pi", "pi"), `#!/bin/sh\necho ${reported}\n`);
  chmodSync(join(dir, "pi", "pi"), 0o755);
  const archive = join(dir, "pi.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", dir, "pi"]);
  const bytes = readFileSync(archive);
  server = createServer((req, res) => {
    if (req.url !== "/pi.tar.gz") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-length": bytes.length }).end(bytes);
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const lock: RuntimeLock = {
    id: "pi",
    version,
    executable: "pi/pi",
    artifacts: {
      [TARGET]: {
        url: `http://127.0.0.1:${port}/pi.tar.gz`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
    },
  };
  return lock;
}

describe("RuntimeStore", () => {
  it("downloads, checks and unpacks a pinned build", async () => {
    const lock = await fakePi();
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")), TARGET);
    expect(store.installed(lock)).toBeUndefined();
    const progress: number[] = [];
    const bin = await store.install(lock, (p) => progress.push(p.received));
    expect(bin).toBe(join(store.dir(lock), "pi/pi"));
    expect(store.installed(lock)).toBe(bin);
    expect(progress.at(-1)).toBe(lock.artifacts[TARGET]?.bytes);
    store.remove(lock);
    expect(store.installed(lock)).toBeUndefined();
  });

  it("refuses a download whose hash does not match", async () => {
    const lock = await fakePi();
    const bad = withArtifact(lock, { sha256: "0".repeat(64) });
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")), TARGET);
    await expect(store.install(bad)).rejects.toThrow(/does not match its SHA-256/);
    expect(store.installed(bad)).toBeUndefined();
  });

  it("refuses a build that reports another version", async () => {
    const lock = await fakePi("9.9.9", "1.0.0");
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")), TARGET);
    await expect(store.install(lock)).rejects.toThrow(/reports version "1.0.0"/);
  });

  it("has no build for an unknown platform", async () => {
    const lock = await fakePi();
    const store = new RuntimeStore(mkdtempSync(join(tmpdir(), "rt-")), "plan9-mips");
    expect(store.supported(lock)).toBe(false);
    await expect(store.install(lock)).rejects.toThrow(/no build for plan9-mips/);
  });
});

describe("Host agents", () => {
  it("downloads Pi from the GUI, then offers it to /run; removing it takes it away", async () => {
    const lock = await fakePi();
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    writeConfig(home, { channel: { channelId: "fake", ownerId: "owner", data: {} } });
    const events: HostEvent[] = [];
    const host = new Host({
      home,
      userHome: home,
      secrets: { get: () => undefined, set() {}, delete() {} },
      env: {},
      createChannel: () => new FakeChannel(),
      runtimes: new RuntimeStore(join(home, "runtimes"), TARGET),
      piRuntime: lock,
      findDsh: () => "/x/dsh",
      findSystemPi: () => undefined,
    });
    host.onEvent((e) => events.push(e));
    await host.start();
    try {
      expect(host.status().profiles).toEqual(["dsh"]);
      expect(host.agents().map((a) => [a.id, a.state, a.canInstall])).toEqual([
        ["dsh", "ready", false],
        ["pi", "missing", true],
      ]);
      expect(host.installAgent("pi").find((a) => a.id === "pi")?.state).toBe("installing");
      await host.agentsIdle();
      const pi = host.agents().find((a) => a.id === "pi");
      expect(pi).toMatchObject({ state: "ready", source: "managed", canRemove: true });
      expect(host.status().profiles).toEqual(["dsh", "pi"]);
      expect(events.some((e) => e.topic === "agents")).toBe(true);

      host.removeAgent("pi");
      expect(host.status().profiles).toEqual(["dsh"]);
      expect(() => host.removeAgent("dsh")).toThrow(/not downloaded/);
    } finally {
      await host.stop();
    }
  });

  it("shows a failed download and lets the owner try again", async () => {
    const lock = await fakePi();
    const broken = withArtifact(lock, { url: `${lock.artifacts[TARGET]?.url}x` });
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    const host = new Host({
      home,
      userHome: home,
      secrets: { get: () => undefined, set() {}, delete() {} },
      env: {},
      createChannel: () => new FakeChannel(),
      runtimes: new RuntimeStore(join(home, "runtimes"), TARGET),
      piRuntime: broken,
      findDsh: () => undefined,
      findSystemPi: () => undefined,
    });
    host.installAgent("pi");
    await host.agentsIdle();
    expect(host.agents().find((a) => a.id === "pi")).toMatchObject({
      state: "missing",
      canInstall: true,
      error: expect.stringMatching(/HTTP 404/),
    });
    await host.stop();
  });
});
