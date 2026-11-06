// Renders the Markdown an agent writes as React elements (no HTML strings).

import type { ReactNode } from "react";
import { type Block, type Inline, parseInline, parseMarkdown } from "../markdown";

function Inlines({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${i}-${n.kind}`;
    switch (n.kind) {
      case "text":
        return n.text;
      case "break":
        return <br key={key} />;
      case "code":
        return (
          <code
            key={key}
            className="rounded-xs bg-control-hover px-1 py-px font-mono text-[0.9em] text-ink-2"
          >
            {n.text}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(n.children)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(n.children)}</em>;
      case "del":
        return <del key={key}>{renderInline(n.children)}</del>;
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noreferrer"
            title={n.href}
            className="text-accent-text underline underline-offset-2 hover:text-accent-hover"
          >
            {renderInline(n.children)}
          </a>
        );
      default:
        return null;
    }
  });
}

const HEADING_TAG = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const HEADING_CLASS = ["text-lg font-semibold", "text-md font-semibold", "text-md font-semibold"];

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = HEADING_TAG[block.level - 1] ?? "h6";
      return (
        <Tag className={`mt-1 text-ink ${HEADING_CLASS[block.level - 1] ?? "font-semibold"}`}>
          <Inlines text={block.text} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="break-words">
          <Inlines text={block.text} />
        </p>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-inset px-3 py-2 font-mono text-ink-2 text-sm leading-normal">
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr className="border-line" />;
    case "quote":
      return (
        <blockquote className="flex flex-col gap-2 border-line-strong border-l-2 pl-3 text-ink-2">
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={`flex flex-col gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items have no id and never reorder
            <li key={i} className={item.checked === undefined ? "" : "list-none"}>
              {item.checked !== undefined && (
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  disabled
                  className="-ml-5 mr-1.5 align-middle"
                />
              )}
              <Inlines text={item.text} />
              {item.children.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  <Blocks blocks={item.children} />
                </div>
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                    key={i}
                    style={{ textAlign: block.align[i] }}
                    className="border border-line bg-inset px-2 py-1 font-semibold"
                  >
                    <Inlines text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                      key={i}
                      style={{ textAlign: block.align[i] }}
                      className="border border-line px-2 py-1 align-top"
                    >
                      <Inlines text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional and re-parsed as a whole
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}

/** Agent text rendered as Markdown. `className` styles the outer box. */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`selectable flex min-w-0 flex-col gap-2 break-words ${className}`}>
      <Blocks blocks={parseMarkdown(text)} />
    </div>
  );
}
