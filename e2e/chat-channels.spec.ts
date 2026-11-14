import { test, expect } from "@playwright/test";
import {
  campaignUrl,
  createCampaignAs,
  createPerson,
  deleteCampaignAsAdmin,
  deletePerson,
  joinCampaignAs,
  signInAs,
  stackConfig,
  type E2EPerson,
  type StackConfig,
} from "./fixtures";

/**
 * Chat tab as people observe it (spec #9, ticket #25): opening a campaign
 * lands on the Chat tab with the starting IC and OOC channels, and players
 * see no channel-management controls. GM creates, renames and archives are
 * covered by the chat data-layer live tests; the browser only proves what a
 * member sees on screen.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat channels", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Chat ${Date.now()}`;
  let player: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    const gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    people = [gm, player];
    campaignId = await createCampaignAs(gm, campaignName);
    await joinCampaignAs(player, campaignId);
  });

  test.afterAll(async () => {
    if (campaignId) {
      await deleteCampaignAsAdmin(config, campaignId).catch(() => {});
    }
    await Promise.all(
      people.map((person) =>
        deletePerson(config, person.userId).catch(() => {})
      )
    );
    people = [];
  });

  test("a member opens a campaign on the Chat tab with its starting channels", async ({
    page,
  }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "# In character" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "# Out of character" }).first()
    ).toBeVisible();
  });

  test("a player sees no channel-management controls", async ({ page }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /New .* channel/ })
    ).toHaveCount(0);
  });
});
