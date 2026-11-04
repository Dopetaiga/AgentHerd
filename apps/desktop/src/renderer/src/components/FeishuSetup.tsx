// One-scan Feishu binding: start, show the QR code, follow the phases, cancel or retry.

import { CheckCircle2, Loader2, QrCode, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { call, useApp } from "../store";
import { SETUP_PHASE_LABEL } from "./labels";
import { Badge, Button } from "./ui";

export function FeishuSetup() {
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

  if (phase === "connected" || (!running && phase !== "failed" && channel?.bound === true)) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 size={44} className="text-emerald-500" />
        <div className="font-medium text-zinc-900 dark:text-zinc-100">飞书已绑定</div>
        <div className="text-sm text-zinc-500">
          {channel?.appId !== undefined ? `应用 ${channel.appId}` : "AgentHerd 会在飞书里找你"}
        </div>
        <Button size="sm" variant="ghost" onClick={start} disabled={busy}>
          <RotateCcw size={14} /> 重新绑定
        </Button>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <XCircle size={44} className="text-red-500" />
        <div className="font-medium text-zinc-900 dark:text-zinc-100">绑定失败</div>
        {setup?.error !== undefined && (
          <div className="selectable max-w-md text-sm text-red-600 dark:text-red-400">
            {setup.error}
          </div>
        )}
        <Button variant="primary" onClick={start} disabled={busy}>
          <RotateCcw size={14} /> 重试
        </Button>
      </div>
    );
  }

  if (!running) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <QrCode size={44} className="text-zinc-400" />
        <div className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
          用飞书扫一次码，AgentHerd
          会自动创建一个机器人。之后任务进度和需要你批准的请求都会发到飞书。
        </div>
        <Button variant="primary" onClick={start} disabled={busy}>
          {busy && <Loader2 size={14} className="animate-spin" />}开始
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700">
        {phase === "waiting-scan" && setup?.qrDataUrl !== undefined ? (
          <img
            src={setup.qrDataUrl}
            alt="飞书二维码"
            className="h-full w-full [image-rendering:pixelated]"
          />
        ) : (
          <Loader2 size={32} className="animate-spin text-zinc-400" />
        )}
      </div>
      <div className="font-medium text-zinc-900 dark:text-zinc-100">
        {phase === "waiting-scan" ? "用飞书扫码" : SETUP_PHASE_LABEL[phase]}
      </div>
      <Badge tone={phase === "waiting-scan" ? "gray" : "blue"}>
        {phase !== "waiting-scan" && <Loader2 size={12} className="animate-spin" />}
        {SETUP_PHASE_LABEL[phase]}
      </Badge>
      {setup?.expiresAt !== undefined && phase === "waiting-scan" && (
        <div className="text-xs text-zinc-500">
          二维码有效期至 {new Date(setup.expiresAt).toLocaleTimeString("zh-CN", { hour12: false })}
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={cancel}>
        取消
      </Button>
    </div>
  );
}
