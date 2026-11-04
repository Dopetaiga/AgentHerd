import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, feishuSecrets, secretFile, secretsPath, writeConfig } from "../src/config.ts";

describe("secretFile", () => {
  it("keeps secrets in secrets.json with mode 600, apart from config.json", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "ah-")), "home");
    writeConfig(home, { mode: "assist" });
    const store = secretFile(home);
    expect(store.get("model:deepseek")).toBeUndefined();
    store.set("model:deepseek", "sk-1");
    await feishuSecrets(home).saveSecret("cli_x", "app-secret");
    expect(store.get("model:deepseek")).toBe("sk-1");
    expect(await feishuSecrets(home).getSecret("cli_x")).toBe("app-secret");
    expect(statSync(secretsPath(home)).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(readFileSync(configPath(home), "utf8")).not.toContain("sk-1");
    store.delete("model:deepseek");
    expect(store.get("model:deepseek")).toBeUndefined();
    expect(JSON.parse(readFileSync(secretsPath(home), "utf8"))).toEqual({
      "feishu:cli_x": "app-secret",
    });
  });

  it("says how to fix a missing App Secret", async () => {
    const home = mkdtempSync(join(tmpdir(), "ah-"));
    await expect(feishuSecrets(home).getSecret("cli_y")).rejects.toThrow(
      'no App Secret for cli_y; run "agentherd setup feishu"',
    );
  });
});
