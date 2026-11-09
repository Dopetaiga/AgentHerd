import { describe, expect, it } from "vitest";
import { cutWords, fitsOwner, ownerWords, tooLong } from "../src/owner-text.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("owner text (ADR 0049)", () => {
  it("counts English by words and Chinese by segmented words", () => {
    expect(ownerWords("Fixed the bug, see https://x.io/a.")).toBeGreaterThanOrEqual(4);
    expect(ownerWords("把保存按钮修好了")).toBeLessThan("把保存按钮修好了".length);
    expect(ownerWords("  ， 。")).toBe(0);
  });

  it("fits at the limit and not over it", () => {
    expect(fitsOwner(words(100))).toBe(true);
    expect(fitsOwner(words(101))).toBe(false);
    expect(fitsOwner(words(30), 30)).toBe(true);
    expect(fitsOwner(words(31), 30)).toBe(false);
    expect(fitsOwner("x".repeat(2000))).toBe(false);
  });

  it("cuts after the limit with an ellipsis", () => {
    const cut = cutWords(words(150));
    expect(cut.endsWith("w99…")).toBe(true);
    expect(fitsOwner(cut.slice(0, -1))).toBe(true);
    expect(cutWords("short")).toBe("short");
    expect(cutWords("x".repeat(2000)).length).toBe(801);
  });

  it("explains a refusal", () => {
    expect(tooLong("fine")).toBeUndefined();
    expect(tooLong(words(120))).toContain("120 words, at most 100 words");
    expect(tooLong("x".repeat(2000))).toContain("2000 characters");
  });
});
