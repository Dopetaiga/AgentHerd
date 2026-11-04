// 重新连接: asks the host to connect the bound Feishu channel again.

import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { reconnect } from "../store";
import { Button } from "./ui";

export function ReconnectButton({ size = "md" }: { size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    await reconnect();
    setBusy(false);
  };
  return (
    <Button size={size} onClick={() => void run()} disabled={busy}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      {busy ? "正在连接…" : "重新连接"}
    </Button>
  );
}
