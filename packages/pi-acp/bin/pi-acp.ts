#!/usr/bin/env node
// Usage: pi-acp --pi <path-to-pi> [-- <extra pi arguments>]
// An ACP agent on stdio that drives Pi in RPC mode (docs/adr/0022). Diagnostics go to stderr.

import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createPiBridge, piCommand } from "../src/index.ts";

const argv = process.argv.slice(2);
const dashes = argv.indexOf("--");
const own = dashes === -1 ? argv : argv.slice(0, dashes);
const piArgs = dashes === -1 ? [] : argv.slice(dashes + 1);
const i = own.indexOf("--pi");
const bin = i === -1 ? (process.env.AGENTHERD_PI ?? "pi") : own[i + 1];
if (bin === undefined || bin === "") {
  process.stderr.write("[pi-acp] usage: pi-acp --pi <path-to-pi> [-- <pi arguments>]\n");
  process.exit(2);
}

const bridge = createPiBridge({
  pi: piCommand(bin),
  piArgs,
  log: (line) => process.stderr.write(`[pi-acp] ${line}\n`),
});
const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
const connection = bridge.connect(stream);
const stop = async () => {
  await bridge.closeAll();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
await connection.closed;
await stop();
