// How long a message to the owner may be (docs/spec/04-herder.md "Message length", ADR 0049).
// Every message costs the owner attention, so one is a few sentences: at most 100 words, counted
// the way dsh-superagent counts them (Chinese is split into words, links count).

/** Words in one message to the owner. */
export const OWNER_WORDS_MAX = 100;

/** Words in an acknowledgement: one line. */
export const ACK_WORDS_MAX = 30;

/**
 * Characters allowed per allowed word. Keeps text without word breaks (a hash, a pasted blob)
 * short too; ordinary text never reaches it.
 */
const CHARS_PER_WORD = 8;

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/** Words in `text`: Chinese split into words, English by spaces and punctuation. */
export function ownerWords(text: string): number {
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike === true) n++;
  return n;
}

/** Whether `text` fits in `max` words. */
export function fitsOwner(text: string, max: number = OWNER_WORDS_MAX): boolean {
  return text.length <= max * CHARS_PER_WORD && ownerWords(text) <= max;
}

/** `text` cut after `max` words, with "…" when something was cut. */
export function cutWords(text: string, max: number = OWNER_WORDS_MAX): string {
  let n = 0;
  let end = Math.min(text.length, max * CHARS_PER_WORD);
  for (const s of segmenter.segment(text)) {
    if (s.index >= end) break;
    if (s.isWordLike !== true) continue;
    n++;
    if (n > max) {
      end = s.index;
      break;
    }
  }
  return end >= text.length ? text : `${text.slice(0, end).trimEnd()}…`;
}

/** Why `text` is refused as a message to the owner, or undefined when it fits. */
export function tooLong(text: string, max: number = OWNER_WORDS_MAX): string | undefined {
  if (fitsOwner(text, max)) return undefined;
  const words = ownerWords(text);
  const size = words > max ? `${words} words` : `${text.length} characters`;
  return `too long: ${size}, at most ${max} words. Write it again shorter: the result and what the owner has to do, not the steps; one message, no list`;
}
