import { describe, expect, it } from "vitest";
import { renderCard } from "../src/card.ts";
import { readableMath, texToText } from "../src/math.ts";

describe("readableMath", () => {
  it("writes inline TeX as plain text", () => {
    expect(readableMath(String.raw`复杂度（$O(n \log \log n)$）。`)).toBe(
      "复杂度（O(n log log n)）。",
    );
    expect(readableMath(String.raw`当 $x^2 + y_i \le \alpha$ 时`)).toBe("当 x² + yᵢ ≤ α 时");
    expect(readableMath(String.raw`共 $n$ 个，$a_{ij}$，$2^{n-1}$`)).toBe("共 n 个，aᵢⱼ，2ⁿ⁻¹");
  });

  it("writes display math and \\( \\) spans", () => {
    expect(readableMath(String.raw`$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$`)).toBe(
      "Σᵢ₌₁ⁿ i = (n(n+1))/2",
    );
    expect(readableMath(String.raw`即 \(\sqrt{x+1}\) 与 \[\frac{a}{b}\]`)).toBe("即 √(x+1) 与 a/b");
  });

  it("leaves money, shell variables and code alone", () => {
    const text = "价格 $5 和 $10，变量 $HOME，`$x^2$`\n```\n$a_b$\n```";
    expect(readableMath(text)).toBe(text);
    expect(readableMath("no math here")).toBe("no math here");
  });

  it("puts math that would turn into markdown in inline code", () => {
    expect(readableMath(String.raw`$a_{bc}$`)).toBe("`a_(bc)`");
    expect(readableMath(String.raw`$a_{max}$`)).toBe("aₘₐₓ");
  });
});

describe("texToText", () => {
  it("knows common commands", () => {
    expect(texToText(String.raw`\mathbb{R}^n`)).toBe("Rⁿ");
    expect(texToText(String.raw`\binom{n}{k}`)).toBe("C(n, k)");
    expect(texToText(String.raw`\lfloor n/2 \rfloor`)).toBe("⌊ n/2 ⌋");
    expect(texToText(String.raw`10^{-3}`)).toBe("10⁻³");
    expect(texToText(String.raw`e^{i\pi}`)).toBe("e^(iπ)");
    expect(texToText(String.raw`\text{if } x \in S`)).toBe("if x ∈ S");
    expect(texToText(String.raw`\sqrt[3]{8}`)).toBe("∛8");
  });
});

describe("cards", () => {
  it("show math in a report as plain text", () => {
    const card = renderCard(
      {
        kind: "report",
        taskId: "t",
        title: "筛法",
        result: "done",
        body: String.raw`埃氏筛的复杂度是 $O(n \log \log n)$。`,
        summarized: false,
        automaticDecisions: [],
      },
      "zh-CN",
    );
    expect(JSON.stringify(card)).toContain("O(n log log n)");
    expect(JSON.stringify(card)).not.toContain("\\\\log");
  });
});
