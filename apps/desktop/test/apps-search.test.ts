import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { expect, it } from "vitest";

it("keeps only matching apps while typing, after a late reply, and after an app event", async () => {
  const out = mkdtempSync(join(tmpdir(), "agentherd-search-"));
  try {
    await build({
      configFile: false,
      root: join(import.meta.dirname, "fixtures"),
      plugins: [react()],
      logLevel: "silent",
      build: { outDir: out, emptyOutDir: true },
      base: "./",
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron: string =
      process.env.AGENTHERD_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
    const { stdout } = await promisify(execFile)(
      electron,
      [join(import.meta.dirname, "fixtures/apps-search.cjs"), join(out, "index.html")],
      { env, timeout: 20_000 },
    );
    const line = stdout.split("\n").find((s) => s.startsWith("SEARCH_RESULT "));
    expect(line, stdout).toBeDefined();
    const result = JSON.parse((line as string).slice("SEARCH_RESULT ".length));
    expect(result).toEqual({
      firstBatch: ["App 10", "App 11", "App 0", "App 1", "App 2"],
      secondBatch: [
        "App 10",
        "App 11",
        "App 0",
        "App 1",
        "App 2",
        "App 3",
        "App 4",
        "App 5",
        "App 6",
        "App 7",
      ],
      lastBatch: [
        "App 10",
        "App 11",
        "App 0",
        "App 1",
        "App 2",
        "App 3",
        "App 4",
        "App 5",
        "App 6",
        "App 7",
        "App 8",
        "App 9",
      ],
      moreAtEnd: false,
      extraCalls: 0,
      searchBatch: ["App 10", "App 11", "App 0", "App 1", "App 2"],
      searchExpanded: 10,
      resetBatch: 5,
      immediate: ["GitHub"],
      newer: ["GitHub"],
      late: ["GitHub"],
      storedAfterLate: ["gmail", "CODE_HOST"],
      clearedPending: ["Gmail", "GitHub"],
      slugOnly: ["GitHub"],
      event: ["GitHub"],
      cleared: ["Gmail", "GitHub"],
      noMatch: [],
    });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 30_000);
