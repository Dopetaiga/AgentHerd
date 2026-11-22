// Whether a timer's reply should reach the owner at all (ADR 0102).
//
// The owner's words for a timer often say when to keep quiet (「没有就不用说」). Seen live: the
// prompt rule, the timer's words and the recalled preference all said so, and the Herder still
// answered 「今天没有新的……要的话我可以起个任务」. So code asks once more, apart from the turn:
// one small request with no tools that sees only the owner's words and the reply, and answers
// SEND or QUIET. Only a clear QUIET holds the reply back; anything else lets it through.

import type { StreamFn } from "@agentherd/herder-loop";
import { type Api, type Model, normalizeContext } from "@earendil-works/pi-ai";

/** The answer is one word. */
export const QUIET_CHECK_MAX_TOKENS = 8;
/** After this the reply is sent as it is. */
export const QUIET_CHECK_TIMEOUT_MS = 15_000;

/** Words in the owner's request that say when to keep quiet; without one there is nothing to check. */
const QUIET_WORDS =
  /不用说|别说|不必说|不用告诉|不要告诉|不用通知|不用打扰|别打扰|不用回|不用报|就算了|保持安静|安静|没有就不|没有的话就不|nothing new|stay quiet|keep quiet|don'?t tell|no need to tell|say nothing/i;

/** Whether the owner's words for a timer say when to stay quiet. */
export function asksForQuiet(words: string): boolean {
  return QUIET_WORDS.test(words);
}

const SYSTEM = `You check one message before it is sent to a person.
The person set a timer with their own instructions, including when they do not want to hear anything.
Their secretary ran it and wrote a reply. Decide whether, by the person's own rule, the reply should reach them.
QUIET when the reply only says there is nothing that meets what they asked for (nothing new, nothing suitable, nothing urgent), even if it adds details, offers or suggestions about the things that did not qualify.
SEND when the reply reports at least one thing that meets what they asked for, or something they must act on, or a failure they need to know about.
Answer with exactly one word: SEND or QUIET.`;

export interface QuietCheckRequest {
  streamFn: StreamFn;
  model: Model<Api>;
  apiKey?: string;
  /** The owner's words for the timer. */
  words: string;
  /** What the Herder would send. */
  reply: string;
  timeoutMs?: number;
}

/**
 * True when the reply should be held back. Never throws; a slow, failed or unclear answer sends the
 * reply, so the check can only keep the Herder quieter, never drop something it was sure of.
 */
export async function shouldStayQuiet(req: QuietCheckRequest): Promise<boolean> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), req.timeoutMs ?? QUIET_CHECK_TIMEOUT_MS);
  try {
    const context = normalizeContext({
      systemPrompt: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `The person's instructions for the timer:\n${req.words}\n\nThe reply:\n${req.reply}`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    });
    const stream = await req.streamFn(req.model, context, {
      ...(req.apiKey === undefined ? {} : { apiKey: req.apiKey }),
      maxTokens: QUIET_CHECK_MAX_TOKENS,
      toolChoice: "none",
      signal: timeout.signal,
    });
    const gaveUp = new Promise<never>((_, reject) => {
      timeout.signal.addEventListener("abort", () => reject(new Error("check given up")), {
        once: true,
      });
    });
    const message = await Promise.race([stream.result(), gaveUp]);
    if (message.stopReason === "error" || message.stopReason === "aborted") return false;
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("")
      .trim()
      .toUpperCase();
    return /^QUIET\b/.test(text);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
