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
 * Campaign outline (spec #10, ticket #131): a GM writes the planned story
 * in the assistant panel's Outline tab with the same editor as other
 * notes, a co-GM sees it live, and a player in the same campaign can't
 * find it anywhere -- no Assistant button, nothing under My notes, and
 * nothing through the data layer.
 *
 * The Outline tab needs no model server: the panel's model fetch fails
 * against the pristine stack (the Chat tab says the assistant isn't set
 * up), and the outline still opens, saves and syncs. Nothing here may
 * skip: setup throws without a running stack copy, so a misconfigured
 * run fails instead of passing silently.
 */

test.describe("campaign outline", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Outline ${Date.now()}`;
  const outlineText = `E2E outline ${Date.now()} the bell rings twice`;
  let gm: E2EPerson;
  let coGm: E2EPerson;
  let player: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, "e2e-outline-gm");
    coGm = await createPerson(config, "e2e-outline-cogm");
    player = await createPerson(config, "e2e-outline-player");
    people = [gm, coGm, player];
    // Co-op: the founder starts as a GM, so they can promote the co-GM.
    campaignId = await createCampaignAs(gm, campaignName, "co-op");
    await joinCampaignAs(coGm, campaignId);
    await joinCampaignAs(player, campaignId);
    const { error: promoteError } = await gm.client
      .from("campaign_members")
      .update({ role: "gm" })
      .eq("campaign_id", campaignId)
      .eq("user_id", coGm.userId);
    if (promoteError) {
      throw new Error(`e2e: could not promote co-GM: ${promoteError.message}`);
    }
  });

  test.afterAll(async () => {
    if (campaignId) {
      await deleteCampaignAsAdmin(config, campaignId).catch(() => undefined);
    }
    await Promise.all(
      people.map((person) =>
        deletePerson(config, person.userId).catch(() => undefined)
      )
    );
    people = [];
  });

  async function openOutlineTab(page: Parameters<typeof signInAs>[0]) {
    await expect(
      page.getByRole("button", { name: "Assistant", exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Assistant", exact: true })
      .click();
    await expect(page.getByText("GM assistant")).toBeVisible();
    await page.getByRole("tab", { name: "Outline" }).click();
    await expect(
      page.getByText("GM-only. Never shared with players.")
    ).toBeVisible();
  }

  test("a GM writes the outline and a co-GM sees it live", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const coContext = await browser.newContext();
    try {
      const gmPage = await gmContext.newPage();
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await openOutlineTab(gmPage);

      const editor = gmPage.getByRole("textbox", { name: "Note text" });
      await expect(editor).toBeVisible();
      await editor.click();
      await gmPage.keyboard.type(outlineText);
      await expect(editor).toContainText(outlineText);

      // A co-GM opening the Outline tab sees the same text live through
      // the note server, without anything posted or shared.
      const coPage = await coContext.newPage();
      await signInAs(coPage, config, coGm, campaignUrl(campaignId));
      await expect(coPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await openOutlineTab(coPage);
      await expect(
        coPage.getByRole("textbox", { name: "Note text" })
      ).toContainText(outlineText);
    } finally {
      await gmContext.close().catch(() => undefined);
      await coContext.close().catch(() => undefined);
    }
  });

  test("a player in the same campaign can't find the outline anywhere", async ({
    browser,
  }) => {
    const playerContext = await browser.newContext();
    try {
      const playerPage = await playerContext.newPage();
      await signInAs(playerPage, config, player, campaignUrl(campaignId));
      await expect(playerPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      // No assistant at all for players.
      await expect(
        playerPage.getByRole("button", { name: "Assistant", exact: true })
      ).toHaveCount(0);
      await expect(playerPage.getByText("GM assistant")).toHaveCount(0);

      // Nothing under My notes: neither the outline text nor its title.
      const sections = playerPage.getByRole("tablist", {
        name: "Campaign sections",
      });
      await sections.getByRole("tab", { name: "My notes", exact: true }).click();
      await expect(playerPage.getByText("Campaign Notes")).toBeVisible();
      await expect(playerPage.getByText(outlineText)).toHaveCount(0);
      await expect(
        playerPage.getByText("Campaign outline")
      ).toHaveCount(0);

      // Nothing through the data layer either: the outline row and its
      // contents stay invisible to players.
      const { data: notes, error: notesError } = await player.client
        .from("campaign_notes")
        .select("id, title")
        .eq("campaign_id", campaignId);
      expect(notesError).toBeNull();
      expect(
        ((notes ?? []) as Array<{ id: string; title: string }>).some(
          (row) =>
            row.title.includes("Campaign outline") ||
            row.title.includes(outlineText)
        )
      ).toBe(false);
      const noteIds = ((notes ?? []) as Array<{ id: string }>).map(
        (row) => row.id
      );
      if (noteIds.length > 0) {
        const { data: contents, error: contentsError } = await player.client
          .from("campaign_note_contents")
          .select("note_id")
          .in("note_id", noteIds);
        expect(contentsError).toBeNull();
        expect(contents ?? []).toEqual([]);
      }
    } finally {
      await playerContext.close().catch(() => undefined);
    }
  });
});
