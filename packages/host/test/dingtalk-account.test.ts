import { describe, expect, it, vi } from "vitest";
import { DingTalkAccount } from "../src/dingtalk-account.ts";
import type { DingTalkCliPort, DingTalkIdentity } from "../src/dingtalk-cli.ts";

const identity = { corpId: "corp", userId: "user", corpName: "Example", userName: "Owner" };
const command = { args: ["calendar", "event", "create"] };

function fixture(initial?: DingTalkIdentity) {
  const cli = {
    status: vi.fn<DingTalkCliPort["status"]>().mockResolvedValue(initial),
    login: vi.fn<DingTalkCliPort["login"]>().mockResolvedValue(undefined),
    reset: vi.fn<DingTalkCliPort["reset"]>().mockResolvedValue(undefined),
    run: vi.fn<DingTalkCliPort["run"]>().mockResolvedValue({ ok: true }),
  };
  return { cli, account: new DingTalkAccount(cli) };
}

describe("DingTalk account", () => {
  it("restores a single account and exposes only labels", async () => {
    const { cli, account } = fixture(identity);
    const view = await account.view();
    expect(view).toMatchObject({ state: "connected", corpName: "Example", userName: "Owner" });
    expect(view).not.toHaveProperty("corpId");
    expect(view).not.toHaveProperty("userId");
    const run = await account.bind();
    await expect(run(command)).resolves.toEqual({ ok: true });
    expect(cli.run).toHaveBeenCalledExactlyOnceWith(identity, command, expect.any(AbortSignal));
  });

  it("opens one official login and drains late completion before clearing it", async () => {
    const { cli, account } = fixture();
    const login = Promise.withResolvers<void>();
    cli.login.mockReturnValue(login.promise);
    expect(await account.startLogin()).toMatchObject({ state: "connecting" });
    expect(await account.startLogin()).toMatchObject({ state: "connecting" });
    expect(cli.login).toHaveBeenCalledTimes(1);
    const cancelled = account.cancelLogin();
    expect(cli.reset).not.toHaveBeenCalled();
    cli.status.mockResolvedValue(identity);
    login.resolve();
    expect(await cancelled).toMatchObject({ state: "disconnected" });
    expect(cli.reset).toHaveBeenCalledTimes(1);
    expect(await account.view()).not.toHaveProperty("corpName");
    await expect(account.bind()).rejects.toThrow();
  });

  it("does not accept a new login during local reset or after reset failure", async () => {
    const { cli, account } = fixture(identity);
    await account.view();
    cli.reset.mockRejectedValueOnce(new Error("FAKE_SECRET"));
    await expect(account.disconnect()).resolves.toMatchObject({ state: "failed" });
    expect(JSON.stringify(await account.startLogin())).not.toContain("FAKE_SECRET");
    expect(cli.login).not.toHaveBeenCalled();
    await expect(account.bind()).rejects.toThrow();
    await expect(account.disconnect()).resolves.toMatchObject({ state: "disconnected" });
  });

  it("does not dispatch under a changed account and invalidates every old binding", async () => {
    const { cli, account } = fixture(identity);
    const original = await account.bind();
    const alsoOriginal = await account.bind();
    cli.status.mockResolvedValue({ ...identity, corpId: "other" });
    await expect(original(command)).rejects.toThrow();
    await expect(alsoOriginal(command)).rejects.toThrow();
    expect(await account.startLogin()).toMatchObject({ state: "failed", capabilities: [] });
    expect(cli.run).not.toHaveBeenCalled();
  });

  it("requires cleanup after an unsuccessful browser flow", async () => {
    const { cli, account } = fixture();
    cli.login.mockRejectedValueOnce(new Error("FAKE_PRIVATE_OUTPUT"));
    await account.startLogin();
    await vi.waitFor(async () => expect(await account.view()).toMatchObject({ state: "failed" }));
    expect(await account.startLogin()).toMatchObject({ state: "failed" });
    expect(cli.login).toHaveBeenCalledTimes(1);
    expect(await account.disconnect()).toMatchObject({ state: "disconnected" });
  });

  it("aborts old work and drains it before resetting credentials", async () => {
    const { cli, account } = fixture(identity);
    const original = await account.bind();
    const operation = Promise.withResolvers<unknown>();
    cli.run.mockReturnValue(operation.promise);
    const pending = original(command);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(cli.run).toHaveBeenCalledTimes(1));
    const disconnect = account.disconnect();
    expect(cli.run.mock.calls[0]?.[2].aborted).toBe(true);
    expect(cli.reset).not.toHaveBeenCalled();
    operation.resolve({ ok: true });
    await rejected;
    expect(await disconnect).toMatchObject({ state: "disconnected" });
    await expect(original(command)).rejects.toThrow();
    expect(cli.run).toHaveBeenCalledTimes(1);
  });

  it("stops without removing local authorization", async () => {
    const { cli, account } = fixture(identity);
    const run = await account.bind();
    await account.stop();
    expect(await account.view()).toMatchObject({ state: "disconnected" });
    await expect(account.startLogin()).resolves.toMatchObject({ state: "disconnected" });
    await expect(run(command)).rejects.toThrow();
    expect(cli.reset).not.toHaveBeenCalled();
  });
});
