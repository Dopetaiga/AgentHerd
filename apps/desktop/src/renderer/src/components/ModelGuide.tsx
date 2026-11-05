// The model guide on the 主管 page: the advice the Herder reads when it picks a task's model
// (ADR 0026). AgentHerd ships a default; the owner edits it here.

import type { ModelGuideView } from "@agentherd/host/api";
import { useEffect, useState } from "react";
import { call } from "../store";
import { Badge, Button, Section } from "./ui";

export function ModelGuide() {
  const [guide, setGuide] = useState<ModelGuideView | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void call((h) => h.modelGuide()).then((g) => {
      if (g === undefined) return;
      setGuide(g);
      setDraft(g.text);
    });
  }, []);

  const save = async (text: string | null) => {
    setSaving(true);
    const g = await call((h) => h.setModelGuide(text));
    setSaving(false);
    if (g === undefined) return;
    setGuide(g);
    setDraft(g.text);
  };

  if (guide === null) return null;
  const changed = draft.trim() !== guide.text.trim();

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          模型选择参考
          <Badge tone={guide.custom ? "blue" : "gray"}>{guide.custom ? "你改过" : "默认"}</Badge>
        </span>
      }
      hint="主管给任务挑模型时会看这段话，比如哪个模型最强、什么任务用便宜的。随时可以改。"
      actions={
        <>
          {guide.custom && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
              恢复默认
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!changed || saving}
            onClick={() => void save(draft)}
          >
            保存
          </Button>
        </>
      }
    >
      <textarea
        aria-label="模型选择参考"
        className="ah-input min-h-72 resize-y p-3 font-mono text-sm leading-relaxed"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
    </Section>
  );
}
