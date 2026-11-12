import { describe, expect, it, vi } from "vitest";

vi.mock("notistack", () => ({
  enqueueSnackbar: vi.fn(),
}));

import { enqueueSnackbar } from "notistack";
import { createApiFunction } from "api-calls/createApiFunction";

// Seam under test: the same createApiFunction contract, but with a working
// enqueueSnackbar (as when a SnackbarProvider is mounted in production).
// The error toast must still be shown and the caller must still get the
// rejection.
describe("createApiFunction with a SnackbarProvider", () => {
  it("shows the error toast and still rejects with the original error", async () => {
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

    expect(enqueueSnackbar).toHaveBeenCalledWith("Something went wrong", {
      variant: "error",
      persist: true,
    });
  });
});
