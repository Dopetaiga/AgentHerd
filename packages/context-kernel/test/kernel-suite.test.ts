// The kernel's own node:test suite (tests/, kept as upstream has it) runs as part of `pnpm test`.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

it("the kernel's own test suite passes", () => {
  const run = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=dot", "--test-concurrency=4", "tests/*.test.ts"],
    { cwd: PACKAGE_DIR, encoding: "utf8" },
  );
  if (run.status !== 0) console.error(`${run.stdout.slice(-20_000)}\n${run.stderr.slice(-5_000)}`);
  expect(run.status).toBe(0);
}, 180_000);
