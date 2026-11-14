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
 * Burning momentum on a posted chat roll (spec #9, ticket #125): the
 * author's own action roll offers a burn when momentum would lift it, and
 * the burned outcome arrives live for everyone. The dice, the burn rule
 * and the access rules behind the button are covered by the unit and live
 * data-layer tests; the browser proves two members see the update.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat momentum burn on a posted roll", () => {
  let config: StackConfig;
  let campaignId: string;
  const campaignName = `E2E Burn ${Date.now()}`;
  let gm: E2EPerson;
  let player: E2EPerson;
  let other: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, "e2e-gm");
    player = await createPerson(config, "e2e-player");
    other = await createPerson(config, "e2e-other");
    people = [gm, player, other];
    campaignId = await createCampaignAs(gm, campaignName, "co-op");
    await joinCampaignAs(player, campaignId);
    await joinCampaignAs(other, campaignId);

    // The player's campaign character with momentum to burn. The id is
    // generated here so the insert needs no RETURNING clause: the
    // characters SELECT policy re-queries its own table, which cannot see
    // a just-inserted row in the same statement, so insert-then-select
    // always fails RLS (#69).
    const kiraId = crypto.randomUUID();
    const { error: charError } = await player.client
      .from("characters")
      .insert({
        id: kiraId,
        owner_id: player.userId,
        name: "E2E Kira",
        campaign_id: campaignId,
        momentum: 5,
      });
    if (charError) {
      throw new Error(
        `e2e: could not create player character: ${charError.message}`
      );
    }

    // The starting IC channel.
    const { data: channelData, error: channelError } = await gm.client
      .from("chat_channels")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "IC")
      .eq("is_starting", true)
      .single();
    if (channelError || !channelData) {
      throw new Error(
        `e2e: no starting IC channel: ${channelError?.message}`
      );
    }
    const icChannelId = (channelData as { id: string }).id;

    // A posted miss the burn will lift: action 2 vs 3 and 8, momentum 5
    // beats 3 but not 8, so a miss becomes a weak hit.
    const { data: postData, error: postError } = await player.client
      .from("chat_posts")
      .insert({
        id: crypto.randomUUID(),
        channel_id: icChannelId,
        author_id: player.userId,
        speaker_character_id: kiraId,
        text: "Kira dives for cover.",
        roll: {
          type: 0,
          rollLabel: "Edge",
          moveName: "Face Danger",
          action: 2,
          challenge1: 3,
          challenge2: 8,
          result: 2,
          timestamp: new Date().toISOString(),
          characterId: kiraId,
          uid: player.userId,
          gmsOnly: false,
        },
        gms_only: false,
      })
      .select("id")
      .single();
    if (postError || !postData) {
      throw new Error(`e2e: could not post roll: ${postError?.message}`);
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

  test("a player burns momentum on a posted roll, and a second browser sees the update", async ({
    browser,
  }) => {
    const playerContext = await browser.newContext({ reducedMotion: "reduce" });
    const otherContext = await browser.newContext({ reducedMotion: "reduce" });
    const playerPage = await playerContext.newPage();
    const otherPage = await otherContext.newPage();
    try {
      await signInAs(playerPage, config, player, campaignUrl(campaignId));
      await signInAs(otherPage, config, other, campaignUrl(campaignId));

      await expect(
        playerPage.getByRole("tab", { name: "Chat" })
      ).toBeVisible();

      // The posted miss reads as a weak-hit-to-be: action 2 vs 3, 8.
      const playerOneLiner = playerPage.getByRole("button", {
        name: /^Face Danger:.*Miss.*2 vs 3, 8/,
      });
      await expect(playerOneLiner).toBeVisible();
      const otherOneLiner = otherPage.getByRole("button", {
        name: /^Face Danger:.*Miss.*2 vs 3, 8/,
      });
      await expect(otherOneLiner).toBeVisible();

      // The author expands the roll and burns momentum on it.
      await playerOneLiner.click();
      await expect(playerOneLiner).toHaveAttribute("aria-expanded", "true");
      await playerPage.getByRole("button", { name: "Burn momentum" }).click();

      // The burned outcome arrives live in both browsers: momentum 5
      // replaces the action total, so the miss becomes a weak hit.
      await expect(
        playerPage.getByRole("button", {
          name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/,
        })
      ).toBeVisible();
      await expect(
        otherPage.getByRole("button", {
          name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/,
        })
      ).toBeVisible();

      // Nobody else is offered the burn on the author's roll. The burn
      // rewrote the one-liner (Miss became Weak Hit), so the pre-burn Miss
      // locator above no longer matches; target the burned roll instead.
      const otherBurnedOneLiner = otherPage.getByRole("button", {
        name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/,
      });
      await otherBurnedOneLiner.click();
      await expect(otherBurnedOneLiner).toHaveAttribute(
        "aria-expanded",
        "true"
      );
      await expect(
        otherPage.getByRole("button", { name: "Burn momentum" })
      ).toHaveCount(0);
    } finally {
      await playerContext.close().catch(() => {});
      await otherContext.close().catch(() => {});
    }
  });
});
