import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("notistack", () => ({
  enqueueSnackbar: vi.fn(),
}));

import { enqueueSnackbar } from "notistack";
import { createApiFunction } from "api-calls/createApiFunction";

// Seam under test: the same createApiFunction contract, but with a working
// enqueueSnackbar (as when a SnackbarProvider is mounted in production).
// The error toast must still be shown and the caller must still get the
// rejection. User-facing errors carry a short reference code (story 38):
// the toast shows the generic message plus the code, details stay in logs.
describe("createApiFunction with a SnackbarProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the error toast with a reference code and still rejects with the original error", async () => {
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

    expect(enqueueSnackbar).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(enqueueSnackbar).mock.calls[0];
    expect(message).toMatch(/^Something went wrong \(ref: [A-Z0-9]{6}\)$/);
    expect(options).toEqual({
      variant: "error",
      persist: true,
    });
  });

  it("generates a distinct reference code per failure and logs details with the code", async () => {
    const makeWrapped = (failure: Error) =>
      createApiFunction<undefined, never>(
        () => Promise.reject(failure),
        "Something went wrong",
      );

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const failure1 = new Error("first");
      const failure2 = new Error("second");
      await expect(makeWrapped(failure1)(undefined)).rejects.toBe(failure1);
      await expect(makeWrapped(failure2)(undefined)).rejects.toBe(failure2);

      expect(enqueueSnackbar).toHaveBeenCalledTimes(2);
      const messages = vi
        .mocked(enqueueSnackbar)
        .mock.calls.map(([message]) => message as string);
      const codes = messages.map((message) => {
        const match = message.match(/\(ref: ([A-Z0-9]{6})\)$/);
        expect(match).not.toBeNull();
        return match![1];
      });
      expect(codes[0]).not.toBe(codes[1]);

      // Details plus the matching code go to logs, never to the user message
      // beyond the code itself.
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      for (const [index, failure] of [failure1, failure2].entries()) {
        const call = consoleSpy.mock.calls[index];
        expect(call[0]).toContain(codes[index]);
        expect(call[1]).toBe(failure);
      }
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
