/**
 * Unit tests for the gm-assistant's server error log helper (ticket
 * #183): every line carries a reference, and no id, URL or control
 * character can reach a log line, whatever a caller passes.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import { logServerError } from "./log";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function capturedLines(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  return lines;
}

describe("logServerError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs one line with the reference it returns, in the server log shape", () => {
    const lines = capturedLines();
    const ref = logServerError("REPLY_SAVE_FAILED", "assistant reply save failed");
    expect(ref).toMatch(/^[0-9A-HJKLMNP-Z]{6}$/);
    expect(lines).toEqual([
      `[gm-assistant] ref=${ref} code=REPLY_SAVE_FAILED detail=assistant reply save failed`,
    ]);
  });

  it("logs status and route when given, and keeps the caller's reference", () => {
    const lines = capturedLines();
    const ref = logServerError("UPSTREAM_ERROR", "models upstream status 500", {
      status: 502,
      route: "POST /gm-assistant/models",
      ref: "ABC234",
    });
    expect(ref).toBe("ABC234");
    expect(lines).toEqual([
      "[gm-assistant] ref=ABC234 code=UPSTREAM_ERROR status=502 route=POST /gm-assistant/models detail=models upstream status 500",
    ]);
  });

  it("omits the detail field when the caller passes no detail", () => {
    const lines = capturedLines();
    logServerError("REPLY_SAVE_FAILED", "");
    expect(lines[0]).toMatch(/^\[gm-assistant\] ref=[0-9A-HJKLMNP-Z]{6} code=REPLY_SAVE_FAILED$/);
  });

  it("never logs a UUID-shaped id: it becomes a placeholder", () => {
    const lines = capturedLines();
    logServerError("REPLY_SAVE_FAILED", `save failed for ${UUID} (conversation)`);
    expect(lines[0]).not.toContain(UUID);
    expect(lines[0]).toContain("save failed for [id] (conversation)");
  });

  it("never logs a URL: it becomes a placeholder", () => {
    const lines = capturedLines();
    logServerError(
      "REPLY_SAVE_FAILED",
      `upstream https://llm.test/v1/chat?key=sk-secret rejected the save`,
    );
    expect(lines[0]).not.toContain("llm.test");
    expect(lines[0]).not.toContain("sk-secret");
    expect(lines[0]).toContain("[url]");
  });

  it("strips control characters, so a hostile detail cannot forge log lines", () => {
    const lines = capturedLines();
    logServerError("REPLY_SAVE_FAILED", "one\n[gm-assistant] ref=FAKE01 fake line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).toContain("one [gm-assistant] ref=FAKE01 fake line");
  });

  it("caps the detail at 300 characters", () => {
    const lines = capturedLines();
    logServerError("REPLY_SAVE_FAILED", "x".repeat(500));
    const detail = lines[0]!.split("detail=")[1] ?? "";
    expect(detail.length).toBe(300);
  });

  it("caps the route at 120 characters", () => {
    const lines = capturedLines();
    logServerError("REPLY_SAVE_FAILED", "d", {
      status: 500,
      route: `POST /${"x".repeat(200)}`,
    });
    const route = lines[0]!
      .split("route=")[1]!
      .replace(/ detail=.*$/, "");
    expect(route.startsWith("POST /")).toBe(true);
    expect(route.length).toBeLessThanOrEqual(120);
  });

  it("mints a fresh reference per call", () => {
    capturedLines();
    const first = logServerError("REPLY_SAVE_FAILED", "a");
    const second = logServerError("REPLY_SAVE_FAILED", "a");
    expect(first).not.toBe(second);
  });
});
