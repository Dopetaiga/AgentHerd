// The system proxy for the programs AgentHerd runs for the owner (ADR 0050). A desktop app
// started from the Start menu or Dock gets no HTTPS_PROXY, while the owner's browser uses the
// system proxy; `gh` then cannot reach GitHub although the owner can. The proxy the system is
// set to is passed on as HTTPS_PROXY/HTTP_PROXY, unless the environment already has one.

import { execFileSync } from "node:child_process";

/** Runs a command and returns its output; throws when it fails. */
export type ProxyQuery = (command: string, args: string[]) => string;

const run: ProxyQuery = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });

const SETTINGS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

/** The proxy URL in `reg query <Internet Settings>` output, when it is on. */
export function windowsProxy(output: string): string | undefined {
  const value = (name: string): string | undefined =>
    new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, "mi").exec(output)?.[1];
  const enabled = value("ProxyEnable");
  if (enabled === undefined || Number.parseInt(enabled, 16) === 0) return undefined;
  const server = value("ProxyServer");
  if (server === undefined || server === "") return undefined;
  // "host:port", or per protocol: "http=host:port;https=host:port".
  const parts = server.split(";").map((p) => p.trim());
  const pick =
    parts.find((p) => p.startsWith("https="))?.slice(6) ??
    parts.find((p) => p.startsWith("http="))?.slice(5) ??
    parts.find((p) => !p.includes("="));
  if (pick === undefined || pick === "") return undefined;
  return /^\w+:\/\//.test(pick) ? pick : `http://${pick}`;
}

/** The HTTPS proxy in `scutil --proxy` output, when it is on. */
export function macProxy(output: string): string | undefined {
  const value = (name: string): string | undefined =>
    new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)`, "m").exec(output)?.[1];
  for (const kind of ["HTTPS", "HTTP"]) {
    if (value(`${kind}Enable`) !== "1") continue;
    const host = value(`${kind}Proxy`);
    const port = value(`${kind}Port`);
    if (host !== undefined) return `http://${host}${port === undefined ? "" : `:${port}`}`;
  }
  return undefined;
}

/** `env` with the system proxy added, when it has none of its own. */
export function withSystemProxy(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  query: ProxyQuery = run,
): NodeJS.ProcessEnv {
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) return env;
  let proxy: string | undefined;
  try {
    if (platform === "win32") proxy = windowsProxy(query("reg", ["query", SETTINGS]));
    else if (platform === "darwin") proxy = macProxy(query("scutil", ["--proxy"]));
  } catch {
    proxy = undefined;
  }
  if (proxy === undefined) return env;
  return { ...env, HTTPS_PROXY: proxy, HTTP_PROXY: proxy };
}
