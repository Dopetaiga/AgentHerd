// 探测模型: asks an OpenAI- or Anthropic-compatible service for its model list (GET /models)
// so the owner can tick models instead of typing their ids. Used by the add form and the
// edit dialog of a custom service.

import type { ModelProbe, ProbeTarget } from "@agentherd/host/api";
import { Loader2, Radar } from "lucide-react";
import { useRef, useState } from "react";
import { errorText, host } from "../store";
import { Button } from "./ui";

export type ProbedModel = { id: string; name: string };

/** The models found so far and the state of the last probe. */
export function useModelProbe() {
  const [models, setModels] = useState<ProbedModel[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = useRef(0);

  /** Probes the target; returns the answer (or undefined if a newer probe or a reset won). */
  const probe = async (target: ProbeTarget): Promise<ModelProbe | undefined> => {
    const id = ++run.current;
    setRunning(true);
    setError(null);
    setNote(null);
    let r: ModelProbe;
    try {
      r = await host().probeModels(target);
    } catch (e) {
      r = { ok: false, message: errorText(e) };
    }
    if (id !== run.current) return undefined;
    setRunning(false);
    if (r.ok) {
      setModels(r.models);
      setNote(
        r.baseUrl === undefined
          ? `找到 ${r.models.length} 个模型，勾选要用的。`
          : `找到 ${r.models.length} 个模型。地址缺少 /v1，已改为 ${r.baseUrl}`,
      );
    } else {
      setError(`探测失败：${r.message}`);
    }
    return r;
  };

  /** Forgets the list, e.g. when another service is chosen. */
  const reset = () => {
    run.current++;
    setModels([]);
    setRunning(false);
    setError(null);
    setNote(null);
  };

  return { models, running, error, note, probe, reset };
}

export type ModelProbeState = ReturnType<typeof useModelProbe>;

export function ProbeButton({
  running,
  disabled,
  title,
  onClick,
}: {
  running: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <Button size="sm" onClick={onClick} disabled={disabled === true || running} title={title}>
      {running ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
      {running ? "探测中…" : "探测模型"}
    </Button>
  );
}
