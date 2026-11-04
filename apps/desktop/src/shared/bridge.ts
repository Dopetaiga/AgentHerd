// The only thing the renderer can reach: `window.agentherd`, set by the preload script.
// The renderer has no Node access; every call goes main → host over the local API socket.

import type { HostEvent, RemoteHost } from "@agentherd/host/api";

export interface Bridge {
  host: RemoteHost;
  /** Host events (status, tasks, models, setup). Returns an unsubscribe function. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** Whether main is connected to the host process. */
  onConnection(listener: (connected: boolean) => void): () => void;
}

declare global {
  interface Window {
    agentherd: Bridge;
  }
}
