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
});
