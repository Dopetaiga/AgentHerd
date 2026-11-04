// The sidebar's footer: one line that says whether Feishu is connected. When the owner can do
// something about a connect error, a click shows it with 重新连接.

import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { canReconnect, channelErrorLabel } from "./labels";
import { ReconnectButton } from "./ReconnectButton";
import { Button, Dot } from "./ui";

const LINE =
  "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-ink-muted text-sm";

export function SidebarStatus() {
  const hostConnected = useApp((s) => s.connected);
  const channel = useApp((s) => s.status?.channel);
  const setPage = useApp((s) => s.setPage);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const retry = channel !== undefined && canReconnect(channel);
  const showPopover = open && hostConnected && retry;

  useEffect(() => {
    if (!showPopover) return;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [showPopover]);

  if (!hostConnected) {
    return (
      <div className="mt-auto px-2.5 py-3">
        <div className={LINE}>
          <Dot tone="amber" pulse />
          服务未连接
        </div>
      </div>
    );
  }

  const tone = channel?.connected ? "green" : retry ? "red" : channel?.bound ? "amber" : "gray";
  return (
    <div ref={root} className="relative mt-auto px-2.5 py-3">
      {showPopover && (
        <div
          role="dialog"
          aria-label="飞书未连接"
          className="ah-dialog-in absolute bottom-full left-2.5 z-30 mb-1 w-72 rounded-lg bg-surface-raised p-3 shadow-(--ah-shadow-toast) ring-1 ring-line-strong"
        >
          <div className="font-medium text-ink">飞书未连接</div>
          <p className="selectable mt-1 break-words text-ink-muted text-sm">
            {channelErrorLabel(channel?.error ?? "")}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <ReconnectButton size="sm" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setPage("settings");
              }}
            >
              打开设置
            </Button>
          </div>
        </div>
      )}
      <button
        type="button"
        data-status-line
        aria-expanded={retry ? showPopover : undefined}
        onClick={() => (retry ? setOpen(!open) : setPage("settings"))}
        className={`${LINE} hover:bg-hover hover:text-ink`}
      >
        <Dot tone={tone} />
        {channel?.connected ? "已连接飞书" : "飞书未连接"}
      </button>
    </div>
  );
}
