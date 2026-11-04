#!/usr/bin/env node
// Usage: mock-agent --script <file.yaml>   (or MOCK_AGENT_SCRIPT=<file.yaml> mock-agent)
// stdout carries ACP; diagnostics go to stderr. An invalid script exits with code 2.

import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createMockAgent, parseScript, ScriptError } from "../src/index.ts";

function scriptPath(argv: string[]): string | undefined {
  const i = argv.indexOf("--script");
  if (i !== -1) return argv[i + 1];
  return process.env.MOCK_AGENT_SCRIPT;
}

function fail(message: string): never {
  process.stderr.write(`[mock-agent] ${message}\n`);
  process.exit(2);
}

const path = scriptPath(process.argv.slice(2));
if (path === undefined || path === "") fail("no script: pass --script <file> or MOCK_AGENT_SCRIPT");

let text: string;
try {
  text = readFileSync(path, "utf8");
} catch (error) {
  fail(`cannot read ${path}: ${(error as Error).message}`);
}

let script: ReturnType<typeof parseScript>;
try {
  script = parseScript(text);
} catch (error) {
  if (error instanceof ScriptError) fail(`${path}: ${error.message}`);
  throw error;
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
const connection = createMockAgent(script).connect(stream);
await connection.closed;
