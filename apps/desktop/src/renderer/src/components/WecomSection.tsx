import type { RemoteHost, WecomConnectionView, WecomView } from "@agentherd/host/api";
import { ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { call } from "../store";
import { ConnectionRow } from "./ConnectionRow";
import { Badge, Button, Group, IconTile, inputClass, Row } from "./ui";

const HELP_URL = "https://open.work.weixin.qq.com/help2/pc/21676";

function stateBadge({ state, toolCount }: WecomConnectionView) {
  switch (state) {
    case "ready":
      return toolCount === 0 ? (
        <Badge tone="amber">无可用工具</Badge>
      ) : (
        <Badge tone="green">已连接</Badge>
      );
    case "failed":
      return <Badge tone="amber">连接异常</Badge>;
    case "idle":
      return <Badge>待检查</Badge>;
  }
}

// The host or transport may include upstream details. Never put those in a toast.
function wecomCall(request: (host: RemoteHost) => Promise<WecomView>, message: string) {
  return call(async (host) => {
    try {
      return await request(host);
    } catch {
      throw new Error(message);
    }
  });
}

export function WecomRow({
  view,
  onView,
}: {
  view: WecomView | undefined;
  onView: (view: WecomView) => void;
}) {
  const inputId = useId();
  const [hasInput, setHasInput] = useState(false);
  const [busy, setBusy] = useState<"load" | "check" | "add" | "remove" | undefined>("load");
  const pending = busy !== undefined;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void wecomCall((host) => host.wecom(), "无法读取企业微信连接，请重试。").then((next) => {
      if (!active) return;
      if (next !== undefined) onView(next);
      setBusy(undefined);
    });
    return () => {
      active = false;
    };
  }, [onView]);

  async function update(
    action: "check" | "add" | "remove",
    request: (host: RemoteHost) => Promise<WecomView>,
    message: string,
  ) {
    setBusy(action);
    try {
      const next = await wecomCall(request, message);
      if (next !== undefined) onView(next);
    } finally {
      setBusy(undefined);
    }
  }

  const connections = view?.connections ?? [];
  const ready = connections.filter(
    ({ state, toolCount }) => state === "ready" && toolCount > 0,
  ).length;
  const empty = connections.filter(
    ({ state, toolCount }) => state === "ready" && toolCount === 0,
  ).length;
  const failed = connections.filter(({ state }) => state === "failed").length;
  const badge =
    failed > 0 ? (
      <Badge tone="amber">{failed} 项连接异常</Badge>
    ) : ready > 0 ? (
      <Badge tone={empty > 0 ? "amber" : "green"}>已连接 {ready} 项</Badge>
    ) : empty > 0 ? (
      <Badge tone="amber">无可用工具</Badge>
    ) : connections.length > 0 ? (
      <Badge>待检查</Badge>
    ) : (
      <Badge>{view !== undefined ? "未连接" : pending ? "读取中…" : "未能读取"}</Badge>
    );

  return (
    <ConnectionRow
      icon={
        <IconTile tone={failed > 0 ? "amber" : ready > 0 ? "green" : "gray"}>
          <MessageSquare size={14} />
        </IconTile>
      }
      name="企业微信"
      badge={badge}
      subtitle="用企业微信官方 MCP 工具处理文档、日程、待办等"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setHasInput(false);
      }}
    >
      <p className="text-ink-muted text-sm">
        Agent 只能使用你在企业微信授权的工具，不读取聊天记录。企业微信不能控制
        AgentHerd，写入操作须在飞书审批。
      </p>
      {connections.length > 0 && (
        <Group>
          {connections.map((connection) => (
            <Row
              key={connection.id}
              title={connection.name}
              description={
                connection.state === "ready" && connection.toolCount === 0
                  ? "请确认企业微信已授权所需能力，然后检查连接。"
                  : `${connection.toolCount} 个工具`
              }
              trailing={
                <>
                  {stateBadge(connection)}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`断开 ${connection.name}`}
                    disabled={pending}
                    onClick={() =>
                      void update(
                        "remove",
                        (host) => host.removeWecom(connection.id),
                        "无法断开企业微信连接，请重试。",
                      )
                    }
                  >
                    断开
                  </Button>
                </>
              }
            />
          ))}
        </Group>
      )}
      <form
        className="space-y-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.querySelector("input");
          if (pending || input === null || input.value.trim() === "") return;
          const config = input.value;
          input.value = "";
          setHasInput(false);
          void update(
            "add",
            (host) => host.configureWecom(config),
            "无法添加企业微信连接，请确认粘贴的是完整的官方 MCP JSON 或 URL。",
          );
        }}
      >
        <label htmlFor={inputId} className="text-ink-2 text-sm">
          企业微信 MCP 配置
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={inputId}
            className={`${inputClass} min-w-0 flex-1`}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder="粘贴完整的官方 JSON 或 URL"
            disabled={pending}
            onChange={(event) => setHasInput(event.currentTarget.value.trim() !== "")}
          />
          <Button variant="primary" type="submit" disabled={pending || !hasInput}>
            {pending && busy === "add" ? "添加中…" : "添加或更新"}
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            void update("check", (host) => host.checkWecom(), "无法检查企业微信连接，请重试。")
          }
        >
          <RefreshCw size={12} aria-hidden="true" />
          {pending && busy === "check" ? "检查中…" : "检查连接"}
        </Button>
        <a
          href={HELP_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent-text text-sm hover:underline"
        >
          企业微信官方接入指南 <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </ConnectionRow>
  );
}
