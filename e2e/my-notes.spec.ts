import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
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
 * My notes as a player observes it (spec #9, tickets #31 and #122): from
 * the chat screen, My notes opens in one step at every width -- a side-pane
 * tab on desktop and mid widths, a bottom-tab on phones -- showing only the
 * player's own notes, private and shared. The shared roll log is never part
 * of My notes, and the campaign's Notes screen is My notes too. Phones show
 * one campaign navigation (the bottom bar), not the top tab strip as well.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently. Note-level filtering
 * (mine versus someone else's) is covered by the component tests; the
 * browser proves one-step reachability and that the shared roll log stays
 * out.
 */

test.describe("my notes", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E My Notes ${Date.now()}`;
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

  async function openSideNotes(page: Page) {
    const sideScreens = page.getByRole("tablist", {
      name: "Chat side screens",
    });
    const myNotesTab = sideScreens.getByRole("tab", {
      name: "My notes",
      exact: true,
    });
    await expect(myNotesTab).toBeVisible();
    await myNotesTab.click();

    await expect(page.getByText("Campaign Notes")).toBeVisible();
    await expect(page.getByText("Roll Log")).toHaveCount(0);
  }

  test("a member opens My notes from the chat side screens on desktop", async ({
    page,
  }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await openSideNotes(page);
  });

  test("a member opens My notes from the chat side screens at mid widths", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await openSideNotes(page);
  });

  test("the campaign Notes screen is My notes", async ({ page }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));

    const sections = page.getByRole("tablist", { name: "Campaign sections" });
    const notesTab = sections.getByRole("tab", {
      name: "My notes",
      exact: true,
    });
    await expect(notesTab).toBeVisible();
    await notesTab.click();

    await expect(page.getByText("Campaign Notes")).toBeVisible();
    await expect(page.getByText("Roll Log")).toHaveCount(0);
  });

  test("a member opens My notes from the bottom navigation on phones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, config, player, campaignUrl(campaignId));

    // One campaign navigation on phones: the top tab strip stays out of
    // the way and the bottom bar carries Chat and My notes.
    await expect(
      page.getByRole("tab", { name: "Chat", exact: true })
    ).not.toBeVisible();
    const myNotesAction = page.getByRole("button", {
      name: "My notes",
      exact: true,
    });
    await expect(myNotesAction).toBeVisible();
    await myNotesAction.click();

    await expect(page.getByText("Campaign Notes")).toBeVisible();
    await expect(page.getByText("Roll Log")).toHaveCount(0);
  });

  test("a member reaches Locations, NPCs and Lore from the phone World screen", async ({
    page,
  }) => {
    // Link a world with one entry per section, the way the app does (the
    // worlds SELECT policy re-queries its own table, so insert with a
    // pre-generated id, #69). Entries stay shared so the player sees them.
    const worldId = crypto.randomUUID();
    const { error: worldError } = await gm.client.from("worlds").insert({
      id: worldId,
      name: "E2E Harbor world",
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
    const locationName = `E2E Harbor ${Date.now()}`;
    const { error: locationError } = await gm.client
      .from("world_locations")
      .insert({ world_id: worldId, name: locationName });
    if (locationError) {
      throw new Error(
        `e2e: could not create location: ${locationError.message}`
      );
    }
    const npcName = `E2E Elder ${Date.now()}`;
    const { error: npcError } = await gm.client
      .from("world_npcs")
      .insert({ world_id: worldId, name: npcName });
    if (npcError) {
      throw new Error(`e2e: could not create NPC: ${npcError.message}`);
    }
    const loreName = `E2E Oath ${Date.now()}`;
    const { error: loreError } = await gm.client
      .from("world_lore")
      .insert({ world_id: worldId, name: loreName });
    if (loreError) {
      throw new Error(`e2e: could not create lore: ${loreError.message}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, config, player, campaignUrl(campaignId));

    const worldAction = page.getByRole("button", {
      name: "World",
      exact: true,
    });
    await expect(worldAction).toBeVisible();
    await worldAction.click();

    // One step down from the phone World screen: each section opens from
    // the World sections sub-tabs and shows its entry.
    const sections = page.getByRole("tablist", { name: "World sections" });
    await expect(
      sections.getByRole("tab", { name: "World", exact: true })
    ).toBeVisible();

    await sections.getByRole("tab", { name: "Locations" }).click();
    await expect(page.getByText(locationName)).toBeVisible();

    await sections.getByRole("tab", { name: "NPCs" }).click();
    await expect(page.getByText(npcName)).toBeVisible();

    await sections.getByRole("tab", { name: "Lore" }).click();
    await expect(page.getByText(loreName)).toBeVisible();

    await sections.getByRole("tab", { name: "World", exact: true }).click();
    await expect(page.getByText("E2E Harbor world")).toBeVisible();
  });
});
