import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText } from "../src/renderer/src/markdown";

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, fenced code and rules", () => {
    const text = "## 结果\n\n第一行\n第二行\n\n```ts\nconst a = 1;\n```\n\n---";
    expect(parseMarkdown(text)).toEqual([
      { kind: "heading", level: 2, text: "结果" },
      { kind: "paragraph", text: "第一行\n第二行" },
      { kind: "code", lang: "ts", text: "const a = 1;" },
      { kind: "rule" },
    ]);
  });

  it("reads lists with nesting and task boxes", () => {
    const [list] = parseMarkdown("- a\n  - b\n- [x] done\n\n1. one\n2. two");
    expect(list).toEqual({
      kind: "list",
      ordered: false,
      start: 1,
      items: [
        {
          text: "a",
          checked: undefined,
          children: [
            {
              kind: "list",
              ordered: false,
              start: 1,
              items: [{ text: "b", checked: undefined, children: [] }],
            },
          ],
        },
        { text: "done", checked: true, children: [] },
      ],
    });
    expect(parseMarkdown("3. three\n4. four")[0]).toMatchObject({
      kind: "list",
      ordered: true,
      start: 3,
    });
  });

  it("reads tables and quotes", () => {
    expect(parseMarkdown("| a | b |\n|:--|--:|\n| 1 | 2 |")).toEqual([
      { kind: "table", align: ["left", "right"], head: ["a", "b"], rows: [["1", "2"]] },
    ]);
    expect(parseMarkdown("> note\n> more")).toEqual([
      { kind: "quote", children: [{ kind: "paragraph", text: "note\nmore" }] },
    ]);
  });

  it("keeps an unclosed fence as code", () => {
    expect(parseMarkdown("```\npartial")).toEqual([{ kind: "code", lang: "", text: "partial" }]);
  });
});

describe("parseInline", () => {
  it("reads code, bold, italic, strikethrough and links", () => {
    expect(parseInline("**粗** *斜* ~~删~~ `x_y` [站](https://a.b)")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "粗" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "斜" }] },
      { kind: "text", text: " " },
      { kind: "del", children: [{ kind: "text", text: "删" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "x_y" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://a.b", children: [{ kind: "text", text: "站" }] },
    ]);
  });

  it("leaves snake_case, lone stars and unsafe links alone", () => {
    expect(parseInline("my_var_name 2 * 3")).toEqual([{ kind: "text", text: "my_var_name 2 * 3" }]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[x](javascript:alert(1))" },
    ]);
  });

  it("links bare URLs without trailing punctuation", () => {
    expect(parseInline("见 https://github.com/a/b。")).toEqual([
      { kind: "text", text: "见 " },
      {
        kind: "link",
        href: "https://github.com/a/b",
        children: [{ kind: "text", text: "https://github.com/a/b" }],
      },
      { kind: "text", text: "。" },
    ]);
  });
});

describe("plainText", () => {
  it("drops the marks for a one-line preview", () => {
    expect(plainText("## 完成\n- **改了** `a.ts`\n- 测试通过")).toBe("完成 改了 a.ts 测试通过");
  });
});
