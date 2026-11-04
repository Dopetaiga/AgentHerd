/** Full-string match where `*` matches any characters (including none). No other syntax. */
export function globMatch(pattern: string, text: string): boolean {
  const parts = pattern.split("*");
  const first = parts[0] as string;
  if (parts.length === 1) return pattern === text;
  if (!text.startsWith(first)) return false;
  const last = parts[parts.length - 1] as string;
  if (text.length - first.length < last.length || !text.endsWith(last)) return false;
  let pos = first.length;
  const end = text.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    const found = text.indexOf(part, pos);
    if (found === -1 || found + part.length > end) return false;
    pos = found + part.length;
  }
  return true;
}
