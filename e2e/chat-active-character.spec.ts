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
 * The active character (spec #9, ticket #127): a player retires their
 * character, adds a new one, posts in character as the new one, then makes
 * the old one active again and posts as them. The Characters screen groups
 * each player's characters with the active one on top and offers Retire
 * and Make active; the chat composer always speaks as the active
 * character.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("active character", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Active Character ${Date.now()}`;
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
    // The player's first campaign character: the insert defaults to
    // active, so the IC composer posts as them.
    const { error: kiraError } = await player.client
      .from("characters")
      .insert({
        owner_id: player.userId,
        name: "E2E Kira",
        campaign_id: campaignId,
      });
    if (kiraError) {
      throw new Error(
        `e2e: could not create player character: ${kiraError.message}`
      );
    }
    // The replacement waits offstage: adding it through the Characters
    // screen retires whoever is active.
    const { error: sableError } = await player.client
      .from("characters")
      .insert({ owner_id: player.userId, name: "E2E Sable" });
    if (sableError) {
      throw new Error(
        `e2e: could not create replacement character: ${sableError.message}`
      );
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

  test("retire, add new, post as new, then make the old one active again", async ({
    browser,
  }) => {
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(playerPage, config, player, campaignUrl(campaignId));
      await expect(
        playerPage.getByRole("tab", { name: "Characters" })
      ).toBeVisible();

      // The player retires their active character from the Characters
      // screen.
      await playerPage.getByRole("tab", { name: "Characters" }).click();
      await expect(playerPage.getByText("E2E Kira").first()).toBeVisible();
      await playerPage
        .getByRole("button", { name: "Retire: E2E Kira" })
        .click();
      await expect(
        playerPage.getByRole("button", { name: "Make active: E2E Kira" })
      ).toBeVisible();

      // Adding the replacement makes it active; posting in character
      // speaks as the new character.
      await playerPage
        .getByRole("button", { name: "Add a Character" })
        .click();
      await playerPage.getByRole("button", { name: "Select" }).click();
      // The dialog closes once the link lands; the tab behind it is only
      // clickable afterwards.
      await expect(playerPage.getByRole("dialog")).toBeHidden();
      await playerPage.getByRole("tab", { name: "Chat" }).click();
      await expect(
        playerPage.getByText("Posting as E2E Sable")
      ).toBeVisible();
      const firstText = `Sable takes point ${Date.now()}`;
      await playerPage
        .getByRole("textbox", { name: /Post in #/ })
        .fill(firstText);
      await playerPage.getByRole("button", { name: "Send" }).click();
      await expect(playerPage.getByText(firstText)).toBeVisible();
      await expect(playerPage.getByText("E2E Sable").first()).toBeVisible();

      // Making the old character active again retires the replacement:
      // the composer speaks as Kira once more.
      await playerPage.getByRole("tab", { name: "Characters" }).click();
      await playerPage
        .getByRole("button", { name: "Make active: E2E Kira" })
        .click();
      await expect(
        playerPage.getByRole("button", { name: "Retire: E2E Kira" })
      ).toBeVisible();
      await playerPage.getByRole("tab", { name: "Chat" }).click();
      await expect(playerPage.getByText("Posting as E2E Kira")).toBeVisible();
      const secondText = `Kira is back ${Date.now()}`;
      await playerPage
        .getByRole("textbox", { name: /Post in #/ })
        .fill(secondText);
      await playerPage.getByRole("button", { name: "Send" }).click();
      await expect(playerPage.getByText(secondText)).toBeVisible();
      await expect(playerPage.getByText("E2E Kira").first()).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
    }
  });
});
