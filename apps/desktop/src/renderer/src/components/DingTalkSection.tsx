import type { DingTalkView, RemoteHost } from "@agentherd/host/api";
import { MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { host } from "../store";
import { ConnectionRow } from "./ConnectionRow";
import { Badge, Button, IconTile } from "./ui";

const labels = {
  unavailable: "不可用",
  disconnected: "未连接",
  connecting: "等待授权",
  connected: "已连接",
  failed: "连接失败",
};

export function applyDingTalkView(current: number, started: number, next: DingTalkView) {
  return current === started ? next : undefined;
}

export function DingTalkRow({
  view,
  onView,
}: {
  view: DingTalkView | undefined;
  onView: (view: DingTalkView) => void;
}) {
  const revision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [open, setOpen] = useState<boolean>();
  const state = view?.state;
  const connecting = view?.state === "connecting";
  const connected = view?.state === "connected";
  const failed = view?.state === "failed";
  const tone = connected ? "green" : failed ? "amber" : "gray";

  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  useEffect(() => {
    if ((state !== undefined && !connecting) || busy || problem !== "") return;
    const started = revision.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = applyDingTalkView(revision.current, started, await host().dingtalk());
        if (!active || next === undefined) return;
        onView(next);
        if (next.state === "connecting") timer = setTimeout(read, 1000);
      } catch {
        if (active && started === revision.current) {
          setProblem("无法读取钉钉连接状态，请重新检查。");
        }
      }
    };
    if (connecting) timer = setTimeout(read, 1000);
    else void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [state, connecting, busy, problem, onView]);

  async function update(request: (remote: RemoteHost) => Promise<DingTalkView>) {
    const started = ++revision.current;
    setBusy(true);
    setProblem("");
    setOpen(true);
    try {
      const next = applyDingTalkView(revision.current, started, await request(host()));
      if (next !== undefined) onView(next);
    } catch {
      if (started === revision.current) setProblem("无法更新钉钉连接，请重试或检查状态。");
    } finally {
      if (started === revision.current) setBusy(false);
    }
  }

  const action =
    state === "disconnected" ? (
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => void update((h) => h.startDingTalkLogin())}
      >
        浏览器授权
      </Button>
    ) : connecting ? (
      <Button size="sm" disabled={busy} onClick={() => void update((h) => h.cancelDingTalkLogin())}>
        取消授权
      </Button>
    ) : connected || failed ? (
      <Button size="sm" disabled={busy} onClick={() => void update((h) => h.disconnectDingTalk())}>
        {failed ? "清除连接" : "断开连接"}
      </Button>
    ) : undefined;
  const identity = [view?.userName, view?.corpName].filter(Boolean).join(" · ");

  return (
    <ConnectionRow
      icon={
        <IconTile tone={tone}>
          <MessagesSquare size={14} />
        </IconTile>
      }
      name="钉钉"
      badge={
        <Badge tone={tone === "gray" ? undefined : tone}>
          {state === undefined ? (problem ? "未能读取" : "读取中…") : labels[state]}
        </Badge>
      }
      subtitle={connected && identity ? identity : "日程、文档、群聊和 AI 听记"}
      action={action}
      open={open ?? (connecting || failed || problem !== "")}
      onOpenChange={setOpen}
    >
      <p className="text-ink-muted text-sm">
        Agent 只能在任务中使用已授权的钉钉能力。发群消息、新建日程或文档，每次都需要你在飞书确认。
      </p>
      {state === "unavailable" && (
        <p className="text-ink-muted text-sm">当前版本没有加载钉钉组件。</p>
      )}
      {connecting && (
        <p role="status" className="text-ink-muted text-sm">
          请在浏览器打开的钉钉授权页用手机钉钉扫码，然后选择组织。
        </p>
      )}
      {(problem !== "" || (failed && view.error !== undefined)) && (
        <p role="alert" className="text-danger-text text-sm">
          {problem || view?.error}
        </p>
      )}
      {problem !== "" && (
        <Button size="sm" disabled={busy} onClick={() => void update((h) => h.dingtalk())}>
          检查状态
        </Button>
      )}
      {connected && view.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {view.capabilities.map(({ id, name }) => (
            <Badge key={id}>{name}</Badge>
          ))}
        </div>
      )}
    </ConnectionRow>
  );
}
