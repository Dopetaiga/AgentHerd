// 这台电脑上已有的服务 (ADR 0107), kept small: one line of chips under the services. Tap a chip to
// add it with its key, × to put it away (it stays away until 恢复). 探测 looks again and says what
// it found. Services already in AgentHerd are not offered.

import type { FoundServicesView } from "@agentherd/host/api";
import { FOUND_SOURCE_NAMES } from "@agentherd/host/api";
import { Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chipNote, foundLine, lookResult, offered } from "../found-services";
import { applyModels, call } from "../store";

const LOOK_MIN_MS = 700;
const SAID_MS = 4000;

export function FoundServices() {
  const [view, setView] = useState<FoundServicesView | undefined>();
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const [said, setSaid] = useState<string | undefined>();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void call((h) => h.foundServices()).then((v) => v !== undefined && setView(v));
    return () => clearTimeout(timer.current);
  }, []);

  const say = (text: string) => {
    setSaid(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaid(undefined);
      setFresh(new Set());
    }, SAID_MS);
  };

  const look = async () => {
    const before = new Set(offered(view?.services ?? []).map((s) => s.id));
    setLooking(true);
    const [v] = await Promise.all([
      call((h) => h.findServices()),
      new Promise((r) => setTimeout(r, LOOK_MIN_MS)),
    ]);
    setLooking(false);
    if (v === undefined) return;
    setView(v);
    setFresh(
      new Set(
        offered(v.services)
          .filter((s) => !before.has(s.id))
          .map((s) => s.id),
      ),
    );
    say(lookResult(before, v.services));
  };

  const add = async (id: string, name: string) => {
    setBusy(id);
    const models = await call((h) => h.addFoundService(id));
    if (models !== undefined) {
      applyModels(models);
      say(`已添加「${name}」`);
    }
    const v = await call((h) => h.foundServices());
    if (v !== undefined) setView(v);
    setBusy(undefined);
  };

  const hide = async (id: string) => {
    const v = await call((h) => h.hideFoundService(id));
    if (v !== undefined) setView(v);
  };

  const unhide = async () => {
    const v = await call((h) => h.showFoundServices());
    if (v !== undefined) setView(v);
  };

  if (view === undefined) return null;
  const list = offered(view.services);
  const problems = view.problems;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line border-dashed px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <Sparkles size={13} className="shrink-0 text-accent-text" />
        <span className="min-w-0 flex-1 truncate text-ink-2">
          {list.length === 0
            ? "这台电脑上没有别的可以直接加的服务"
            : `这台电脑上还有 ${list.length} 个服务，点一下连 Key 一起加进来`}
        </span>
        {said !== undefined && <span className="shrink-0 text-ink-muted text-xs">{said}</span>}
        <button
          type="button"
          onClick={() => void look()}
          disabled={looking}
          title="再看一遍 Claude Code、Codex、CC Switch 等 App 里配好的服务"
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-ink-2 text-xs hover:bg-hover hover:text-ink disabled:opacity-60"
        >
          <RefreshCw size={12} className={looking ? "animate-spin" : ""} />
          {looking ? "正在看…" : "探测"}
        </button>
      </div>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => (
            <span
              key={s.id}
              className={`group inline-flex h-7 items-center rounded-full bg-control-hover text-xs transition-shadow ${
                fresh.has(s.id) ? "ring-2 ring-accent" : ""
              }`}
            >
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => void add(s.id, s.name)}
                title={`${foundLine(s)}\nKey ${s.keyHint}\n来自 ${s.sources.map((x) => FOUND_SOURCE_NAMES[x] ?? x).join("、")}`}
                className="inline-flex h-full items-center gap-1.5 rounded-l-full pr-1 pl-2.5 hover:bg-hover disabled:opacity-60"
              >
                {busy === s.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Plus size={12} />
                )}
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-ink-muted">{chipNote(s)}</span>
              </button>
              <button
                type="button"
                onClick={() => void hide(s.id)}
                aria-label={`不再提示「${s.name}」`}
                title="不再提示这个"
                className="inline-flex h-full items-center rounded-r-full pr-2 pl-1 text-ink-muted hover:bg-hover hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {(view.hidden > 0 || problems.length > 0) && (
        <div className="flex gap-3 text-ink-muted text-xs">
          {view.hidden > 0 && (
            <button type="button" onClick={() => void unhide()} className="hover:text-ink">
              已隐藏 {view.hidden} 个 · 恢复
            </button>
          )}
          {problems.length > 0 && (
            <span
              title={problems
                .map((p) => `${FOUND_SOURCE_NAMES[p.source] ?? p.source}：${p.message}`)
                .join("\n")}
            >
              {problems.length} 个用不了
            </span>
          )}
        </div>
      )}
    </div>
  );
}
