const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ENV_WORD = /^env\s+/;
const CD_PREFIX = /^cd\s+\S+\s*&&\s*/;

function matchEnvAssignmentLength(input: string): number {
  const nameText = ENV_NAME.exec(input)?.[0];
  if (!nameText) {
    return 0;
  }
  const rest = input.slice(nameText.length);

  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    return close < 0 ? 0 : nameText.length + close + 1;
  }
  if (rest.startsWith("'")) {
    const close = rest.indexOf("'", 1);
    return close < 0 ? 0 : nameText.length + close + 1;
  }

  const value = /^\S*/.exec(rest)?.[0] ?? "";
  return nameText.length + value.length;
}

export function normalizeCommand(cmd: string): string {
  let output = cmd.replace(/\s+/g, " ").trim();
  let changed = true;

  while (changed) {
    changed = false;
    output = output.trim();
    if (output === "") {
      break;
    }

    const cdText = CD_PREFIX.exec(output)?.[0];
    if (cdText) {
      output = output.slice(cdText.length);
      changed = true;
      continue;
    }

    const envWordText = ENV_WORD.exec(output)?.[0];
    if (envWordText && ENV_NAME.test(output.slice(envWordText.length))) {
      output = output.slice(envWordText.length);
      changed = true;
      continue;
    }

    const assignmentLength = matchEnvAssignmentLength(output);
    if (assignmentLength > 0) {
      output = output.slice(assignmentLength);
      changed = true;
    }
  }

  return output.trim();
}

export function commandHead(cmd: string): string {
  return normalizeCommand(cmd).split(/\s+/).slice(0, 2).join(" ");
}
