#!/usr/bin/env node
// The AgentHerd host process: `node packages/host/bin/host.ts`. The desktop app starts the same
// thing in an Electron utility process.

import { agentherdHome, runHost } from "../src/index.ts";

const running = await runHost({ home: agentherdHome() });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void running.stop().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
