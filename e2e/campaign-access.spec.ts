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
 * Campaign access as people observe it (spec #9, ticket #107): a signed-in
 * player opens a campaign they belong to and sees its screen, while an
 * outsider is told the campaign cannot be found. Chat tickets build on this
 * harness with a browser test for their own main flow.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("campaign access", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Campaign ${Date.now()}`;
  let player: E2EPerson;
  let outsider: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    const gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    outsider = await createPerson(config, "e2e-outsider");
    people = [gm, player, outsider];
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

  test("a member opens a campaign they belong to and sees its screen", async ({
    page,
  }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));

    await expect(
      page.getByRole("heading", { name: campaignName })
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Characters" })).toBeVisible();
  });

  test("an outsider cannot open a campaign they do not belong to", async ({
    page,
  }) => {
    await signInAs(page, config, outsider, campaignUrl(campaignId));

    await expect(
      page.getByRole("heading", { name: "Campaign not Found" })
    ).toBeVisible();
  });
});
