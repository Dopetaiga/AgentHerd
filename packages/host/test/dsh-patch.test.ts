import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dshPatchArgs, writeDshPatch } from "../src/dsh-patch.ts";

describe("DSH model overlay", () => {
  it("writes the overlay once per content under <home>/run and passes it with --patch", () => {
    const home = mkdtempSync(join(tmpdir(), "agentherd-dsh-"));
    const patch = [{ id: "acp", config: { provider: "agentherd", model: "m1" } }];
    const file = writeDshPatch(home, patch);
    expect(file.startsWith(join(home, "run"))).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(patch);
    expect(writeDshPatch(home, patch)).toBe(file);
    const other = writeDshPatch(home, [
      { id: "acp", config: { provider: "agentherd", model: "m2" } },
    ]);
    expect(other).not.toBe(file);
    expect(readdirSync(join(home, "run"))).toHaveLength(2);
    expect(dshPatchArgs(file)).toEqual(["--patch", file]);
  });
});
