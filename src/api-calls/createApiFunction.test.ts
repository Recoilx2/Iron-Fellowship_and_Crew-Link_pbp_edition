import { describe, expect, it, vi } from "vitest";

import { createApiFunction } from "api-calls/createApiFunction";

// Seam under test: createApiFunction's returned promise contract.
// No SnackbarProvider is mounted here (as in the live tests), so notistack's
// standalone enqueueSnackbar has nothing backing it.
describe("createApiFunction without a SnackbarProvider", () => {
  it("rejects promptly with the original error when the wrapped call fails", async () => {
    const failure = new Error("denied");
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject(failure),
      "Something went wrong"
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(wrapped(undefined)).rejects.toBe(failure);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("resolves with the wrapped value when the wrapped call succeeds", async () => {
    const wrapped = createApiFunction<undefined, number>(
      () => Promise.resolve(42),
      "Something went wrong"
    );

    await expect(wrapped(undefined)).resolves.toBe(42);
  });

  it("keeps non-object rejections working", async () => {
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject("plain string"),
      "Something went wrong"
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(wrapped(undefined)).rejects.toBe("plain string");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("createApiFunction failure log", () => {
  // The logged second argument is the error summary object.
  async function rejectAndCapture(failure: unknown) {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const wrapped = createApiFunction<undefined, never>(
        () => Promise.reject(failure),
        "Something went wrong"
      );
      await expect(wrapped(undefined)).rejects.toBe(failure);
      return consoleSpy.mock.calls[0];
    } finally {
      consoleSpy.mockRestore();
    }
  }

  it("logs a PostgrestError-like failure without its row details", async () => {
    // The real postgrest-js `{data, error}` error has no `name`.
    const [message, summary] = await rejectAndCapture({
      code: "23514",
      message: 'new row violates check constraint "chat_posts_text_or_images"',
      details: "Failing row contains (secret post text)",
      hint: "secret hint",
    });
    expect(message).toMatch(/^API call failed \(ref: /);
    expect(summary).toEqual({
      code: "23514",
      message: 'new row violates check constraint "chat_posts_text_or_images"',
    });
  });

  it("does not log an Error's cause or stack", async () => {
    const failure = new Error("outer failure", {
      cause: new Error("secret cause text"),
    });
    failure.stack = "Error: outer failure\n at secret stack frame";
    const [, summary] = await rejectAndCapture(failure);
    expect(summary).toEqual({ name: "Error", message: "outer failure" });
  });

  it("summarises an error-shaped object with no code", async () => {
    const [, summary] = await rejectAndCapture({
      message: "not json",
      extra: "secret body",
    });
    expect(summary).toEqual({ message: "not json" });
  });

  it("pins the cap to the exact capped string", async () => {
    const [, summary] = await rejectAndCapture(new Error("x".repeat(2000)));
    expect(summary).toEqual({
      name: "Error",
      message: "x".repeat(500) + "...",
    });
  });
});
