// Runs one host with the real Feishu channel and secrets.json, serving the local API.

import { FeishuChannel } from "@agentherd/channel-feishu";
import { feishuSecrets, secretFile } from "./config.ts";
import { Host } from "./host.ts";
import { searchPath } from "./profiles.ts";
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
  // An app opened from Finder gets a short PATH; find dsh/pi and let agents find `node` like a
  // terminal would.
  process.env.PATH = searchPath(process.env);
  const host = new Host({
    home: opts.home,
    secrets: secretFile(opts.home),
    createChannel: (locale) =>
      new FeishuChannel({
        locale,
        ...feishuSecrets(opts.home),
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
