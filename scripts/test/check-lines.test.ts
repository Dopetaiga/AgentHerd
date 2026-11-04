import { describe, expect, it } from "vitest";
import { countLines, isChecked, longFiles, MAX_LINES } from "../check-lines.ts";

describe("check-lines", () => {
  it("counts lines the way an editor shows them", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
  });

  it("checks source files and skips the forked Pi loop and other files", () => {
    expect(isChecked("packages/core/src/herd.ts")).toBe(true);
    expect(isChecked("apps/desktop/src/renderer/src/App.tsx")).toBe(true);
    expect(isChecked("apps/desktop/src/renderer/src/tokens.css")).toBe(true);
    expect(isChecked("packages/herder-loop/src/agent.ts")).toBe(false);
    expect(isChecked("packages/herder-loop/test/agent.test.ts")).toBe(false);
    expect(isChecked("docs/spec/04-herder.md")).toBe(false);
    expect(isChecked("pnpm-lock.yaml")).toBe(false);
  });

  it("reports files over the limit, longest first", () => {
    const text = (n: number) => "x\n".repeat(n);
    expect(
      longFiles([
        { path: "a.ts", text: text(MAX_LINES) },
        { path: "b.ts", text: text(MAX_LINES + 1) },
        { path: "c.tsx", text: text(MAX_LINES + 50) },
        { path: "packages/herder-loop/src/big.ts", text: text(2000) },
        { path: "notes.md", text: text(2000) },
      ]),
    ).toEqual([
      { path: "c.tsx", lines: MAX_LINES + 50 },
      { path: "b.ts", lines: MAX_LINES + 1 },
    ]);
  });
});
