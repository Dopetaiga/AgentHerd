// 设置 › 飞书: the binding and the connection, 重新绑定 in a dialog, and 重新连接 after an error.

import { MessageSquare, QrCode, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useApp } from "../store";
import { FeishuSetup } from "./FeishuSetup";
import { canReconnect, channelErrorLabel } from "./labels";
import { Modal } from "./Modal";
import { ReconnectButton } from "./ReconnectButton";
import { Badge, Button, Group, IconTile, Row, Section } from "./ui";

export function FeishuSection() {
  const channel = useApp((s) => s.status?.channel);
  const [binding, setBinding] = useState(false);
  if (channel === undefined) return null;
  const error = channel.error !== undefined && channel.error !== "" ? channel.error : undefined;
  return (
    <Section title="飞书">
      <Group>
        <Row
          icon={
            <IconTile tone={channel.bound ? "blue" : "gray"}>
              <MessageSquare size={15} strokeWidth={1.75} />
            </IconTile>
          }
          title={channel.bound ? "已绑定" : "未绑定"}
          description={
            channel.bound
              ? channel.appId !== undefined
                ? `应用 ${channel.appId}`
                : "飞书机器人已就绪"
              : "用飞书扫一次码，任务进度和审批请求会发到飞书"
          }
          trailing={
            <Button
              variant={channel.bound ? "secondary" : "primary"}
              onClick={() => setBinding(true)}
            >
              <QrCode size={13} />
              {channel.bound ? "重新绑定" : "扫码绑定"}
            </Button>
          }
        />
        {channel.bound && (
          <Row
            icon={
              <IconTile tone={channel.connected ? "green" : error !== undefined ? "red" : "amber"}>
                {error !== undefined ? (
                  <TriangleAlert size={15} strokeWidth={1.75} />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-current" />
                )}
              </IconTile>
            }
            title="连接"
            description={
              error !== undefined ? (
                <span className="selectable text-danger-text">{channelErrorLabel(error)}</span>
              ) : channel.connected ? (
                "正在接收飞书消息"
              ) : (
                "正在连接…"
              )
            }
            trailing={
              canReconnect(channel) ? (
                <ReconnectButton />
              ) : (
                <Badge tone={channel.connected ? "green" : "amber"}>
                  {channel.connected ? "已连接" : "未连接"}
                </Badge>
              )
            }
          />
        )}
      </Group>
      {binding && (
        <Modal
          title={channel.bound ? "重新绑定飞书" : "绑定飞书"}
          description="用飞书扫码，AgentHerd 会建一个新的机器人并换用它。"
          onClose={() => setBinding(false)}
        >
          <FeishuSetup autoStart />
        </Modal>
      )}
    </Section>
  );
}
