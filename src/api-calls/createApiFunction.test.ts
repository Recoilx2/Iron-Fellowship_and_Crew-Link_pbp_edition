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
      "Something went wrong",
    );

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      await expect(wrapped(undefined)).rejects.toBe(failure);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("resolves with the wrapped value when the wrapped call succeeds", async () => {
    const wrapped = createApiFunction<undefined, number>(
      () => Promise.resolve(42),
      "Something went wrong",
    );

    await expect(wrapped(undefined)).resolves.toBe(42);
  });

  it("keeps non-object rejections working", async () => {
    const wrapped = createApiFunction<undefined, never>(
      () => Promise.reject("plain string"),
      "Something went wrong",
    );
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      await expect(wrapped(undefined)).rejects.toBe("plain string");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("createApiFunction failure log", () => {
  async function rejectAndCapture(failure: unknown) {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const wrapped = createApiFunction<undefined, never>(
        () => Promise.reject(failure),
        "Something went wrong",
      );
      await expect(wrapped(undefined)).rejects.toBe(failure);
      return JSON.stringify(consoleSpy.mock.calls);
    } finally {
      consoleSpy.mockRestore();
    }
  }

  it("logs a PostgrestError-like failure without its row details", async () => {
    const logged = await rejectAndCapture({
      name: "PostgrestError",
      code: "23514",
      message: 'new row violates check constraint "chat_posts_text_or_images"',
      details: "Failing row contains (secret post text)",
      hint: "secret hint",
    });
    expect(logged).not.toContain("secret post text");
    expect(logged).not.toContain("secret hint");
    expect(logged).toContain("API call failed (ref: ");
    expect(logged).toContain("PostgrestError");
    expect(logged).toContain("23514");
    expect(logged).toContain("chat_posts_text_or_images");
  });

  it("does not log an Error's cause or stack", async () => {
    const failure = new Error("outer failure", {
      cause: new Error("secret cause text"),
    });
    failure.stack = "Error: outer failure\n at secret stack frame";
    const logged = await rejectAndCapture(failure);
    expect(logged).not.toContain("secret cause text");
    expect(logged).not.toContain("secret stack frame");
    expect(logged).toContain("outer failure");
  });
});
