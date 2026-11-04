// A Pi process in RPC mode (Pi docs/rpc.md): JSONL commands on stdin, responses and events on
// stdout. Records are split on LF only; Node's readline would also split on U+2028/U+2029,
// which are valid inside JSON strings.

import { type ChildProcess, spawn } from "node:child_process";

export type PiRecord = { type: string } & Record<string, unknown>;

export interface PiResponse extends PiRecord {
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PiExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface PiRpcOptions {
  /** Pi's command line, without the RPC flags. */
  command: readonly string[];
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Receives Pi's stderr. */
  stderr?: (chunk: string) => void;
}

/** Wait this long after closing stdin before sending SIGTERM. */
const CLOSE_GRACE_MS = 3000;

/** Splits a byte stream into LF-terminated records. */
export class LineSplitter {
  private chunks: Buffer[] = [];
  push(chunk: Buffer, onLine: (line: string) => void): void {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 0x0a) continue;
      this.chunks.push(chunk.subarray(start, i));
      let line = Buffer.concat(this.chunks).toString("utf8");
      this.chunks = [];
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line !== "") onLine(line);
      start = i + 1;
    }
    if (start < chunk.length) this.chunks.push(chunk.subarray(start));
  }
}

export class PiRpc {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, (r: PiResponse) => void>();
  private readonly listeners = new Set<(r: PiRecord) => void>();
  private nextId = 1;
  private exitInfo: PiExit | undefined;
  readonly exited: Promise<PiExit>;

  constructor(opts: PiRpcOptions) {
    const [command, ...rest] = opts.command;
    if (command === undefined) throw new Error("empty Pi command");
    this.child = spawn(command, [...rest, ...opts.args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const splitter = new LineSplitter();
    this.child.stdout?.on("data", (chunk: Buffer) => splitter.push(chunk, (l) => this.onLine(l)));
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => opts.stderr?.(chunk));
    this.child.stdin?.on("error", () => {});
    this.exited = new Promise((resolve) => {
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.exitInfo !== undefined) return;
        this.exitInfo = { code, signal };
        const failed: PiResponse = {
          type: "response",
          command: "",
          success: false,
          error: `Pi exited (code ${code}, signal ${signal})`,
        };
        for (const settle of this.pending.values()) settle(failed);
        this.pending.clear();
        resolve(this.exitInfo);
      };
      this.child.on("exit", finish);
      this.child.on("error", (error) => {
        opts.stderr?.(`could not start Pi: ${error.message}\n`);
        finish(null, null);
      });
    });
  }

  get running(): boolean {
    return this.exitInfo === undefined;
  }

  onRecord(listener: (r: PiRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends a record that has no response, such as `extension_ui_response`. */
  send(record: PiRecord): void {
    if (!this.running) return;
    this.child.stdin?.write(`${JSON.stringify(record)}\n`);
  }

  /** Sends a command and waits for its response. A dead process gives a failed response. */
  request(command: PiRecord): Promise<PiResponse> {
    const id = `ah-${this.nextId++}`;
    return new Promise((resolve) => {
      if (!this.running) {
        resolve({
          type: "response",
          command: command.type,
          success: false,
          error: "Pi is not running",
        });
        return;
      }
      this.pending.set(id, resolve);
      this.send({ ...command, id });
    });
  }

  /** Closes stdin (Pi's orderly shutdown), then SIGTERM if Pi does not exit. */
  async close(): Promise<void> {
    if (!this.running) return;
    this.child.stdin?.end();
    const timer = setTimeout(() => this.child.kill("SIGTERM"), CLOSE_GRACE_MS);
    await this.exited;
    clearTimeout(timer);
  }

  private onLine(line: string): void {
    let record: PiRecord;
    try {
      record = JSON.parse(line) as PiRecord;
    } catch {
      return;
    }
    if (typeof record !== "object" || record === null || typeof record.type !== "string") return;
    if (record.type === "response" && typeof record.id === "string") {
      const settle = this.pending.get(record.id);
      if (settle !== undefined) {
        this.pending.delete(record.id);
        settle(record as PiResponse);
        return;
      }
    }
    for (const listener of this.listeners) listener(record);
  }
}
