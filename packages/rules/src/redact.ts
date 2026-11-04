// Redaction before anything is stored or logged. docs/spec/06-security.md §2.

const REDACTED = "«redacted»";

const PEM_BLOCK =
  /-----BEGIN [A-Za-z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Za-z0-9 ]*PRIVATE KEY-----/g;

const BEARER = /Bearer\s+\S+/g;

const TOKEN_PATTERNS =
  /(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g;

const SHELL_ASSIGN = /([A-Za-z_][A-Za-z0-9_]*)=((?:"[^"]*"|'[^']*'|[^\s]+))/g;
const JSON_ASSIGN = /"([^"]*)":\s*("(?:[^"\\]|\\.)*")/g;

const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD)/i;

function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

function redactEnvValues(text: string, env?: Record<string, string>): string {
  if (!env) {
    return text;
  }
  let output = text;
  // Longest first, so a value that contains another is replaced whole.
  const entries = Object.entries(env).sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of entries) {
    if (!isSecretName(name)) {
      continue;
    }
    if (value.length < 4 || !output.includes(value)) {
      continue;
    }
    output = output.split(value).join(REDACTED);
  }
  return output;
}

export function redact(text: string, env?: Record<string, string>): string {
  // Literal env values first: the patterns below could otherwise cut a value in two.
  let output = redactEnvValues(text, env);
  output = output.replace(PEM_BLOCK, () => REDACTED);
  output = output.replace(BEARER, () => `Bearer ${REDACTED}`);
  output = output.replace(TOKEN_PATTERNS, () => REDACTED);
  output = output.replace(SHELL_ASSIGN, (match: string, name: string) =>
    isSecretName(name) ? `${name}=${REDACTED}` : match,
  );
  output = output.replace(JSON_ASSIGN, (match: string, name: string) =>
    isSecretName(name) ? `"${name}": ${REDACTED}` : match,
  );
  return output;
}
