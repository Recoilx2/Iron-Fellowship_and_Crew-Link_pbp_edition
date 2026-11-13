import { describe, expect, it } from "vitest";

import { waitFor } from "api-calls/testing/liveHarness";

describe("waitFor", () => {
  it("awaits an async observe until it resolves non-null instead of returning the first tick", async () => {
    let polls = 0;
    const result = await waitFor(async () => {
      polls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return polls >= 3 ? "stored" : null;
    }, 5000);
    expect(result).toBe("stored");
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("keeps polling a sync observe until it returns non-null", async () => {
    let polls = 0;
    const result = await waitFor(() => {
      polls += 1;
      return polls >= 3 ? 42 : null;
    }, 5000);
    expect(result).toBe(42);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("times out instead of returning null when an async observe never resolves non-null", async () => {
    await expect(
      waitFor(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return null;
      }, 250)
    ).rejects.toThrow(/timed out/);
  });
});
