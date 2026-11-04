import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.ts";

const REDACTED = "«redacted»";

describe("redact", () => {
  it("redacts an OpenAI sk- key", () => {
    expect(redact("sk-abcdefghijklmnop")).toBe(REDACTED);
  });

  it("redacts a GitHub ghp_ token", () => {
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD")).toBe(REDACTED);
  });

  it("redacts a GitHub github_pat_ token", () => {
    expect(redact("github_pat_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(REDACTED);
  });

  it("redacts a GitHub ghs_ token", () => {
    expect(redact("ghs_abcdefghijklmnopqrstuvwxyz0123456789ABCD")).toBe(REDACTED);
  });

  it("redacts a Slack xoxb- token", () => {
    expect(redact("xoxb-abcdefghijklmnopqrstuvwxyz0123456789")).toBe(REDACTED);
  });

  it("redacts a Slack xoxp- token", () => {
    expect(redact("xoxp-abcdefghijklmnopqrstuvwxyz0123456789")).toBe(REDACTED);
  });

  it("redacts an AWS access key id", () => {
    expect(redact("AKIA1234567890ABCDEF")).toBe(REDACTED);
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redact(jwt)).toBe(REDACTED);
  });

  it("redacts a PEM private key block", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAu/examplebase64content
morelineshere
-----END RSA PRIVATE KEY-----`;
    expect(redact(pem)).toBe(REDACTED);
  });

  it("keeps Bearer but redacts its token", () => {
    expect(redact("Authorization: Bearer tok123")).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it("redacts a shell-style NAME=value assignment", () => {
    expect(redact("API_KEY=super-secret")).toBe(`API_KEY=${REDACTED}`);
  });

  it("redacts a quote-delimited shell assignment", () => {
    expect(redact('DB_PASSWORD="hunter2"')).toBe(`DB_PASSWORD=${REDACTED}`);
  });

  it("redacts a JSON string value", () => {
    expect(redact('{"password": "hunter2"}')).toBe(`{"password": ${REDACTED}}`);
  });

  it("redacts an env value by its secret name", () => {
    expect(redact("use hunter2 now", { PASSWORD: "hunter2" })).toBe(`use ${REDACTED} now`);
  });

  it("leaves ordinary text unchanged", () => {
    expect(redact("hello world")).toBe("hello world");
  });

  it("leaves a keyword-looking word without assignment unchanged", () => {
    expect(redact("keyboard")).toBe("keyboard");
  });

  it("leaves a non-secret assignment unchanged", () => {
    expect(redact("COLOR=blue")).toBe("COLOR=blue");
  });

  it("leaves a non-secret JSON value unchanged", () => {
    expect(redact('{"name": "value"}')).toBe('{"name": "value"}');
  });

  it("skips env values shorter than 4 characters", () => {
    expect(redact("abc", { TOKEN: "abc" })).toBe("abc");
  });

  it("skips empty env values", () => {
    expect(redact("text", { KEY: "" })).toBe("text");
  });
});
