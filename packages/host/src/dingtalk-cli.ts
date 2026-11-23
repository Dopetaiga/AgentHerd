import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export type DingTalkIdentity = Readonly<{
  corpId: string;
  userId: string;
  corpName?: string;
  userName?: string;
}>;
export type DingTalkCommand = Readonly<{ args: readonly string[]; stdin?: string }>;

export interface DingTalkCliPort {
  status(signal: AbortSignal): Promise<DingTalkIdentity | undefined>;
  login(signal: AbortSignal): Promise<void>;
  reset(signal: AbortSignal): Promise<void>;
  run(identity: DingTalkIdentity, command: DingTalkCommand, signal: AbortSignal): Promise<unknown>;
}

interface Options {
  executable: string;
  stateDir: string;
}

const MAX_OUTPUT = 2 * 1024 * 1024;
const PLATFORM_ENV = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "SYSTEMDRIVE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
]);

const messages = {
  unavailable: "钉钉组件不可用。",
  failed: "钉钉操作失败；请检查组织是否允许 CLI 及对应业务权限。若是写操作，请先确认结果再重试。",
  cancelled: "钉钉操作已取消或超时；若是写操作，请先确认结果再重试。",
  output_limit: "钉钉返回的数据过大，请缩小查询范围。",
  invalid_response: "无法验证钉钉返回的结果。",
};

class DingTalkCliError extends Error {
  readonly code: keyof typeof messages;

  constructor(code: keyof typeof messages) {
    super(messages[code]);
    this.code = code;
  }
}

export async function runDws(
  { executable, stateDir }: Options,
  command: DingTalkCommand,
  signal: AbortSignal,
  json: boolean,
): Promise<unknown> {
  if (!isAbsolute(executable) || !isAbsolute(stateDir)) throw new DingTalkCliError("unavailable");
  if (signal.aborted) throw new DingTalkCliError("cancelled");
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
  } catch {
    throw new DingTalkCliError("unavailable");
  }
  if (signal.aborted) throw new DingTalkCliError("cancelled");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => PLATFORM_ENV.has(key.toUpperCase())),
  );
  env.DWS_CONFIG_DIR = join(stateDir, "config");
  env.DWS_KEYCHAIN_DIR = join(stateDir, "credentials");

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...command.args], {
      cwd: stateDir,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", json ? "pipe" : "ignore", "ignore"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let error: DingTalkCliError | undefined;
    const fail = (code: keyof typeof messages) => {
      if (error !== undefined) return;
      error = new DingTalkCliError(code);
      child.kill();
    };
    const abort = () => fail("cancelled");
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", () => fail("unavailable"));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (error !== undefined) return;
      size += chunk.length;
      if (size > MAX_OUTPUT) fail("output_limit");
      else chunks.push(chunk);
    });
    child.stdout?.on("error", () => fail("failed"));
    child.stdin?.on("error", () => fail("failed"));
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (error !== undefined || code !== 0) {
        reject(error ?? new DingTalkCliError("failed"));
      } else if (!json) {
        resolve(undefined);
      } else {
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
          resolve(JSON.parse(decoded));
        } catch {
          reject(new DingTalkCliError("invalid_response"));
        }
      }
    });
    if (signal.aborted) abort();
    child.stdin?.end(command.stdin);
  });
}

const profileId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_@.+/=-]{1,128}$/.test(value);

function label(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = value
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, 100);
  return safe === "" ? undefined : safe;
}

function identityFromStatus(value: unknown): DingTalkIdentity | undefined {
  if (typeof value === "object" && value !== null && "success" in value && value.success === true) {
    const { authenticated, reason, corp_id, user_id, corp_name, user_name } = value as Record<
      string,
      unknown
    >;
    if (authenticated === false && reason === undefined) return undefined;
    if (authenticated === true && profileId(corp_id) && profileId(user_id)) {
      const corpName = label(corp_name);
      const userName = label(user_name);
      return Object.freeze({
        corpId: corp_id,
        userId: user_id,
        ...(corpName === undefined ? {} : { corpName }),
        ...(userName === undefined ? {} : { userName }),
      });
    }
  }
  throw new DingTalkCliError("invalid_response");
}

export function dingtalkCli(options: Options): DingTalkCliPort {
  const execute = (command: DingTalkCommand, signal: AbortSignal, json: boolean, ms = 30_000) =>
    runDws(options, command, AbortSignal.any([signal, AbortSignal.timeout(ms)]), json);
  return {
    status: async (signal) =>
      identityFromStatus(
        await execute({ args: ["auth", "status", "--readonly", "--format=json"] }, signal, true),
      ),
    login: async (signal) => {
      await execute({ args: ["auth", "login", "--format=json"] }, signal, false, 300_000);
    },
    reset: async (signal) => {
      await execute({ args: ["auth", "reset"] }, signal, false);
    },
    run: (identity, command, signal) => {
      if (!profileId(identity.corpId) || !profileId(identity.userId)) {
        throw new DingTalkCliError("invalid_response");
      }
      const profile = `${identity.corpId}:${identity.userId}`;
      return execute(
        { ...command, args: [...command.args, `--profile=${profile}`, "--format=json"] },
        signal,
        true,
      );
    },
  };
}
