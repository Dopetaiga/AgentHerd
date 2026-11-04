// `agentherd` CLI: a development tool until the desktop app exists (plans/004).

import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FeishuChannel } from "@agentherd/channel-feishu";
import { Herd, Store } from "@agentherd/core";
import type { AgentProfile, Mode } from "@agentherd/protocol";
import QRCode from "qrcode";
import {
  agentherdHome,
  getSecret,
  mockProfile,
  readConfig,
  saveSecret,
  writeConfig,
} from "./config.ts";

export const USAGE = `Usage: agentherd <command>

Commands:
  setup feishu                 Create a Feishu bot with one QR scan and bind it to you
  run [options] <dir> <prompt> Run one task with an agent; approvals go to Feishu
      --profile <id>           Agent profile (default: mock)
      --script <yaml>          Script for the mock profile
      --mode <observe|assist>  Mode (default: from config, else assist)
  status                       Show recent sessions, open items and decisions

Environment:
  AGENTHERD_HOME               Default: ~/.agentherd
`;

type Out = (line: string) => void;

export async function main(argv: string[], out: Out = console.log): Promise<number> {
  const [command, ...rest] = argv;
  const home = agentherdHome();
  switch (command) {
    case "setup":
      if (rest[0] !== "feishu") {
        out(USAGE);
        return 2;
      }
      return setupFeishu(home, out);
    case "run":
      return run(home, rest, out);
    case "status":
      return status(home, out);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      out(USAGE);
      return command === undefined ? 2 : 0;
    default:
      out(`unknown command "${command}"\n`);
      out(USAGE);
      return 2;
  }
}

function feishuChannel(): FeishuChannel {
  return new FeishuChannel({
    getSecret,
    saveSecret,
    onError: (error) => console.error(`[feishu] ${error.message}`),
  });
}

async function setupFeishu(home: string, out: Out): Promise<number> {
  const runDir = join(home, "run");
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const qrPng = join(runDir, "qr.png");
  const binding = await feishuChannel().setup({
    showQrCode(url, expiresInSeconds) {
      void QRCode.toString(url, { type: "terminal", small: true }).then((qr) => {
        out(qr);
        out(
          `Scan with Feishu, or open in Feishu (valid ${Math.round(expiresInSeconds / 60)} min):`,
        );
        out(url);
        out(`QR image: ${qrPng}`);
      });
      void QRCode.toFile(qrPng, url, { width: 360 });
    },
    showStatus(state) {
      out(`[setup] ${state}`);
    },
  });
  const config = readConfig(home);
  writeConfig(home, { ...config, channel: binding });
  out(`Bound to Feishu app ${binding.data.appId}. The App Secret is in the keychain.`);
  return 0;
}

function profileFor(id: string, script: string | undefined, extra: AgentProfile[]): AgentProfile {
  if (id === "mock") {
    if (script === undefined) throw new Error("--script is required with the mock profile");
    return mockProfile(resolve(script));
  }
  const found = extra.find((p) => p.id === id);
  if (found === undefined) throw new Error(`unknown profile "${id}"`);
  return found;
}

async function run(home: string, args: string[], out: Out): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      profile: { type: "string", default: "mock" },
      script: { type: "string" },
      mode: { type: "string" },
    },
  });
  const [dirArg, ...promptWords] = positionals;
  if (dirArg === undefined || promptWords.length === 0) {
    out(USAGE);
    return 2;
  }
  const config = readConfig(home);
  if (config.channel === undefined) {
    out('No channel. Run "agentherd setup feishu" first.');
    return 1;
  }
  const mode = (values.mode ?? config.mode ?? "assist") as Mode;
  if (mode !== "observe" && mode !== "assist") {
    out(`--mode must be observe or assist in M1, not "${mode}"`);
    return 2;
  }
  const dir = resolve(dirArg);
  mkdirSync(dir, { recursive: true });
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  const profile = profileFor(values.profile, values.script, config.profiles ?? []);

  const herd = new Herd({
    home,
    userHome: homedir(),
    channel: feishuChannel(),
    binding: config.channel,
    mode,
    profiles: [profile],
  });
  herd.registry.onChange((row, previous) => out(`[session] ${previous ?? "new"} → ${row.state}`));
  const stop = () => {
    void herd.stop().then(() => process.exit(130));
  };
  process.once("SIGINT", stop);
  try {
    await herd.start();
    out(`[herd] connected to Feishu; running ${profile.id} in ${dir}`);
    const result = await herd.run(profile.id, dir, promptWords.join(" "));
    out(`[turn] ${result.stopReason}`);
    return 0;
  } finally {
    process.off("SIGINT", stop);
    await herd.stop();
  }
}

function status(home: string, out: Out): number {
  const store = Store.open(join(home, "herd.db"));
  try {
    out("Sessions:");
    for (const s of store.recentSessions(10))
      out(`  ${s.updatedAt}  ${s.state.padEnd(16)} ${s.profileId}  ${s.cwd}`);
    out("Open items:");
    for (const i of store.openItems()) out(`  ${i.createdAt}  ${i.risk.padEnd(6)} ${i.title}`);
    out("Decisions:");
    for (const d of store.recentDecisions(10))
      out(`  ${d.createdAt}  ${d.source.padEnd(8)} ${d.action.padEnd(8)} ${d.reason}`);
    return 0;
  } finally {
    store.close();
  }
}
