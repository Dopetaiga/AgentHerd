// Channel contract suite (plans/004 Step 4). Every channel runs it through a driver that can
// play the owner and read back what the channel showed. The core's inbox sits on top, so the
// suite also checks owner-only and duplicate handling end to end through the channel.

import type { Channel, ChannelBinding, Item, MessageRef, View } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.ts";
import { Inbox, type OwnerAnswer } from "../src/inbox.ts";
import { Store } from "../src/store.ts";

export interface ChannelDriver {
  channel: Channel;
  binding: ChannelBinding;
  /** Plays a button tap on the card with `ref`. */
  tap(ref: MessageRef, target: string, action: string, from: string): Promise<void>;
  /** Plays a text message. */
  say(text: string, from: string): Promise<void>;
  /** Number of messages sent so far. */
  sentCount(): number;
  /** The last content shown for a message, as searchable text. */
  shown(ref: MessageRef): string;
}

function item(id: string): Item {
  return {
    id,
    sessionId: "s1",
    profileId: "mock",
    cwd: "/work/proj",
    kind: "permission",
    state: "open",
    createdAt: "2026-11-04T00:00:00Z",
    toolCall: { kind: "execute", title: "Run pnpm test", command: "pnpm test", paths: [] },
    title: "Run pnpm test",
    body: "pnpm test",
    risk: "medium",
  };
}

export function channelContract(name: string, makeDriver: () => Promise<ChannelDriver>): void {
  describe(`channel contract: ${name}`, () => {
    async function setup() {
      const driver = await makeDriver();
      const store = Store.open(":memory:");
      const inbox = new Inbox({
        channel: driver.channel,
        binding: driver.binding,
        store,
        clock: new FakeClock(),
      });
      const answers: OwnerAnswer[] = [];
      await driver.channel.start(driver.binding, (inbound) => inbox.handle(inbound));
      const add = async (id: string) => {
        store.insertItem(item(id));
        const target = {
          answer: (a: OwnerAnswer) => {
            answers.push(a);
            return true;
          },
        };
        await inbox.add(item(id), target, "no rule matched");
        const ref = store.getItem(id)?.messageRef;
        if (ref === undefined) throw new Error("item card was not sent");
        return ref;
      };
      return { driver, store, inbox, answers, add, owner: driver.binding.ownerId };
    }

    it("send returns a ref and shows the item", async () => {
      const { driver, add } = await setup();
      const ref = await add("i1");
      expect(ref.channelId).toBe(driver.channel.id);
      expect(driver.shown(ref)).toContain("pnpm test");
      await driver.channel.stop();
    });

    it("update changes the same message in place", async () => {
      const { driver } = await setup();
      const view: View = { kind: "text", text: "first" };
      const ref = await driver.channel.send(view);
      const before = driver.sentCount();
      await driver.channel.update(ref, { kind: "text", text: "second" });
      expect(driver.sentCount()).toBe(before);
      expect(driver.shown(ref)).toContain("second");
      await driver.channel.stop();
    });

    it("the owner's tap is applied and the card shows the result", async () => {
      const { driver, add, answers, owner, store } = await setup();
      const ref = await add("i1");
      await driver.tap(ref, "i1", "allow", owner);
      expect(answers).toEqual(["allow"]);
      expect(driver.shown(ref)).toContain("Allowed by you");
      expect(store.decisionsFor("i1")).toHaveLength(1);
      await driver.channel.stop();
    });

    it("a tap from someone else changes nothing", async () => {
      const { driver, add, answers, store } = await setup();
      const ref = await add("i1");
      await driver.tap(ref, "i1", "allow", "someone-else");
      expect(answers).toEqual([]);
      expect(driver.shown(ref)).not.toContain("Allowed by you");
      expect(store.auditRows("inbound.dropped")).toHaveLength(1);
      await driver.channel.stop();
    });

    it("a duplicate tap is applied once", async () => {
      const { driver, add, answers, owner } = await setup();
      const ref = await add("i1");
      await driver.tap(ref, "i1", "deny", owner);
      await driver.tap(ref, "i1", "allow", owner);
      expect(answers).toEqual(["deny"]);
      expect(driver.shown(ref)).toContain("Denied by you");
      await driver.channel.stop();
    });

    it("a text message reaches the core as a message", async () => {
      const { driver, store, owner } = await setup();
      await driver.say("hello", owner);
      const rows = store.auditRows("inbound.ignored");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.data.text).toBe("hello");
      await driver.channel.stop();
    });
  });
}
