import { describe, expect, it } from "vitest";
import { errorKind, REASON_MAX_CHARS, shortError } from "../src/errors.ts";

describe("errors", () => {
  it("does not retry key, balance or request errors", () => {
    expect(errorKind("401: invalid api key")).toBe("fatal");
    expect(errorKind("余额不足")).toBe("fatal");
    expect(errorKind("Connection error.")).toBe("transient");
    expect(errorKind("503 Service Unavailable")).toBe("transient");
  });

  it("shows the API's own message, not the JSON body", () => {
    const raw =
      '401: {"message":"Authentication Fails, Your api key: ****test is invalid (request_id: 0198e448)","type":"authentication_error","param":null}';
    expect(shortError(raw)).toBe("401 Authentication Fails, Your api key: ****test is invalid");
    expect(shortError("Connection error.")).toBe("Connection error.");
    const long = shortError("x".repeat(500));
    expect(long).toHaveLength(REASON_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
});
