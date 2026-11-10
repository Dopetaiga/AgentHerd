// E2E-ASK-LIFECYCLE (ADR 0056): a Herder question closes when the owner writes instead of
// picking, or after an hour with no answer; the Herder hears why either way.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { AskView } from "@agentherd/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../src/clock.ts";
import { Herd } from "../../src/herd.ts";
import type { HerderEvent, HerderHost } from "../../src/herder-port.ts";
import { Store } from "../../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "agentherd-ask-"));
let herds: Herd[] = [];

afterEach(async () => {
  await Promise.all(herds.map((h) => h.stop()));
  herds = [];
});

async function setup() {
  const channel = new FakeChannel("owner");
  const clock = new FakeClock();
  let host: HerderHost | undefined;
  const events: HerderEvent[] = [];
  const said: string[] = [];
  const answers: string[] = [];
  const herd = new Herd({
    home: dir,
    userHome: "/Users/me",
    channel,
    binding: { channelId: "fake", ownerId: "owner", data: {} },
    mode: "assist",
    locale: "en",
    profiles: [],
    store: Store.open(":memory:"),
    clock,
    herder: (h) => {
      host = h;
      return {
        ownerMessage: (text) => said.push(text),
        ownerAnswer: (_q, a) => answers.push(a),
        event: (e) => events.push(e),
        stop: async () => {},
      };
    },
  });
  herds.push(herd);
  await herd.start();
  if (host === undefined) throw new Error("no herder host");
  return { channel, clock, host, events, said, answers };
}

const askCard = (channel: FakeChannel) => {
  const m = channel.messages.find((x) => x.view.kind === "ask");
  if (m === undefined) throw new Error("no ask");
  return m;
};

describe("E2E-ASK-LIFECYCLE (ADR 0056)", () => {
  it("writing in the chat closes the open question; the message goes to the Herder", async () => {
    const { channel, host, events, said } = await setup();
    await host.ask("Which folder?", ["~/a", "~/b"]);
    await channel.say("用 ~/c 吧");
    const card = askCard(channel);
    expect((card.view as AskView).final).toBe("You answered in the chat");
    expect(said).toEqual(["用 ~/c 吧"]);
    expect(events).toMatchObject([{ kind: "ask-closed", title: "Which folder?" }]);
    expect(events[0]?.text).toContain("may be the answer");
  });

  it("a question nobody answers closes after an hour, once", async () => {
    const { channel, clock, host, events, answers } = await setup();
    await host.ask("Continue the task?", ["Yes", "No"]);
    await clock.advance(59 * 60_000);
    expect((askCard(channel).view as AskView).final).toBeUndefined();
    await clock.advance(2 * 60_000);
    await new Promise((r) => setImmediate(r));
    expect((askCard(channel).view as AskView).final).toBe("No answer in 1 hour; set aside");
    expect(events).toMatchObject([{ kind: "ask-closed", title: "Continue the task?" }]);
    // A late tap does nothing.
    const view = askCard(channel).view as AskView;
    await channel.tap(view.askId, "0");
    expect(answers).toEqual([]);
  });

  it("a pick before the hour cancels the timeout", async () => {
    const { channel, clock, host, events, answers } = await setup();
    await host.ask("Continue the task?", ["Yes", "No"]);
    await channel.tap((askCard(channel).view as AskView).askId, "0");
    await clock.advance(2 * 60 * 60_000);
    expect(answers).toEqual(["Yes"]);
    expect(events).toEqual([]);
  });
});
