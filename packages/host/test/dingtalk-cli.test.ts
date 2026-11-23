import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dingtalkCli, runDws } from "../src/dingtalk-cli.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentherd-dws-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function runFixture(
  source: string,
  args: string[] = [],
  stdin?: string,
  signal = new AbortController().signal,
) {
  return runDws(
    { executable: process.execPath, stateDir: dir },
    {
      args: ["-e", source, "--", ...args],
      ...(stdin === undefined ? {} : { stdin }),
    },
    signal,
    true,
  );
}

it("passes literal argv and stdin in an isolated environment", async () => {
  vi.stubEnv("DWS_TEST_NAMESPACE", "outside");
  vi.stubEnv("UNRELATED_TOKEN", "outside");
  const source = `const fs = require('node:fs'); console.log(JSON.stringify({
    args: process.argv.slice(1), input: fs.readFileSync(0, 'utf8'), cwd: process.cwd(),
    config: process.env.DWS_CONFIG_DIR, storage: process.env.DWS_KEYCHAIN_DIR,
    leaked: Boolean(process.env.DWS_TEST_NAMESPACE || process.env.UNRELATED_TOKEN)
  }));`;
  await expect(runFixture(source, ["--text=$test & copy"], "@file.txt\n纯文本")).resolves.toEqual({
    args: ["--text=$test & copy"],
    input: "@file.txt\n纯文本",
    cwd: dir,
    config: join(dir, "config"),
    storage: join(dir, "credentials"),
    leaked: false,
  });
});

it.each([
  ["failed", "console.log(JSON.stringify({ok:true})); process.exitCode=1"],
  ["output_limit", 'console.log("x".repeat(2200000))'],
  ["invalid_response", 'console.log("FAKE_PRIVATE_OUTPUT")'],
])("rejects %s without surfacing subprocess output", async (code, source) => {
  await expect(runFixture(source)).rejects.toMatchObject({ code });
});

it("reports missing executable without exposing its path", async () => {
  const cli = dingtalkCli({ executable: join(dir, "dws-missing"), stateDir: dir });
  await expect(cli.status(new AbortController().signal)).rejects.toMatchObject({
    code: "unavailable",
  });
});

it("aborts a stalled process and rejects its result", async () => {
  await expect(
    runFixture("setInterval(() => {}, 100)", [], undefined, AbortSignal.timeout(150)),
  ).rejects.toMatchObject({ code: "cancelled" });
});
