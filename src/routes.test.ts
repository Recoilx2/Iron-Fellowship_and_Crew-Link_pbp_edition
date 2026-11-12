import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the circular import between `routes` and
 * `pages/Homebrew/routes` (via `getEditorInviteUrl`'s invite-path import):
 * loading the Homebrew page routes first evaluated `routes.ts` against a
 * half-initialized module and crashed with
 * `TypeError: Cannot read properties of undefined (reading 'EDITOR')`.
 */
describe("route table", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("loads the Homebrew page routes first without a circular-import crash", async () => {
    const homebrewRoutes = await import("pages/Homebrew/routes");
    expect(
      homebrewRoutes.homebrewPaths[homebrewRoutes.HOMEBREW_ROUTES.EDITOR]
    ).toBe(":homebrewId");
  });

  it("exposes the editor path as openly reachable", async () => {
    const { openPaths } = await import("routes");
    expect(openPaths).toContain("/homebrew/:homebrewId");
  });
});
