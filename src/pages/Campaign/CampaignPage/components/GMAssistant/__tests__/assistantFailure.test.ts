import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRequestError } from "api-calls/assistant/gmAssistantClient";
import { createApiFunction } from "api-calls/createApiFunction";
import { referenceFor, toAssistantFailure } from "../assistantFailure";

vi.mock("config/supabase.config", () => ({ getSupabaseClient: vi.fn() }));

// Seam under test: what the GM may see of a failure on an assistant path.
// Only fixed client text and a reference ever reach the screen; server or
// gateway wording never does, and the reference shown is the one logged.
describe("toAssistantFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fixed: Array<[string, string]> = [
    ["NOT_SET_UP", "The assistant isn't set up on this server."],
    ["FORBIDDEN", "Only a GM of this campaign can use the assistant."],
    ["UNAUTHORIZED", "Sign in again and retry."],
    ["INVALID_REQUEST", "The assistant couldn't handle that request."],
    ["CONVERSATION_NOT_FOUND", "That conversation wasn't found."],
    ["UPSTREAM_ERROR", "The assistant request failed."],
    ["PAYLOAD_TOO_LARGE", "That request was too large."],
  ];

  it.each(fixed)("maps %s to its fixed text", (code, text) => {
    const failure = toAssistantFailure(
      new AssistantRequestError(code, "server wording that must not show", {
        status: 400,
        ref: "SRV123",
      })
    );
    expect(failure.message).toBe(text);
    expect(failure.ref).toBe("SRV123");
  });

  it("shows generic text plus a reference for an unknown code", () => {
    const failure = toAssistantFailure(
      new AssistantRequestError("SOMETHING_NEW", "raw gateway text", {
        status: 500,
        ref: null,
      })
    );
    expect(failure.message).toBe("The assistant request failed.");
    expect(failure.ref).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("shows generic text plus a reference for an arbitrary error", () => {
    const failure = toAssistantFailure(new TypeError("Failed to fetch"));
    expect(failure.message).toBe("The assistant request failed.");
    expect(failure.message).not.toContain("fetch");
    expect(failure.ref).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("shows the reference that createApiFunction logged", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("denied by policy");
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject(failure),
      "Failed to do it."
    );
    await expect(wrapped(undefined)).rejects.toBe(failure);

    const logged = /ref: ([A-Z0-9]{6})/.exec(
      String(consoleSpy.mock.calls[0][0])
    )?.[1];
    expect(logged).toBeDefined();
    expect(toAssistantFailure(failure).ref).toBe(logged);
    expect(referenceFor(failure)).toBe(logged);
  });

  it("logs and shows the server reference when the error carries one", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new AssistantRequestError("FORBIDDEN", "x", {
      status: 403,
      ref: "SRV123",
    });
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject(failure),
      "Failed to do it."
    );
    await expect(wrapped(undefined)).rejects.toBe(failure);

    expect(String(consoleSpy.mock.calls[0][0])).toContain("SRV123");
    expect(toAssistantFailure(failure).ref).toBe("SRV123");
  });

  it("logs a reference it has to mint, once, and shows that reference", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TypeError("Failed to fetch");
    const shown = toAssistantFailure(error);
    toAssistantFailure(error);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleSpy.mock.calls[0][0])).toContain(`ref: ${shown.ref}`);
  });

  it("does not take a stray ref property on another error for a reference", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stray = Object.assign(new Error("x"), { ref: "NOTMINE" });
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject(stray),
      "Failed to do it."
    );
    await expect(wrapped(undefined)).rejects.toBe(stray);
    expect(String(consoleSpy.mock.calls[0][0])).not.toContain("NOTMINE");
  });

  it("logs a client-minted reference once under the same reference when wrapped", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AssistantRequestError("NETWORK_ERROR", "x", {
      status: 0,
      ref: "CLI123",
    });
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject(error),
      "Failed to do it."
    );
    await expect(wrapped(undefined)).rejects.toBe(error);
    for (const call of consoleSpy.mock.calls) {
      expect(String(call[0])).toContain("CLI123");
    }
  });
});
