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
 * Rolling from the chat composer (spec #9, ticket #29): a player rolls
 * dice into the draft, adds text, and sends both to the channel, where the
 * roll posts as a dark one-liner that expands the existing roll card. A
 * GM's eye-toggle hides their rolls from players. The speaker and access
 * rules behind the composer are covered by the chat data-layer live tests;
 * the browser proves what two members see on screen.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat rolls from the composer", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Rolls ${Date.now()}`;
  let gm: E2EPerson;
  let player: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    people = [gm, player];
    // Co-op makes the founder a GM, which the eye toggle needs.
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

  test("a dice roll attaches to the draft and posts as a one-liner", async ({
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
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      await expect(
        playerPage.getByRole("tab", { name: "Chat" })
      ).toBeVisible();

      // The roll buttons sit under the text box, players first.
      await expect(
        playerPage.getByRole("button", { name: "Dice", exact: true })
      ).toBeVisible();

      // A dice roll attaches to the draft instead of posting at once.
      await playerPage
        .getByRole("button", { name: "Dice", exact: true })
        .click();
      await expect(
        playerPage.getByRole("dialog", { name: "Roll dice" })
      ).toBeVisible();
      await playerPage.getByLabel("Or type it").fill("1d6");
      await playerPage.getByRole("button", { name: "Roll 1d6" }).click();
      await expect(
        playerPage.getByRole("dialog", { name: "Roll dice" })
      ).toHaveCount(0);
      await expect(
        playerPage.getByText("Rolled. Add text, then send.")
      ).toBeVisible();

      // The player adds text and sends both as the current speaker.
      const text = `For the road ${Date.now()}`;
      await playerPage.getByRole("textbox", { name: /Post in #/ }).fill(text);
      await playerPage.getByRole("button", { name: "Send" }).click();

      // The roll posts as a dark one-liner beside its title, live in both
      // browsers, and expands the existing roll card on tap.
      const oneLiner = playerPage.getByRole("button", {
        name: /^1d6: \d+ \(\d+\)$/,
      });
      await expect(oneLiner).toBeVisible();
      await expect(playerPage.getByText(text)).toBeVisible();
      await expect(
        gmPage.getByRole("button", { name: /^1d6: \d+ \(\d+\)$/ })
      ).toBeVisible();
      await expect(gmPage.getByText(text)).toBeVisible();
      await expect(gmPage.getByText("E2E Kira").first()).toBeVisible();

      await oneLiner.click();
      await expect(oneLiner).toHaveAttribute("aria-expanded", "true");
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });

  test("a GM-only roll never reaches players", async ({ browser }) => {
    const gmContext = await browser.newContext({ reducedMotion: "reduce" });
    const playerContext = await browser.newContext({
      reducedMotion: "reduce",
    });
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      // The GM closes the eye: their rolls post GM-only from now on.
      await gmPage
        .getByRole("button", { name: "Hide my rolls from players" })
        .click();
      await expect(
        gmPage.getByRole("button", { name: "Show my rolls to players" })
      ).toBeVisible();

      await gmPage
        .getByRole("button", { name: "Dice", exact: true })
        .click();
      await gmPage.getByLabel("Or type it").fill("2d6");
      await gmPage.getByRole("button", { name: "Roll 2d6" }).click();
      await expect(
        gmPage.getByText("Rolled. Add text, then send.")
      ).toBeVisible();

      const secret = `secret stash ${Date.now()}`;
      await gmPage.getByRole("textbox", { name: /Post in #/ }).fill(secret);
      await gmPage.getByRole("button", { name: "Send" }).click();

      // The GM sees their own secret roll post.
      await expect(
        gmPage.getByRole("button", { name: /^2d6: \d+ \(.+\)(, GM only)?$/ })
      ).toBeVisible();
      await expect(gmPage.getByText(secret, { exact: true })).toBeVisible();

      // Past live delivery, the player still sees neither the roll nor a
      // trace of its text.
      await playerPage.waitForTimeout(3000);
      await expect(playerPage.getByText(secret)).toHaveCount(0);
      await expect(
        playerPage.getByRole("button", { name: /^2d6:/ })
      ).toHaveCount(0);
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
