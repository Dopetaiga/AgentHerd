import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseCommand } from "../src/commands.ts";

describe("parseCommand", () => {
  describe("status", () => {
    it("parses the exact status command", () => {
      expect(parseCommand("status")).toEqual({ kind: "status" });
    });

    it("is case-insensitive", () => {
      expect(parseCommand("STATUS")).toEqual({ kind: "status" });
      expect(parseCommand("Status")).toEqual({ kind: "status" });
    });

    it("trims surrounding whitespace before matching", () => {
      expect(parseCommand("  status  ")).toEqual({ kind: "status" });
      expect(parseCommand("\tstatus\t")).toEqual({ kind: "status" });
    });

    it("is not a prefix match", () => {
      expect(parseCommand("status report")).toEqual({ kind: "text", text: "status report" });
      expect(parseCommand("statuses")).toEqual({ kind: "text", text: "statuses" });
    });
  });

  describe("/help and /end", () => {
    it("parses /help", () => {
      expect(parseCommand("/help")).toEqual({ kind: "help" });
    });

    it("parses /help case-insensitively", () => {
      expect(parseCommand("/HELP")).toEqual({ kind: "help" });
    });

    it("parses /end", () => {
      expect(parseCommand("/end")).toEqual({ kind: "end" });
    });

    it("parses /end case-insensitively", () => {
      expect(parseCommand("/END")).toEqual({ kind: "end" });
    });

    it("treats a trailing argument as plain text, not the exact command", () => {
      expect(parseCommand("/help me")).toEqual({ kind: "text", text: "/help me" });
      expect(parseCommand("/end now")).toEqual({ kind: "text", text: "/end now" });
    });
  });

  describe("/run", () => {
    it("parses agent, dir and text", () => {
      expect(parseCommand("/run dsh /tmp/proj fix the tests")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "fix the tests",
      });
    });

    it("is case-insensitive for the command name", () => {
      expect(parseCommand("/RUN dsh /tmp/proj fix")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "fix",
      });
    });

    it("keeps inner spaces in the task text", () => {
      expect(parseCommand("/run dsh /tmp/proj fix  the   tests")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "fix  the   tests",
      });
    });

    it("keeps inner newlines in the task text", () => {
      expect(parseCommand("/run dsh /tmp/proj line one\nline two")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "line one\nline two",
      });
    });

    it("strips a single leading newline run after the dir", () => {
      expect(parseCommand("/run dsh /tmp/proj\nline one\nline two")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "line one\nline two",
      });
    });

    it("strips spaces, one newline run and trailing spaces after the dir", () => {
      expect(parseCommand("/run dsh /tmp/proj  \n\n  line one  ")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "line one",
      });
    });

    it("skips extra spaces between tokens", () => {
      expect(parseCommand("/run   dsh    /tmp/proj    fix")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "fix",
      });
    });

    it("accepts tabs as token separators", () => {
      expect(parseCommand("/run\tdsh\t/tmp/proj\tfix")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "fix",
      });
    });

    it("trims trailing whitespace from the task text", () => {
      expect(parseCommand("/run dsh /tmp/proj fix   \n")).toEqual({
        kind: "run",
        agent: "dsh",
        dir: "/tmp/proj",
        text: "fix",
      });
    });

    it("is invalid when agent, dir and text are all missing", () => {
      expect(parseCommand("/run")).toEqual({
        kind: "invalid",
        command: "run",
        usage: "/run <agent> <dir> <task>",
      });
    });

    it("is invalid when dir and text are missing", () => {
      expect(parseCommand("/run dsh")).toEqual({
        kind: "invalid",
        command: "run",
        usage: "/run <agent> <dir> <task>",
      });
    });

    it("is invalid when text is missing", () => {
      expect(parseCommand("/run dsh /tmp/proj")).toEqual({
        kind: "invalid",
        command: "run",
        usage: "/run <agent> <dir> <task>",
      });
    });

    it("is invalid when text is whitespace only", () => {
      expect(parseCommand("/run dsh /tmp/proj   ")).toEqual({
        kind: "invalid",
        command: "run",
        usage: "/run <agent> <dir> <task>",
      });
    });
  });

  describe("/relay, /interrupt and /herder", () => {
    it("parses /relay with a trimmed query", () => {
      expect(parseCommand("/relay fix the login")).toEqual({
        kind: "relay",
        query: "fix the login",
      });
    });

    it("trims the /relay query", () => {
      expect(parseCommand("/relay   fix the login   ")).toEqual({
        kind: "relay",
        query: "fix the login",
      });
    });

    it("is invalid when /relay has no query", () => {
      expect(parseCommand("/relay")).toEqual({
        kind: "invalid",
        command: "relay",
        usage: "/relay <task>",
      });
    });

    it("is invalid when /relay query is whitespace only", () => {
      expect(parseCommand("/relay   ")).toEqual({
        kind: "invalid",
        command: "relay",
        usage: "/relay <task>",
      });
    });

    it("parses /interrupt with text", () => {
      expect(parseCommand("/interrupt stop now")).toEqual({
        kind: "interrupt",
        text: "stop now",
      });
    });

    it("is invalid when /interrupt has no text", () => {
      expect(parseCommand("/interrupt")).toEqual({
        kind: "invalid",
        command: "interrupt",
        usage: "/interrupt <text>",
      });
    });

    it("parses /herder with text", () => {
      expect(parseCommand("/herder what is the plan")).toEqual({
        kind: "herder",
        text: "what is the plan",
      });
    });

    it("is invalid when /herder has no text", () => {
      expect(parseCommand("/herder")).toEqual({
        kind: "invalid",
        command: "herder",
        usage: "/herder <text>",
      });
    });

    it("is case-insensitive for relay, interrupt and herder", () => {
      expect(parseCommand("/RELAY fix")).toEqual({ kind: "relay", query: "fix" });
      expect(parseCommand("/INTERRUPT stop")).toEqual({ kind: "interrupt", text: "stop" });
      expect(parseCommand("/HERDER hello")).toEqual({ kind: "herder", text: "hello" });
    });
  });

  describe("plain text", () => {
    it("turns an unknown slash command into trimmed text", () => {
      expect(parseCommand("/frobnicate")).toEqual({ kind: "text", text: "/frobnicate" });
      expect(parseCommand("/frobnicate with args")).toEqual({
        kind: "text",
        text: "/frobnicate with args",
      });
    });

    it("keeps ordinary text unchanged, including leading/trailing whitespace", () => {
      expect(parseCommand("hello world")).toEqual({ kind: "text", text: "hello world" });
      expect(parseCommand("  hello world  ")).toEqual({ kind: "text", text: "  hello world  " });
    });

    it("keeps an empty string as empty text", () => {
      expect(parseCommand("")).toEqual({ kind: "text", text: "" });
    });
  });
});

describe("HELP_TEXT", () => {
  it("lists every command on its own line", () => {
    expect(HELP_TEXT).toBe(
      [
        "status — show the task board",
        "/run <agent> <dir> <task> — start a task",
        "/relay <task> — talk to a task directly",
        "/end — end the relay",
        "/interrupt <text> — stop the current turn and send text",
        "/herder <text> — talk to the Herder during a relay",
        "/help — this list",
      ].join("\n"),
    );
  });
});
