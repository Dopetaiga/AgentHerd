// 记忆: what the Herder remembers (ADR 0038), by kind. The owner can change the text of an entry,
// forget it, or bring a forgotten one back. The same as /记忆 /忘掉 /恢复 in Feishu.

import type { MemoryView } from "@agentherd/host/api";
import { Brain, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, Group, Section } from "../components/ui";
import { call } from "../store";

type Entry = MemoryView["entries"][number];

const KINDS: readonly { kind: Entry["kind"]; label: string; hint: string }[] = [
  { kind: "owner", label: "关于你", hint: "你说过要一直这样的事，主管每次都会看" },
  { kind: "note", label: "主管笔记", hint: "主管自己记下的环境和做法，每次都会看" },
  { kind: "person", label: "人", hint: "你提到的人和他们负责什么" },
  { kind: "project", label: "项目", hint: "项目是什么、谁负责；路径只当线索" },
  { kind: "experience", label: "经验", hint: "从做过的任务里总结的做法，开新任务时会参考" },
  { kind: "case", label: "案例", hint: "每个结束的任务留下的记录" },
];

const SOURCE: Record<Entry["source"], string> = {
  said: "你说的",
  noticed: "主管记的",
  task: "任务总结",
  review: "回顾对话",
  owner_edit: "你改过",
};

function day(iso: string): string {
  return iso.slice(5, 10).replace("-", "/");
}

function projectName(scope: string): string | undefined {
  if (!scope.startsWith("project:")) return undefined;
  return scope.slice("project:".length).split("/").filter(Boolean).at(-1);
}

function EntryRow({ entry, onChange }: { entry: Entry; onChange: (v: MemoryView) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.abstract);
  const [open, setOpen] = useState(false);
  const project = projectName(entry.scope);
  const save = async () => {
    const v = await call((h) => h.editMemory(entry.id, text));
    if (v !== undefined) {
      onChange(v);
      setEditing(false);
    }
  };
  const forget = async () => {
    const v = await call((h) => h.forgetMemory(entry.id));
    if (v !== undefined) onChange(v);
  };
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5">
      {editing ? (
        <div className="flex items-start gap-2">
          <textarea
            className="min-h-16 flex-1 resize-y rounded-md border border-line-strong bg-control px-2 py-1.5 text-ink text-md outline-none focus:border-accent"
            value={text}
            maxLength={200}
            aria-label="记忆内容"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <Button variant="primary" size="sm" onClick={() => void save()}>
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText(entry.abstract);
                setEditing(false);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="min-w-0 flex-1 text-left text-ink text-md"
            disabled={entry.body === "" && entry.evidence === undefined}
            onClick={() => setOpen(!open)}
            title={entry.body === "" ? undefined : "展开详情"}
          >
            {entry.abstract}
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="修改" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </Button>
            <Button variant="ghost" size="sm" aria-label="忘掉" onClick={() => void forget()}>
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-ink-muted text-xs">
        <Badge>{SOURCE[entry.source]}</Badge>
        {project !== undefined && <Badge tone="blue">{project}</Badge>}
        {entry.scope === "global" && (entry.kind === "experience" || entry.kind === "case") && (
          <Badge tone="green">通用</Badge>
        )}
        {entry.until !== undefined && <Badge tone="amber">到 {entry.until}</Badge>}
        <span>{day(entry.createdAt)}</span>
        {entry.accessCount > 0 && <span>· 用过 {entry.accessCount} 次</span>}
      </div>
      {open && (
        <div className="whitespace-pre-wrap rounded-md bg-control-hover px-3 py-2 text-ink-2 text-sm">
          {entry.evidence !== undefined && <div>依据：「{entry.evidence}」</div>}
          {entry.body}
        </div>
      )}
    </div>
  );
}

export function MemoryPage() {
  const [view, setView] = useState<MemoryView | undefined>();
  const load = useCallback(async () => {
    const v = await call((h) => h.memories());
    if (v !== undefined) setView(v);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (view === undefined) return null;
  if (!view.ready) {
    return (
      <Group>
        <EmptyState
          icon={<Brain size={18} />}
          text="连上飞书、AgentHerd 开始工作后，这里会显示主管记住的东西。"
        />
      </Group>
    );
  }
  if (view.entries.length === 0 && view.deleted.length === 0) {
    return (
      <Group>
        <EmptyState
          icon={<Brain size={18} />}
          title="主管还没记住什么"
          text="你在飞书里说「以后都…」「记住…」，或者任务做完后，主管会把值得长期记住的写在这里。"
        />
      </Group>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {KINDS.map(({ kind, label, hint }) => {
        const rows = view.entries.filter((e) => e.kind === kind);
        if (rows.length === 0) return null;
        const cap = kind === "owner" || kind === "note" ? view.caps[kind] : undefined;
        return (
          <Section
            key={kind}
            title={label}
            hint={hint}
            actions={
              cap === undefined ? undefined : (
                <span className="text-ink-muted text-xs">
                  {view.used[kind as "owner" | "note"]}/{cap} 字
                </span>
              )
            }
          >
            <Group>
              {rows.map((e) => (
                <EntryRow key={`${e.id}-${e.rev}`} entry={e} onChange={setView} />
              ))}
            </Group>
          </Section>
        );
      })}
      {view.deleted.length > 0 && (
        <Section title="最近忘掉的" hint="点恢复就能找回">
          <Group>
            {view.deleted.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-ink-muted text-md line-through">
                  {e.abstract}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void call((h) => h.restoreMemory(e.id)).then((v) => v && setView(v))
                  }
                >
                  <RotateCcw size={13} />
                  恢复
                </Button>
              </div>
            ))}
          </Group>
        </Section>
      )}
    </div>
  );
}
