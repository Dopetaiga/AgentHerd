import { describe, expect, it } from "vitest";
import { placeModels, tierOf, tiersText } from "../src/model-guide.ts";

describe("model tiers", () => {
  it("places known names and defaults the rest to balanced", () => {
    expect(tierOf("claude-opus-5-5")).toBe("strong");
    expect(tierOf("anthropic/claude-opus-5")).toBe("strong");
    expect(tierOf("gpt-6.1-sol")).toBe("strong");
    expect(tierOf("gemini-pro-latest")).toBe("strong");
    expect(tierOf("claude-sonnet-5-5")).toBe("balanced");
    expect(tierOf("deepseek-v4-pro")).toBe("balanced");
    expect(tierOf("step-5-preview")).toBe("balanced");
    expect(tierOf("deepseek-flash")).toBe("fast");
    expect(tierOf("gpt-5.4-mini")).toBe("fast");
    expect(tierOf("claude-haiku-5-5")).toBe("fast");
  });

  it("keeps the owner's placement, drops removed models, appends new ones", () => {
    const p = placeModels(["s/a", "s/claude-opus-5", "s/new-flash"], {
      fast: ["s/a", "s/gone"],
    });
    expect(p.fast).toEqual([
      { ref: "s/a", auto: false },
      { ref: "s/new-flash", auto: true },
    ]);
    expect(p.strong).toEqual([{ ref: "s/claude-opus-5", auto: true }]);
    expect(p.balanced).toEqual([]);
  });

  it("writes text for the Herder, empty without models", () => {
    const text = tiersText(placeModels(["s/claude-opus-5", "s/deepseek-flash"]));
    expect(text).toContain("Strong");
    expect(text).toContain("s/claude-opus-5");
    expect(text).toContain("what the task is");
    expect(text).not.toContain("Balanced");
    expect(tiersText(placeModels([]))).toBe("");
  });
});
