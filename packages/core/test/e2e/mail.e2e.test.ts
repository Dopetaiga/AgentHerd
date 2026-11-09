// E2E for mail watches (docs/spec/04-herder.md "Mail", ADR 0048): nothing is polled until the
// owner asks; new matching mail is told once; mail from before the watch is not news; a removed
// watch stops polling.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { TextView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderEvent, HerderHost } from "../../src/herder-port.ts";
import type { AppTools } from "../../src/mcp-gateway.ts";
import { fitsOwner } from "../../src/owner-text.ts";
import { Store } from "../../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "agentherd-mail-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

interface FakeMail {
  messageId: string;
  sender: string;
  subject: string;
  messageTimestamp: string;
  display_url: string;
  preview: { body: string; subject: string };
}

/** A Gmail behind Composio's multi-execute tool, answering like the real one. */
class FakeGmail {
  mail: FakeMail[] = [];
  queries: string[] = [];
  fail: string | undefined;

  receive(id: string, sender: string, subject: string, at: string, body = ""): void {
    this.mail.unshift({
      messageId: id,
      sender,
      subject,
      messageTimestamp: at,
      display_url: `https://mail.google.com/mail/u/0/#inbox/${id}`,
      preview: { body, subject },
    });
  }

  apps: AppTools = {
    list: async () => [],
    describe: async () => new Map(),
    call: async (name, args) => {
      expect(name).toBe("COMPOSIO_MULTI_EXECUTE_TOOL");
      const call = (args as { tools: { tool_slug: string; arguments: { query: string } }[] })
        .tools[0];
      expect(call?.tool_slug).toBe("GMAIL_FETCH_EMAILS");
      const query = call?.arguments.query ?? "";
      this.queries.push(query);
      if (this.fail !== undefined) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                successful: false,
                data: { results: [{ response: { successful: false, error: this.fail } }] },
              }),
            },
          ],
          isError: false,
        };
      }
      const after = Number(/after:(\d+)/.exec(query)?.[1] ?? 0) * 1000;
      const from = /from:(\S+)\)/.exec(query)?.[1];
      const messages = this.mail.filter(
        (m) =>
          Date.parse(m.messageTimestamp) >= after &&
          (from === undefined || m.sender.includes(from)),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              successful: true,
              data: {
                results: [{ response: { successful: true, data: { messages } }, index: 0 }],
              },
              error: null,
            }),
          },
        ],
        isError: false,
      };
    },
  };
}

async function setup(withApps = true) {
  const channel = new FakeChannel("owner");
  const clock = new FakeClock("2026-11-04T00:00:00.000Z");
  const store = Store.open(":memory:");
  const gmail = new FakeGmail();
  let host: HerderHost | undefined;
  const events: HerderEvent[] = [];
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [],
    store,
    clock,
    boardDebounceMs: 10,
    ...(withApps ? { apps: () => gmail.apps } : {}),
    mailPollMinutes: 3,
    herder: (h) => {
      host = h;
      return {
        ownerMessage() {},
        ownerAnswer() {},
        event: (e) => events.push(e),
        stop: async () => {},
      };
    },
  });
  herds.push(herd);
  await herd.start();
  if (host === undefined) throw new Error("no herder host");
  return { herd, channel, clock, store, gmail, host, events };
}

const texts = (channel: FakeChannel) =>
  channel.messages.filter((m) => m.view.kind === "text").map((m) => (m.view as TextView).text);

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

describe("E2E-MAIL", () => {
  it("polls only after the owner asks, and tells new matching mail once", async () => {
    const { channel, clock, gmail, host, events } = await setup();
    gmail.receive("old", "Prof Li <li@uni.edu>", "Last week", "2026-11-03T08:00:00Z");

    // Nothing is watched, so nothing is polled.
    await clock.advance(10 * 60_000);
    expect(gmail.queries).toEqual([]);
    expect(clock.pending()).toBe(0);

    const watch = await host.watchMail?.("Prof Li's mail", "from:li@uni.edu");
    expect(watch?.about).toBe("Prof Li's mail");
    expect(host.mailWatches?.().map((w) => w.query)).toEqual(["from:li@uni.edu"]);
    expect(gmail.queries[0]).toBe(
      `(from:li@uni.edu) after:${Date.parse("2026-11-04T00:10:00.000Z") / 1000}`,
    );

    // Mail from someone else, and mail older than the watch, are not told.
    gmail.receive("ad", "Shop <ads@shop.com>", "Sale", "2026-11-04T00:12:00Z");
    gmail.receive(
      "m1",
      '"Prof Li" <li@uni.edu>',
      "Meeting tomorrow",
      "2026-11-04T00:13:00Z",
      "Please bring the draft.\u034f \u034f \u200c",
    );
    await clock.advance(3 * 60_000);
    await until(() => texts(channel).length > 0);
    expect(texts(channel)).toEqual([
      'New mail (Prof Li\'s mail):\n- Prof Li: "Meeting tomorrow"\n  Please bring the draft.\n  https://mail.google.com/mail/u/0/#inbox/m1',
    ]);
    // Told once.
    await clock.advance(3 * 60_000);
    await until(() => gmail.queries.length >= 3);
    expect(texts(channel)).toHaveLength(1);
    // The Herder hears what the owner was told.
    expect(events).toEqual([
      { kind: "mail", title: "Prof Li's mail", text: expect.stringContaining("Meeting tomorrow") },
    ]);

    // A removed watch stops polling.
    expect(host.unwatchMail?.(watch?.id ?? "")).toBe(true);
    const asked = gmail.queries.length;
    await clock.advance(10 * 60_000);
    expect(gmail.queries).toHaveLength(asked);
    expect(clock.pending()).toBe(0);
  });

  it("keeps a burst of mail to one short message (ADR 0049)", async () => {
    const { channel, clock, gmail, host } = await setup();
    await host.watchMail?.("all new mail", "in:inbox");
    const body = "Lorem ipsum dolor sit amet ".repeat(20);
    for (let i = 1; i <= 6; i++) {
      gmail.receive(
        `b${i}`,
        `Sender ${i} <s${i}@x.com>`,
        `Subject ${i}`,
        `2026-11-04T00:1${i}:00Z`,
        body,
      );
    }
    await clock.advance(3 * 60_000);
    await until(() => texts(channel).length > 0);
    const [told] = texts(channel);
    expect(texts(channel)).toHaveLength(1);
    expect(fitsOwner(told ?? "")).toBe(true);
    expect(told).toContain("Subject 6");
    expect((told ?? "").match(/https:\/\/mail/g)?.length ?? 0).toBeLessThanOrEqual(3);
    expect(told).toMatch(/and \d+ more/);
    // A preview is a glimpse, not the mail.
    expect(told).not.toContain(body.trim());
  });

  it("keeps watching across a restart", async () => {
    const first = await setup();
    await first.host.watchMail?.("all new mail", "in:inbox");
    const saved = first.store.mailWatches();
    expect(saved).toHaveLength(1);
    // A new Herd on the same database picks the watch up and polls again.
    const store = first.store;
    const gmail = new FakeGmail();
    const channel = new FakeChannel("owner");
    const clock = new FakeClock("2026-11-04T01:00:00.000Z");
    const herd = new Herd({
      home: dir,
      userHome: "/Users/me",
      channel,
      binding: { channelId: "fake", ownerId: "owner", data: {} },
      mode: "assist",
      locale: "en",
      profiles: [],
      store,
      clock,
      apps: () => gmail.apps,
    });
    herds.push(herd);
    await herd.start();
    gmail.receive("n1", "bob@x.com", "Hi", "2026-11-04T01:01:00Z");
    await clock.advance(3 * 60_000);
    await until(() => texts(channel).length > 0);
    expect(texts(channel)[0]).toContain('- bob@x.com: "Hi"');
  });

  it("tells the owner once when Gmail stays unreachable, and when it is back (ADR 0050)", async () => {
    const { channel, clock, gmail, host, store } = await setup();
    await host.watchMail?.("all new mail", "in:inbox");
    gmail.fail = "fetch failed";
    // A few failed looks are not news.
    for (let i = 0; i < 9; i++) await clock.advance(3 * 60_000);
    await until(() => store.auditRows("mail.error").length > 0);
    expect(texts(channel)).toEqual([]);
    expect(host.sources?.()).toMatchObject([{ source: "mail", told: false }]);
    // Half an hour of failures is.
    for (let i = 0; i < 2; i++) await clock.advance(3 * 60_000);
    await until(() => texts(channel).length > 0);
    expect(texts(channel)).toEqual([
      "Mail updates stopped: Gmail has not answered for 30 minutes. You will hear when it is back.",
    ]);
    expect(store.auditRows("mail.error")).toHaveLength(1);
    await clock.advance(3 * 60_000);
    expect(texts(channel)).toHaveLength(1);
    // Back: said once.
    gmail.fail = undefined;
    await clock.advance(3 * 60_000);
    await until(() => texts(channel).length > 1);
    expect(texts(channel)[1]).toBe("Mail updates work again.");
    expect(host.sources?.()).toEqual([]);
  });

  it("a Gmail that fails while nothing is watched is forgotten", async () => {
    const { clock, gmail, host } = await setup();
    const watch = await host.watchMail?.("all new mail", "in:inbox");
    gmail.fail = "fetch failed";
    await clock.advance(3 * 60_000);
    await until(() => (host.sources?.() ?? []).length > 0);
    host.unwatchMail?.(watch?.id ?? "");
    expect(host.sources?.()).toEqual([]);
  });

  it("refuses a watch Gmail cannot answer, and has no mail tools without apps", async () => {
    const { gmail, host } = await setup();
    gmail.fail = "Gmail is not connected";
    await expect(host.watchMail?.("x", "from:a@b.c")).rejects.toThrow("Gmail is not connected");
    expect(host.mailWatches?.()).toEqual([]);

    const bare = await setup(false);
    expect(bare.host.watchMail).toBeUndefined();
  });
});
