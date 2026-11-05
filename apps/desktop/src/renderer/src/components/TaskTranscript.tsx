// The conversation of one task: what AgentHerd sent the agent, its replies and its tool calls.
// Polls the host while open, so a running task updates on its own.

import { Check, Loader2, Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { host, type Task, type TranscriptView } from "../store";
import { hhmm, STAGE_LABEL } from "./labels";
import { Modal } from "./Modal";
import { Badge } from "./ui";

/** How often an open transcript asks for new lines. */
const POLL_MS = 1500;

function ToolStatus({ status }: { status?: string }) {
  if (status === "completed") return <Check size={13} className="shrink-0 text-success-text" />;
  if (status === "failed") return <X size={13} className="shrink-0 text-danger-text" />;
  return <Loader2 size={13} className="shrink-0 animate-spin text-ink-muted" />;
}

function Entry({ entry }: { entry: TranscriptView["entries"][number] }) {
  switch (entry.role) {
    case "prompt":
      return (
        <div className="flex flex-col items-end gap-1">
          <span className="text-ink-muted text-xs">发给 Agent · {hhmm(entry.at)}</span>
          <div className="selectable max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-accent-soft px-3 py-2 text-ink text-md">
            {entry.text}
          </div>
        </div>
      );
    case "agent":
      return (
        <div className="selectable whitespace-pre-wrap break-words text-ink text-md leading-relaxed">
          {entry.text}
        </div>
      );
    case "tool":
      return (
        <div className="flex items-center gap-2 rounded-md bg-inset px-2.5 py-1.5">
          <Terminal size={13} className="shrink-0 text-ink-muted" />
          <span
            className="selectable min-w-0 flex-1 truncate font-mono text-ink-2 text-sm"
            title={entry.text}
          >
            {entry.text}
          </span>
          <ToolStatus status={entry.status} />
        </div>
      );
    default:
      return <div className="selectable text-center text-ink-muted text-sm">{entry.text}</div>;
  }
}

export function TaskTranscript({ task, onClose }: { task: Task; onClose: () => void }) {
  const [view, setView] = useState<TranscriptView | undefined>();
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const next = await host().transcript(task.id);
        if (!stopped) {
          setView(next);
          setFailed(false);
        }
      } catch {
        if (!stopped) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [task.id]);

  // Follow new lines while the owner is at the bottom; leave them alone when they scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the transcript changes
  useEffect(() => {
    const el = scroller.current;
    if (el !== null && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [view]);

  const stage = STAGE_LABEL[task.stage];
  const entries = view?.entries ?? [];
  const live = view?.live ?? "";
  return (
    <Modal
      size="large"
      title={task.title}
      description={
        <span className="flex items-center gap-2">
          <Badge tone={stage.tone}>{stage.text}</Badge>
          {task.project} · {task.agent}
        </span>
      }
      onClose={onClose}
    >
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2"
      >
        {view === undefined && !failed && <p className="text-ink-muted text-md">加载中…</p>}
        {failed && <p className="text-ink-muted text-md">读不到对话，稍后再试。</p>}
        {view !== undefined && entries.length === 0 && live === "" && (
          <p className="text-ink-muted text-md">
            还没有对话记录。这个功能上线前开始的任务没有记录。
          </p>
        )}
        {entries.map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
        {live !== "" && (
          <div className="selectable whitespace-pre-wrap break-words text-ink text-md leading-relaxed">
            {live}
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-ink-muted align-middle" />
          </div>
        )}
      </div>
    </Modal>
  );
}
