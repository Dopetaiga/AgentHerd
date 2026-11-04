// Starts the host in an Electron utility process unless one already answers on the socket
// (e.g. `agentherd start` in a terminal). Node in Electron strips TypeScript types, so the host
// runs from its sources like the CLI does.

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isHostRunning } from "@agentherd/host/server";
import { app, type UtilityProcess, utilityProcess } from "electron";

let child: UtilityProcess | undefined;

function hostEntry(): string {
  return (
    process.env.AGENTHERD_HOST_ENTRY ?? resolve(app.getAppPath(), "../../packages/host/bin/host.ts")
  );
}

export async function ensureHost(home: string, sock: string): Promise<void> {
  if (await isHostRunning(sock)) return;
  if (child === undefined) {
    const logDir = join(home, "logs");
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const logFile = join(logDir, "host.log");
    const p = utilityProcess.fork(hostEntry(), [], {
      serviceName: "AgentHerd host",
      stdio: "pipe",
      env: { ...process.env, AGENTHERD_HOME: home },
    });
    const log = (chunk: Buffer) => {
      process.stdout.write(chunk);
      appendFileSync(logFile, chunk);
    };
    p.stdout?.on("data", log);
    p.stderr?.on("data", log);
    p.on("exit", (code) => {
      console.error(`[desktop] host exited with code ${code}`);
      if (child === p) child = undefined;
    });
    child = p;
  }
  for (let i = 0; i < 100; i++) {
    if (await isHostRunning(sock)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("the host did not start within 15 s; see ~/.agentherd/logs/host.log");
}

export function stopOwnedHost(): void {
  child?.kill();
  child = undefined;
}
