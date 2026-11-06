// What to do when a Herder turn fails (docs/spec/08-herder-interaction.md §5, ADR 0037).

/** `fatal`: retrying cannot help (key, balance, bad request); `transient`: try again. */
export type ErrorKind = "fatal" | "transient";

const FATAL =
  /\b(401|402|403|400)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|incorrect api key|authentication|insufficient[ _-]?(balance|quota|funds)|余额不足|quota exceeded|billing|bad request|invalid[ _-]?request|context length|maximum context/i;

export function errorKind(message: string): ErrorKind {
  return FATAL.test(message) ? "fatal" : "transient";
}

/** Waits before each retry of the same model: 2 s, 10 s, 30 s. */
export const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

/** How often a message held because every model failed is tried again. */
export const HELD_RETRY_MS = 60_000;
