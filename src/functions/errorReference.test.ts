import { afterEach, describe, expect, it, vi } from "vitest";

import { logFailureReference } from "functions/errorReference";

describe("logFailureReference", () => {
  afterEach(() => vi.restoreAllMocks());

  function logArgs(...details: unknown[]): unknown[] {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailureReference("ABC123", ...details);
    return spy.mock.calls[0];
  }

  it("passes plain detail objects through unchanged", () => {
    const composer = { fileSize: 123, fileType: "image/png" };
    const gateway = { path: "/p", status: 502, body: "gateway text" };
    const args = logArgs(composer, gateway);
    expect(args[0]).toBe("API call failed (ref: ABC123)");
    expect(args[1]).toBe(composer);
    expect(args[2]).toBe(gateway);
  });

  it("keeps short strings and caps long ones", () => {
    const [, short, long] = logArgs("short", "x".repeat(2000));
    expect(short).toBe("short");
    expect((long as string).length).toBeLessThan(2000);
    expect((long as string).startsWith("xxx")).toBe(true);
  });

  it("keeps a gateway body the client already truncated to 500", () => {
    const [, body] = logArgs("y".repeat(500));
    expect((body as string).startsWith("y".repeat(500))).toBe(true);
  });

  it("summarises an Error to name, code, status and message", () => {
    const error = Object.assign(new Error("boom", { cause: "secret" }), {
      code: "X1",
      status: 400,
      details: "secret details",
      extra: "secret extra",
    });
    const [, summary] = logArgs(error);
    expect(summary).toEqual({
      name: "Error",
      code: "X1",
      status: 400,
      message: "boom",
    });
  });

  it("summarises a plain error-shaped object with details", () => {
    const [, summary] = logArgs({
      message: "m",
      details: "secret",
      hint: "secret",
    });
    expect(summary).toEqual({ message: "m" });
  });
});
