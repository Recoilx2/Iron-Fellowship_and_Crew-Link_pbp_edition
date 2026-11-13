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
 * Rolls made elsewhere in a campaign land in chat (spec #9, ticket #30):
 * a player rolls custom dice from their character sheet, and the roll
 * posts to the campaign's starting IC channel as their character, where
 * the GM sees it live. The sheet's own roll log stays for solo
 * characters; here the sheet belongs to a campaign, so its rolls post.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("sheet rolls land in the starting IC channel", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Sheet Rolls ${Date.now()}`;
  let gm: E2EPerson;
  let player: E2EPerson;
  let people: E2EPerson[] = [];
  let kiraId: string;

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    people = [gm, player];
    // Co-op makes the founder a GM, which the campaign needs.
    campaignId = await createCampaignAs(gm, campaignName, "co-op");
    await joinCampaignAs(player, campaignId);
    // The player's one campaign character: the starting IC channel posts
    // sheet rolls as them. The id is generated here so the insert needs no
    // RETURNING clause: the characters SELECT policy re-queries its own
    // table, which cannot see a just-inserted row in the same statement, so
    // insert-then-select always fails RLS (#69).
    kiraId = crypto.randomUUID();
    const { error } = await player.client.from("characters").insert({
      id: kiraId,
      owner_id: player.userId,
      name: "E2E Kira",
      campaign_id: campaignId,
    });
    if (error) {
      throw new Error(`e2e: could not create player character: ${error.message}`);
    }
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

  test("a custom dice roll from the sheet posts as the character", async ({
    browser,
  }) => {
    // Reduced motion skips the 3D dice, so rolls resolve immediately.
    const gmContext = await browser.newContext({ reducedMotion: "reduce" });
    const playerContext = await browser.newContext({
      reducedMotion: "reduce",
    });
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(
        playerPage,
        config,
        player,
        `/characters/${kiraId}?tab=notes`
      );

      // The sheet's roll log sits behind the Notes sidebar; its footer
      // rolls the dice.
      await expect(
        playerPage.getByRole("tab", { name: "Notes" })
      ).toBeVisible();
      await playerPage.getByText("Roll Log").click();
      await playerPage
        .getByRole("button", { name: "Roll Dice" })
        .click();
      await expect(
        playerPage.getByText("Custom Dice Roll")
      ).toBeVisible();
      await playerPage
        .getByRole("button", { name: "Roll", exact: true })
        .click();

      // The roll lands in the starting IC channel as the character, live
      // for a GM already reading chat.
      await playerPage.goto(campaignUrl(campaignId));
      const oneLiner = playerPage.getByRole("button", {
        name: /^1d6: \d+ \(\d+\)$/,
      });
      await expect(oneLiner).toBeVisible();
      await expect(playerPage.getByText("E2E Kira").first()).toBeVisible();
      await expect(
        gmPage.getByRole("button", { name: /^1d6: \d+ \(\d+\)$/ })
      ).toBeVisible();
      await expect(gmPage.getByText("E2E Kira").first()).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
