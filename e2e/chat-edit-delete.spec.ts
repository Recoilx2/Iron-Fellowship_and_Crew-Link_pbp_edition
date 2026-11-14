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
 * Edits and deletes as both sides observe them (spec #9, ticket #27): a
 * player fixes their post and both browsers show the new text with an
 * edited marker, then the GM deletes it and both browsers keep a "post
 * deleted" marker where the content was. The access rules behind the
 * controls are covered by the chat data-layer live tests; the browser only
 * proves what two members see on screen.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat post edits and deletes", () => {
  let config: StackConfig;
  let gm: E2EPerson;
  let player: E2EPerson;
  let people: E2EPerson[] = [];
  let campaignId: string;

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    people = [gm, player];
  });

  test.beforeEach(async () => {
    campaignId = await createCampaignAs(gm, `E2E Edits ${Date.now()}`, "co-op");
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

  test.afterEach(async () => {
    if (campaignId) {
      await deleteCampaignAsAdmin(config, campaignId).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await Promise.all(
      people.map((person) =>
        deletePerson(config, person.userId).catch(() => {})
      )
    );
    people = [];
  });

  test("an edit marks the post edited in both browsers", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await expect(
        playerPage.getByRole("tab", { name: "Chat" })
      ).toBeVisible();

      // The player posts; both browsers show the post.
      const text = `Draft ${Date.now()}`;
      await playerPage
        .getByRole("textbox", { name: /Post in #/ })
        .fill(text);
      await playerPage.getByRole("button", { name: "Send" }).click();
      await expect(
        playerPage.getByText(text, { exact: true })
      ).toBeVisible();
      await expect(gmPage.getByText(text, { exact: true })).toBeVisible();

      // The player fixes the post; both browsers show the new text with
      // an edited marker, and the old text is gone.
      const fixed = `Fixed ${Date.now()}`;
      await playerPage.getByRole("button", { name: "Edit post" }).click();
      await playerPage.getByLabel("Edit post text").fill(fixed);
      await playerPage.getByRole("button", { name: "Save edit" }).click();

      await expect(
        playerPage.getByText(fixed, { exact: true })
      ).toBeVisible();
      await expect(playerPage.getByText("(edited)")).toBeVisible();
      await expect(gmPage.getByText(fixed, { exact: true })).toBeVisible();
      await expect(gmPage.getByText("(edited)")).toBeVisible();
      await expect(
        playerPage.getByText(text, { exact: true })
      ).toBeHidden();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });

  test("a GM delete leaves a deleted marker in both browsers", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await expect(
        playerPage.getByRole("tab", { name: "Chat" })
      ).toBeVisible();

      // The player posts; both browsers show the post.
      const text = `Take this back ${Date.now()}`;
      await playerPage
        .getByRole("textbox", { name: /Post in #/ })
        .fill(text);
      await playerPage.getByRole("button", { name: "Send" }).click();
      await expect(
        playerPage.getByText(text, { exact: true })
      ).toBeVisible();
      await expect(gmPage.getByText(text, { exact: true })).toBeVisible();

      // The GM deletes the player's post; both browsers keep a deleted
      // marker where the content was.
      await gmPage.getByRole("button", { name: "Delete post" }).click();
      await gmPage.getByRole("button", { name: "Confirm delete" }).click();

      await expect(gmPage.getByText("post deleted")).toBeVisible();
      await expect(playerPage.getByText("post deleted")).toBeVisible();
      await expect(
        gmPage.getByText(text, { exact: true })
      ).toBeHidden();
      await expect(
        playerPage.getByText(text, { exact: true })
      ).toBeHidden();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
