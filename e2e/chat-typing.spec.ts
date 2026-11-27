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
 * Typing presence as two members observe it (ticket #204). The player
 * tracks presence on the chat channel's topic; the GM's browser resolves
 * the uid to a display name and shows it, then clears it on blur and send.
 * The player never sees their own name. Unit tests cover the throttle,
 * idle timeout and reader filter; the browser only proves what people see.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat typing indicators", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Typing ${Date.now()}`;
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

  test("another member sees typing, and blur or sending clears it", async ({
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
      await expect(
        playerPage.getByRole("button", { name: "# In character" }).first()
      ).toBeVisible();

      const gmIndicator = gmPage.getByTestId("typing-indicator");
      const playerIndicator = playerPage.getByTestId("typing-indicator");
      const composer = playerPage.getByRole("textbox", { name: /Post in #/ });
      await expect(gmIndicator).toHaveText("");

      // A half-written post: the GM sees the player typing within ten
      // seconds, while the player sees no indicator for themselves.
      const halfPost = `still thinking ${Date.now()}`;
      await composer.fill(halfPost);
      await expect(gmIndicator).toContainText("e2e-player is typing…", {
        timeout: 10_000,
      });
      await expect(playerIndicator).toHaveText("");

      // Leaving the text field clears presence without sending anything.
      await composer.press("Tab");
      await expect(gmIndicator).toHaveText("", { timeout: 10_000 });
      await expect(composer).toHaveValue(halfPost);

      // Typing again and sending clears it on the write, not on the idle
      // timeout: the GM never keeps seeing someone who has already posted.
      const text = `we push on ${Date.now()}`;
      await composer.fill(text);
      await expect(gmIndicator).toContainText("e2e-player is typing…", {
        timeout: 10_000,
      });
      await playerPage.getByRole("button", { name: "Send" }).click();

      await expect(gmIndicator).toHaveText("", { timeout: 10_000 });
      await expect(playerIndicator).toHaveText("");
      await expect(gmPage.getByText(text)).toBeVisible();
    } finally {
      await playerContext.close().catch(() => {});
      await gmContext.close().catch(() => {});
    }
  });
});
