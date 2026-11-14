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
 * Image attachments as people observe them (spec #9, ticket #28): a player
 * picks an image file in the composer, sees its preview, sends it with the
 * post, and the image shows inline in a second browser watching the same
 * channel. Validation and access rules behind the picker are covered by the
 * chat data-layer tests; the browser only proves what two members see on
 * screen.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

// A 1x1 PNG: small enough to inline, real enough to upload.
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("chat images", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Images ${Date.now()}`;
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

  test("a picked image arrives inline in a second browser", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await signInAs(playerPage, config, player, campaignUrl(campaignId));

      await expect(
        playerPage.getByRole("textbox", { name: /Post in #/ })
      ).toBeVisible();

      // The player picks an image and sees its preview above the text box.
      const text = `The map ${Date.now()}`;
      await playerPage
        .locator('input[aria-label="Attach images"]')
        .setInputFiles({
          name: "map.png",
          mimeType: "image/png",
          buffer: tinyPng,
        });
      await expect(
        playerPage.getByRole("img", { name: "map.png" })
      ).toBeVisible();

      await playerPage
        .getByRole("textbox", { name: /Post in #/ })
        .fill(text);
      await playerPage.getByRole("button", { name: "Send" }).click();

      // The image shows inline beside the text, live in both browsers.
      await expect(playerPage.getByText(text)).toBeVisible();
      await expect(
        playerPage.getByRole("img", { name: "Attached image 1" })
      ).toBeVisible();
      await expect(gmPage.getByText(text)).toBeVisible();
      await expect(
        gmPage.getByRole("img", { name: "Attached image 1" })
      ).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
