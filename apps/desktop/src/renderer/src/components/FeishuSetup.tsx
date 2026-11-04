// One-scan Feishu binding: start, show the QR code, follow the phases, cancel or retry.
// `useFeishuSetup` holds the flow; `FeishuSetup` is its card, `FeishuQr` the QR frame both use.

import { Check, Loader2, QrCode, RotateCcw, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { call, useApp } from "../store";
import { SETUP_PHASE_LABEL } from "./labels";
import { Button } from "./ui";

export function useFeishuSetup() {
  const setup = useApp((s) => s.setup);
  const channel = useApp((s) => s.status?.channel);
  const [busy, setBusy] = useState(false);
  const phase = setup?.phase ?? "idle";

  const start = async () => {
    setBusy(true);
    const next = await call((h) => h.setupFeishu());
    if (next !== undefined) useApp.setState({ setup: next });
    setBusy(false);
  };
  const cancel = async () => {
    const next = await call((h) => h.cancelSetup());
    if (next !== undefined) useApp.setState({ setup: next });
  };

  const running =
    phase === "starting" ||
    phase === "waiting-scan" ||
    phase === "waiting-confirm" ||
    phase === "verifying";
  /** Bound, and no new binding is under way. */
  const bound =
    phase === "connected" || (!running && phase !== "failed" && channel?.bound === true);
  return { setup, channel, phase, busy, running, bound, start, cancel };
}

export type FeishuFlow = ReturnType<typeof useFeishuSetup>;

/** The QR code while a binding runs: a spinner until it comes, then the code and its phase. */
export function FeishuQr({ flow }: { flow: FeishuFlow }) {
  const { setup, phase } = flow;
  const scanning = phase === "waiting-scan" && setup?.qrDataUrl !== undefined;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {/* QR codes need a light background in both color schemes to stay scannable. */}
      <div
        className={`flex h-48 w-48 items-center justify-center rounded-lg border border-line p-2.5 ${
          scanning ? "bg-paper" : "bg-inset"
        }`}
      >
        {scanning ? (
          <img
            src={setup.qrDataUrl}
            alt="飞书二维码"
            className="h-full w-full [image-rendering:pixelated]"
          />
        ) : (
          <Loader2 size={22} className="animate-spin text-ink-muted" />
        )}
      </div>
      <div className="font-semibold text-base text-ink">
        {phase === "waiting-scan" ? "用飞书扫码" : SETUP_PHASE_LABEL[phase]}
      </div>
      {setup?.expiresAt !== undefined && phase === "waiting-scan" && (
        <div className="-mt-1.5 text-ink-muted text-sm">
          二维码有效期至 {new Date(setup.expiresAt).toLocaleTimeString("zh-CN", { hour12: false })}
        </div>
      )}
    </div>
  );
}

function Notice({
  mark,
  title,
  children,
}: {
  mark: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
      {mark}
      <div className="font-semibold text-base text-ink">{title}</div>
      {children}
    </div>
  );
}

export function Mark({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${className}`}>
      {children}
    </span>
  );
}

/**
 * The binding card. With `autoStart` it asks for a new QR code as soon as it shows, for
 * 重新绑定; a binding still running when the card goes away is cancelled.
 */
export function FeishuSetup({ autoStart = false }: { autoStart?: boolean }) {
  const flow = useFeishuSetup();
  const { setup, channel, phase, busy, running, start, cancel } = flow;
  const started = useRef(false);
  const live = useRef(running);
  live.current = running;

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the card opens
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void start();
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the card closes
  useEffect(
    () => () => {
      if (autoStart && live.current) void cancel();
    },
    [],
  );

  if (flow.bound && !(autoStart && (busy || phase === "idle"))) {
    return (
      <Notice
        title="飞书已绑定"
        mark={
          <Mark className="bg-success-soft text-success-text">
            <Check size={22} />
          </Mark>
        }
      >
        <div className="text-ink-muted">
          {channel?.appId !== undefined ? `应用 ${channel.appId}` : "AgentHerd 会在飞书里找你"}
        </div>
        <Button variant="ghost" onClick={start} disabled={busy}>
          <RotateCcw size={13} /> 重新绑定
        </Button>
      </Notice>
    );
  }

  if (phase === "failed") {
    return (
      <Notice
        title="绑定失败"
        mark={
          <Mark className="bg-danger-soft text-danger-text">
            <X size={22} />
          </Mark>
        }
      >
        {setup?.error !== undefined && (
          <div className="selectable max-w-md text-danger-text">{setup.error}</div>
        )}
        <Button variant="primary" onClick={start} disabled={busy}>
          <RotateCcw size={13} /> 重试
        </Button>
      </Notice>
    );
  }

  if (!running && !(autoStart && busy)) {
    return (
      <Notice
        title="用飞书扫一次码"
        mark={
          <Mark className="bg-control-hover text-ink-muted">
            <QrCode size={22} strokeWidth={1.75} />
          </Mark>
        }
      >
        <div className="max-w-sm text-ink-muted leading-5">
          AgentHerd 会自动创建一个机器人。之后任务进度和需要你批准的请求都会发到飞书。
        </div>
        <Button variant="primary" onClick={start} disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}开始绑定
        </Button>
      </Notice>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-7">
      <FeishuQr flow={flow} />
      <Button variant="ghost" onClick={cancel}>
        取消
      </Button>
    </div>
  );
}
