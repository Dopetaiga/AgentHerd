// 这台电脑上已有的服务 (ADR 0107): model services other apps here are already set up with. The
// host looks once by itself; 探测 looks again. A service is added only when the owner taps 添加,
// and its key never comes to this page (only its first and last characters).

import type { FoundServicesView } from "@agentherd/host/api";
import { FOUND_SOURCE_NAMES } from "@agentherd/host/api";
import { Check, Plus, RefreshCw, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { foundLine, foundOrder, sourcesText } from "../found-services";
import { applyModels, call } from "../store";
import { Badge, Button, Group, IconTile, Row, Section } from "./ui";

export function FoundServices() {
  const [view, setView] = useState<FoundServicesView | undefined>();
  const [looking, setLooking] = useState(false);
  const [adding, setAdding] = useState<string | undefined>();

  useEffect(() => {
    void call((h) => h.foundServices()).then((v) => v !== undefined && setView(v));
  }, []);

  const look = async () => {
    setLooking(true);
    const v = await call((h) => h.findServices());
    if (v !== undefined) setView(v);
    setLooking(false);
  };

  const add = async (id: string) => {
    setAdding(id);
    const models = await call((h) => h.addFoundService(id));
    applyModels(models);
    const v = await call((h) => h.foundServices());
    if (v !== undefined) setView(v);
    setAdding(undefined);
  };

  const list = foundOrder(view?.services ?? []);
  const fresh = list.filter((s) => s.added === undefined).length;
  const probe = (
    <Button size="sm" onClick={() => void look()} disabled={looking}>
      <RefreshCw size={13} className={looking ? "animate-spin" : ""} />{" "}
      {looking ? "正在找…" : "探测"}
    </Button>
  );

  return (
    <Section
      title="这台电脑上已有的服务"
      hint={
        view === undefined
          ? "正在看 Claude Code、Codex、CC Switch 等 App 里配好的服务…"
          : list.length === 0
            ? "在 Claude Code、Codex、CC Switch、DeepSeek Harness、Pi、OpenCode 和环境变量里都没找到配好的服务"
            : fresh === 0
              ? "找到的都已经加上了"
              : `从别的 App 里找到 ${fresh} 个还没加的服务，点「添加」就能用，Key 会一起带过来`
      }
      actions={probe}
    >
      {list.length > 0 && (
        <Group>
          {list.map((s) => (
            <Row
              key={s.id}
              icon={
                <IconTile tone={s.added === undefined ? "blue" : "green"}>
                  {s.added === undefined ? <ScanSearch size={14} /> : <Check size={14} />}
                </IconTile>
              }
              title={
                <span className="flex items-center gap-2">
                  {s.name}
                  <Badge>{sourcesText(s.sources)}</Badge>
                </span>
              }
              description={
                <span className="flex flex-col">
                  <span className="truncate">{foundLine(s)}</span>
                  <span className="font-mono text-xs">Key {s.keyHint}</span>
                </span>
              }
              trailing={
                s.added === undefined ? (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={adding !== undefined}
                    onClick={() => void add(s.id)}
                  >
                    <Plus size={13} /> {adding === s.id ? "添加中…" : "添加"}
                  </Button>
                ) : (
                  <span className="text-ink-muted text-sm">已加为「{s.added.name}」</span>
                )
              }
            />
          ))}
        </Group>
      )}
      {(view?.problems.length ?? 0) > 0 && (
        <details className="mt-2 text-ink-muted text-sm">
          <summary className="cursor-pointer">有 {view?.problems.length} 个没能带过来</summary>
          <ul className="mt-1 list-disc pl-5">
            {view?.problems.map((p) => (
              <li key={`${p.source}:${p.message}`}>
                {FOUND_SOURCE_NAMES[p.source] ?? p.source}：{p.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
