// Runs one host with the real Feishu channel and the macOS keychain, serving the local API.

import { FeishuChannel } from "@agentherd/channel-feishu";
import { getSecret, keychain, saveSecret } from "./config.ts";
import { Host } from "./host.ts";
import { type ApiServer, serveApi, socketPath } from "./server.ts";

export interface RunHostOptions {
  home: string;
  script?: string;
  log?: (line: string) => void;
}

export interface RunningHost {
  host: Host;
  server: ApiServer;
  stop(): Promise<void>;
}

export async function runHost(opts: RunHostOptions): Promise<RunningHost> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const host = new Host({
    home: opts.home,
    secrets: keychain,
    createChannel: (locale) =>
      new FeishuChannel({
        locale,
        getSecret,
        saveSecret,
        onError: (error) => log(`[feishu] ${error.message}`),
      }),
    ...(opts.script === undefined ? {} : { script: opts.script }),
    log,
  });
  const server = await serveApi(host, socketPath(opts.home));
  log(`[host] API on ${server.path}`);
  await host.start();
  return {
    host,
    server,
    async stop() {
      await server.close();
      await host.stop();
    },
  };
}
