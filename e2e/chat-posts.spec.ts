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
 * Text posts as people observe them (spec #9, ticket #26): a player posts
 * in character from the chat composer, and the post arrives live in a
 * second browser watching the same channel. The speaker rules behind the
 * composer are covered by the chat data-layer live tests; the browser only
 * proves what two members see on screen.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat text posts", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Posts ${Date.now()}`;
  let gm: E2EPerson;
  let player: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    people = [gm, player];
    campaignId = await createCampaignAs(gm, campaignName);
    await joinCampaignAs(player, campaignId);
    // The player's one campaign character: the IC composer posts as them.
    const { error } = await player.client.from("characters").insert({
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

  test("a text post arrives live in a second browser", async ({ browser }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      // Both browsers rest on the Chat tab with the starting channels.
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await expect(
        playerPage.getByRole("tab", { name: "Chat" })
      ).toBeVisible();
      await expect(
        playerPage.getByRole("button", { name: "# In character" }).first()
      ).toBeVisible();

      // The player posts in character; the GM's browser shows it live with
      // its speaker and text.
      const text = `The lantern is still lit ${Date.now()}`;
      await playerPage
        .getByRole("textbox", { name: /Message #/ })
        .fill(text);
      await playerPage.getByRole("button", { name: "Send" }).click();

      await expect(playerPage.getByText(text)).toBeVisible();
      await expect(playerPage.getByText("E2E Kira").first()).toBeVisible();
      await expect(gmPage.getByText(text)).toBeVisible();
      await expect(gmPage.getByText("E2E Kira").first()).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
