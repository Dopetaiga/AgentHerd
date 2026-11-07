#!/usr/bin/env node
// The AgentHerd host process: `node packages/host/bin/host.ts`. The desktop app starts the same
// thing in an Electron utility process.

import { agentherdHome, runHost } from "../src/index.ts";

/** The message port of an Electron utility process; absent under plain Node. */
interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
}

const running = await runHost({ home: agentherdHome() });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void running.stop().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// The desktop app asks by message: on Windows a killed process gets no signal, it just dies.
const parentPort = (process as { parentPort?: ParentPort }).parentPort;
parentPort?.on("message", (message) => {
  const data = message.data as { type?: unknown } | null;
  if (data?.type === "stop") stop();
});
