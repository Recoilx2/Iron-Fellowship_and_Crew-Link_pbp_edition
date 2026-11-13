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
    campaignId = await createCampaignAs(gm, campaignName, "co-op");
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
        .getByRole("textbox", { name: /Post in #/ })
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

  test("an out-of-character post shows the display name and campaign character", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      await expect(playerPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      // Both browsers move to the starting out-of-character channel.
      await playerPage
        .getByRole("button", { name: "# Out of character" })
        .first()
        .click();
      await gmPage
        .getByRole("button", { name: "# Out of character" })
        .first()
        .click();

      // The player posts as themselves: the name line leads with their
      // display name, then their campaign character beside it.
      const playerText = `brb, consulting the map ${Date.now()}`;
      await playerPage
        .getByRole("textbox", { name: /Post in #/ })
        .fill(playerText);
      await playerPage.getByRole("button", { name: "Send" }).click();

      const playerFeed = playerPage.locator(
        '[aria-label="Posts in # Out of character"]'
      );
      await expect(playerFeed.getByText(playerText)).toBeVisible();
      await expect(playerFeed.getByText("e2e-player")).toBeVisible();
      await expect(playerFeed.getByText("E2E Kira")).toBeVisible();
      const gmFeed = gmPage.locator(
        '[aria-label="Posts in # Out of character"]'
      );
      await expect(gmFeed.getByText(playerText)).toBeVisible();
      await expect(gmFeed.getByText("e2e-player")).toBeVisible();
      await expect(gmFeed.getByText("E2E Kira")).toBeVisible();

      // The GM posts as themselves: display name with a GM tag beside it.
      const gmText = `Ruling: the map is wrong ${Date.now()}`;
      await gmPage.getByRole("textbox", { name: /Post in #/ }).fill(gmText);
      await gmPage.getByRole("button", { name: "Send" }).click();

      await expect(gmFeed.getByText(gmText)).toBeVisible();
      await expect(gmFeed.getByText("e2e-gm")).toBeVisible();
      await expect(
        gmFeed.getByText("GM", { exact: true }).first()
      ).toBeVisible();
      await expect(playerFeed.getByText(gmText)).toBeVisible();
      await expect(
        playerFeed.getByText("GM", { exact: true }).first()
      ).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });

  test("a GM post as a world NPC shows the NPC with a GM tag", async ({
    browser,
  }) => {
    // The campaign links a world with an NPC the GM can voice. The world id
    // is generated here so the insert needs no RETURNING clause: the worlds
    // SELECT policy re-queries its own table, which cannot see a
    // just-inserted row in the same statement, so insert-then-select always
    // fails RLS (#69).
    const worldId = crypto.randomUUID();
    const { error: worldError } = await gm.client.from("worlds").insert({
      id: worldId,
      name: "E2E Bog realm",
      owner_ids: [gm.userId],
    });
    if (worldError) {
      throw new Error(`e2e: could not create world: ${worldError.message}`);
    }
    const { error: linkError } = await gm.client
      .from("campaigns")
      .update({ world_id: worldId })
      .eq("id", campaignId);
    if (linkError) {
      throw new Error(`e2e: could not link world: ${linkError.message}`);
    }
    const { error: npcError, data: npc } = await gm.client
      .from("world_npcs")
      .insert({ world_id: worldId, name: "E2E Elder" })
      .select("id")
      .single();
    if (npcError || !npc) {
      throw new Error(`e2e: could not create NPC: ${npcError?.message}`);
    }

    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await expect(playerPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      // The GM picks the NPC voice; the player has no picker at all.
      const voice = gmPage.getByLabel("Posting as");
      await expect(voice).toContainText("E2E Elder");
      await voice.selectOption({ label: "E2E Elder" });
      await expect(gmPage.getByText("Posting as E2E Elder")).toBeVisible();
      await expect(playerPage.getByLabel("Posting as")).toHaveCount(0);

      const text = `The bog remembers ${Date.now()}`;
      await gmPage.getByRole("textbox", { name: /Post in #/ }).fill(text);
      await gmPage.getByRole("button", { name: "Send" }).click();

      // Both browsers show the NPC as speaker with a GM tag beside it.
      await expect(gmPage.getByText("E2E Elder").first()).toBeVisible();
      await expect(gmPage.getByText(text, { exact: true })).toBeVisible();
      await expect(
        gmPage.getByText("GM", { exact: true }).first()
      ).toBeVisible();
      await expect(playerPage.getByText("E2E Elder").first()).toBeVisible();
      await expect(playerPage.getByText(text, { exact: true })).toBeVisible();
      await expect(
        playerPage.getByText("GM", { exact: true }).first()
      ).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
