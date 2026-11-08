import { describe, expect, it } from "vitest";
import { sourceHint } from "../src/source-health.ts";

describe("sourceHint (ADR 0050)", () => {
  it("tells a missing or logged-out gh from an unreachable GitHub", () => {
    expect(sourceHint("github", "spawn gh ENOENT")).toBe("missing");
    expect(sourceHint("github", "gh: command not found")).toBe("missing");
    expect(sourceHint("github", "To get started with GitHub CLI, please run:  gh auth login")).toBe(
      "login",
    );
    expect(sourceHint("github", "HTTP 401: Bad credentials")).toBe("login");
    expect(sourceHint("github", "error connecting to api.github.com")).toBe("offline");
  });

  it("tells an expired Gmail connection from an unreachable one", () => {
    expect(sourceHint("mail", "no connected apps")).toBe("login");
    expect(sourceHint("mail", "No active connection for gmail")).toBe("login");
    expect(sourceHint("mail", "fetch failed")).toBe("offline");
  });
});
