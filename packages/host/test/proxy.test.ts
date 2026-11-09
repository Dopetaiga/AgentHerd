import { describe, expect, it } from "vitest";
import { macProxy, windowsProxy, withSystemProxy } from "../src/proxy.ts";

const REG = (enable: string, server: string) => `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    MigrateProxy    REG_DWORD    0x1
    ProxyEnable    REG_DWORD    ${enable}
    ProxyServer    REG_SZ    ${server}
    ProxyOverride    REG_SZ    localhost;127.*;<local>
`;

const SCUTIL = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
}`;

describe("system proxy (ADR 0050)", () => {
  it("reads the Windows proxy when it is on", () => {
    expect(windowsProxy(REG("0x1", "127.0.0.1:7890"))).toBe("http://127.0.0.1:7890");
    expect(windowsProxy(REG("0x0", "127.0.0.1:7890"))).toBeUndefined();
    expect(windowsProxy(REG("0x1", "http=h:1;https=h:2;ftp=h:3"))).toBe("http://h:2");
    expect(windowsProxy(REG("0x1", "socks5://h:1080"))).toBe("socks5://h:1080");
    expect(windowsProxy("")).toBeUndefined();
  });

  it("reads the macOS proxy, HTTPS first", () => {
    expect(macProxy(SCUTIL)).toBe("http://127.0.0.1:7891");
    expect(macProxy(SCUTIL.replace("HTTPSEnable : 1", "HTTPSEnable : 0"))).toBe(
      "http://127.0.0.1:7890",
    );
    expect(macProxy("<dictionary> {\n}")).toBeUndefined();
  });

  it("keeps a proxy the environment already has, and survives a failing query", () => {
    const query = () => REG("0x1", "127.0.0.1:7890");
    expect(withSystemProxy({ HTTPS_PROXY: "http://mine:1" }, "win32", query)).toEqual({
      HTTPS_PROXY: "http://mine:1",
    });
    expect(withSystemProxy({ PATH: "p" }, "win32", query)).toEqual({
      PATH: "p",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      HTTP_PROXY: "http://127.0.0.1:7890",
    });
    expect(
      withSystemProxy({ PATH: "p" }, "win32", () => {
        throw new Error("no reg");
      }),
    ).toEqual({ PATH: "p" });
    expect(withSystemProxy({ PATH: "p" }, "linux", query)).toEqual({ PATH: "p" });
  });
});
