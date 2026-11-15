import { describe, expect, it } from "vitest";
import { BASE_ROUTES, basePaths, openPaths } from "routes";

describe("Rules route", () => {
  it("lives at /rules", () => {
    expect(basePaths[BASE_ROUTES.RULES]).toBe("/rules");
  });

  it("is for signed-in people only, so it is not an open path", () => {
    expect(openPaths).not.toContain("/rules");
  });
});
