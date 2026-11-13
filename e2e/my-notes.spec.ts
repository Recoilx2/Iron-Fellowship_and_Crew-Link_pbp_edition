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
 * My notes as a player observes it (spec #9, ticket #31): from the chat
 * screen, My notes opens in one step -- a right-pane tab on desktop, a
 * bottom-tab on phones -- showing only the player's own notes, private and
 * shared. The shared roll log is never part of My notes.
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
  let player: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    const gm = await createPerson(config, "e2e-gm");
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

  test("a member opens My notes from the chat right pane on desktop", async ({
    page,
  }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    const myNotesTab = page.getByRole("tab", {
      name: "My notes",
      exact: true,
    });
    await expect(myNotesTab).toBeVisible();
    await myNotesTab.click();

    await expect(page.getByText("Campaign Notes")).toBeVisible();
    await expect(page.getByText("Roll Log")).toHaveCount(0);
  });

  test("a member opens My notes from the bottom navigation on phones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    const myNotesAction = page.getByRole("button", {
      name: "My notes",
      exact: true,
    });
    await expect(myNotesAction).toBeVisible();
    await myNotesAction.click();

    await expect(page.getByText("Campaign Notes")).toBeVisible();
    await expect(page.getByText("Roll Log")).toHaveCount(0);
  });
});
