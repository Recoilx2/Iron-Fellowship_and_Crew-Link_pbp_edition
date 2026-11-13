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
 * Private channels as people observe them (spec #9, ticket #112): a GM
 * creates a private channel for one member, the chosen member sees it, and
 * another member does not. The data-layer live tests prove the access rules
 * underneath; the browser only proves what each person sees on screen.
 *
 * The tests run in file order: creating the channel comes first, then the
 * two observations. Nothing here may skip: setup throws without a running
 * stack copy, so a misconfigured run fails instead of passing silently.
 */

test.describe("chat private channels", () => {
  let config: StackConfig;
  let campaignId: string;
  let gm: E2EPerson;
  let chosen: E2EPerson;
  let leftOut: E2EPerson;
  let people: E2EPerson[] = [];
  const channelName = `Harbor debt ${Date.now()}`;

  test.beforeAll(async () => {
    config = stackConfig();
    const stamp = Date.now().toString(36);
    gm = await createPerson(config, `e2e-gm-${stamp}`);
    chosen = await createPerson(config, `e2e-chosen-${stamp}`);
    leftOut = await createPerson(config, `e2e-leftout-${stamp}`);
    people = [gm, chosen, leftOut];
    campaignId = await createCampaignAs(gm, `E2E Private ${Date.now()}`);
    await joinCampaignAs(chosen, campaignId);
    await joinCampaignAs(leftOut, campaignId);
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

  test("a GM creates a private channel for one member", async ({ page }) => {
    await signInAs(page, config, gm, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await page.getByRole("button", { name: "New Private channel" }).click();
    await expect(
      page.getByRole("dialog").getByText("New private channel")
    ).toBeVisible();

    await page.getByRole("dialog").getByLabel("Name").fill(channelName);
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: chosen.tag })
      .check();
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

    await expect(
      page.getByRole("button", { name: `# ${channelName}` }).first()
    ).toBeVisible();
  });

  test("the chosen member sees the private channel", async ({ page }) => {
    await signInAs(page, config, chosen, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `# ${channelName}` }).first()
    ).toBeVisible();
  });

  test("another member does not see the private channel", async ({ page }) => {
    await signInAs(page, config, leftOut, campaignUrl(campaignId));

    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "# In character" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `# ${channelName}` })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /New .* channel/ })
    ).toHaveCount(0);
  });
});
