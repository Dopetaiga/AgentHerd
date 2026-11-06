import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCardAction, parseFeishuMessage, parseMessage } from "../src/inbound.ts";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("parseCardAction", () => {
  it("parses a nested card.action.trigger event", () => {
    expect(parseCardAction(loadFixture("card-action.json"))).toEqual({
      kind: "action",
      target: "item-1",
      action: "allow",
      from: "ou_owner000",
    });
  });

  it("parses a flattened card.action.trigger event", () => {
    expect(parseCardAction(loadFixture("card-action-flat.json"))).toEqual({
      kind: "action",
      target: "item-2",
      action: "deny",
      from: "ou_owner000",
    });
  });

  it("parses a value delivered as a JSON string", () => {
    expect(parseCardAction(loadFixture("card-action-string-value.json"))).toEqual({
      kind: "action",
      target: "item-3",
      action: "escalate",
      from: "ou_owner000",
    });
  });

  it("parses a relay action", () => {
    const payload = {
      event: {
        operator: { open_id: "ou_owner000" },
        action: { value: { target: "r1", action: "relay" } },
      },
    };
    expect(parseCardAction(payload)).toEqual({
      kind: "action",
      target: "r1",
      action: "relay",
      from: "ou_owner000",
    });
  });

  it("parses an end-relay action", () => {
    const payload = {
      event: {
        operator: { open_id: "ou_owner000" },
        action: { value: { target: "t1", action: "end-relay" } },
      },
    };
    expect(parseCardAction(payload)).toEqual({
      kind: "action",
      target: "t1",
      action: "end-relay",
      from: "ou_owner000",
    });
  });

  it("returns null for a value that is not valid JSON", () => {
    const payload = {
      event: {
        operator: { open_id: "ou_owner000" },
        action: { value: "{not json" },
      },
    };
    expect(parseCardAction(payload)).toBeNull();
  });

  it("returns null when open_id is missing", () => {
    const payload = {
      event: {
        operator: {},
        action: { value: { target: "item-1", action: "allow" } },
      },
    };
    expect(parseCardAction(payload)).toBeNull();
  });

  it("returns null when target or action is empty", () => {
    const payload = {
      event: {
        operator: { open_id: "ou_owner000" },
        action: { value: { target: "", action: "allow" } },
      },
    };
    expect(parseCardAction(payload)).toBeNull();
  });
});

describe("parseMessage", () => {
  it("parses a p2p text message", () => {
    expect(parseMessage(loadFixture("message-text.json"))).toEqual({
      kind: "message",
      text: "hello herder",
      from: "ou_owner000",
    });
  });

  it("parses a reply with its parent message id", () => {
    expect(parseMessage(loadFixture("message-reply.json"))).toEqual({
      kind: "message",
      text: "allow it",
      from: "ou_owner000",
      replyTo: { channelId: "feishu", id: "om_parent000" },
    });
  });

  it("returns null for an image message, which has no text", () => {
    expect(parseMessage(loadFixture("message-image.json"))).toBeNull();
  });
});

function p2p(type: string, content: unknown) {
  return {
    sender: { sender_id: { open_id: "ou_owner000" }, sender_type: "user" },
    message: {
      message_id: "om_1",
      chat_type: "p2p",
      message_type: type,
      content: JSON.stringify(content),
    },
  };
}

describe("parseFeishuMessage", () => {
  it("keeps the image key of an image message", () => {
    expect(parseFeishuMessage(loadFixture("message-image.json"))).toEqual({
      messageId: "om_msg002",
      text: "",
      from: "ou_owner000",
      imageKeys: ["img_000"],
    });
  });

  it("reads the text and images of a rich-text post", () => {
    const post = {
      title: "Bug",
      content: [
        [
          { tag: "text", text: "the page " },
          { tag: "a", text: "here", href: "https://example.com" },
          { tag: "text", text: " breaks" },
        ],
        [{ tag: "img", image_key: "img_1" }],
        [
          { tag: "at", user_name: "Ann" },
          { tag: "text", text: " look" },
        ],
      ],
    };
    expect(parseFeishuMessage(p2p("post", post))).toEqual({
      messageId: "om_1",
      text: "Bug\nthe page here (https://example.com) breaks\n@Ann look",
      from: "ou_owner000",
      imageKeys: ["img_1"],
    });
  });

  it("reads a post wrapped in a language key", () => {
    const post = { zh_cn: { title: "", content: [[{ tag: "text", text: "你好" }]] } };
    expect(parseFeishuMessage(p2p("post", post))?.text).toBe("你好");
  });

  it("returns null for message types it does not read", () => {
    expect(parseFeishuMessage(p2p("file", { file_key: "f" }))).toBeNull();
    expect(parseFeishuMessage(p2p("post", { title: "", content: [] }))).toBeNull();
  });

  it("returns null for a group chat message", () => {
    expect(parseMessage(loadFixture("message-group.json"))).toBeNull();
  });

  it("parses a flattened message payload", () => {
    const payload = {
      sender: { sender_id: { open_id: "ou_owner000" }, sender_type: "user" },
      message: {
        message_id: "om_msg004",
        chat_type: "p2p",
        message_type: "text",
        content: '{"text":"hi"}',
      },
    };
    expect(parseMessage(payload)).toEqual({ kind: "message", text: "hi", from: "ou_owner000" });
  });

  it("trims the message text", () => {
    const payload = {
      event: {
        sender: { sender_id: { open_id: "ou_owner000" }, sender_type: "user" },
        message: {
          message_id: "om_msg005",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"  spaced  "}',
        },
      },
    };
    expect(parseMessage(payload)).toEqual({
      kind: "message",
      text: "spaced",
      from: "ou_owner000",
    });
  });

  it("returns null for a non-user sender", () => {
    const payload = {
      event: {
        sender: { sender_id: { open_id: "ou_bot000" }, sender_type: "bot" },
        message: {
          message_id: "om_msg006",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hi"}',
        },
      },
    };
    expect(parseMessage(payload)).toBeNull();
  });

  it("returns null for bad JSON content", () => {
    const payload = {
      event: {
        sender: { sender_id: { open_id: "ou_owner000" }, sender_type: "user" },
        message: {
          message_id: "om_msg007",
          chat_type: "p2p",
          message_type: "text",
          content: "not json",
        },
      },
    };
    expect(parseMessage(payload)).toBeNull();
  });

  it("returns null for empty text", () => {
    const payload = {
      event: {
        sender: { sender_id: { open_id: "ou_owner000" }, sender_type: "user" },
        message: {
          message_id: "om_msg008",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"   "}',
        },
      },
    };
    expect(parseMessage(payload)).toBeNull();
  });

  it("returns null when open_id is missing", () => {
    const payload = {
      event: {
        sender: { sender_id: {}, sender_type: "user" },
        message: {
          message_id: "om_msg009",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hi"}',
        },
      },
    };
    expect(parseMessage(payload)).toBeNull();
  });
});

describe("garbage inputs", () => {
  it.each([null, 42, "nope", [], {}])("returns null for %p", (input) => {
    expect(parseCardAction(input)).toBeNull();
    expect(parseMessage(input)).toBeNull();
  });
});
