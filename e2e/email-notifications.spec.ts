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
 * Chat email preferences as a member observes them (ticket #203): the
 * global switch in User Settings, the per-channel switch in the channel
 * header, and an email-style deep link landing on a post far outside the
 * live window. The live test covers the SMTP path and the access rules;
 * the browser only proves the controls and the landing work end to end.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat email notifications", () => {
  let config: StackConfig;
  let campaignId: string;
  let player: E2EPerson;
  let icId: string;
  let oldestPostId = "";
  let people: E2EPerson[] = [];
  const stamp = Date.now().toString(36);

  test.beforeAll(async () => {
    config = stackConfig();
    const gm = await createPerson(config, `e2e-mail-gm-${stamp}`);
    player = await createPerson(config, `e2e-mail-player-${stamp}`);
    people = [gm, player];
    campaignId = await createCampaignAs(
      gm,
      `E2E Mail ${Date.now()}`,
      "co-op"
    );
    await joinCampaignAs(player, campaignId);

    const channels = await gm.client
      .from("chat_channels")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "IC")
      .eq("is_starting", true)
      .single();
    if (channels.error || !channels.data) {
      throw new Error(`e2e: no starting channel: ${channels.error?.message}`);
    }
    icId = (channels.data as { id: string }).id;

    // More posts than the live window, all stamped in the past, so the
    // linked post can only appear after jumpToPost fetches its context.
    const base = Date.now() - 60 * 60_000;
    for (let i = 0; i < 36; i += 1) {
      const id = crypto.randomUUID();
      const { error } = await player.client.from("chat_posts").insert({
        id,
        channel_id: icId,
        author_id: player.userId,
        text: `deep${stamp} ${String(i).padStart(2, "0")}`,
        created_at: new Date(base + i * 60_000).toISOString(),
      });
      if (error) {
        throw new Error(`e2e: could not seed a deep-link post: ${error.message}`);
      }
      if (i === 0) oldestPostId = id;
    }
    for (let i = 0; i < 5; i += 1) {
      const { error } = await player.client.from("chat_posts").insert({
        id: crypto.randomUUID(),
        channel_id: icId,
        author_id: player.userId,
        text: `recent${stamp} ${i}`,
      });
      if (error) {
        throw new Error(`e2e: could not seed a recent post: ${error.message}`);
      }
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

  async function globalSetting() {
    const { data } = await player.client
      .from("user_settings")
      .select("email_notifications_enabled")
      .eq("user_id", player.userId)
      .maybeSingle();
    return data?.email_notifications_enabled;
  }

  async function channelSetting() {
    const { data } = await player.client
      .from("chat_channel_email_prefs")
      .select("opted_in")
      .eq("user_id", player.userId)
      .eq("channel_id", icId)
      .maybeSingle();
    return data?.opted_in;
  }

  test("the global switch turns member email off and back on", async ({ page }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));
    await page.getByRole("button", { name: "User Settings" }).click();
    await page.getByRole("menuitem", { name: "Accessibility Settings" }).click();

    const toggle = page.getByRole("checkbox", {
      name: "Email me about new posts?",
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(() => globalSetting()).toBe(false);

    await toggle.check();
    await expect.poll(() => globalSetting()).toBe(true);
  });

  test("the channel switch opts in and out of one channel", async ({ page }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));
    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();

    const toggle = page.getByRole("checkbox", {
      name: "Email notifications for # In character",
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked(); // no row means no email
    await toggle.check();
    await expect.poll(() => channelSetting()).toBe(true);

    await toggle.uncheck();
    await expect.poll(() => channelSetting()).toBe(false);
  });

  test("an email link loads and highlights a post outside the live window", async ({
    page,
  }) => {
    await signInAs(
      page,
      config,
      player,
      `${campaignUrl(campaignId)}?tab=chat&channel=${icId}&post=${oldestPostId}`
    );

    // The store fetches the post's context before focusing it, so this row
    // arrives even though the initial live window holds only recent posts.
    const target = page.locator(`[id="post-${oldestPostId}"]`);
    await expect(target).toBeVisible();
    await expect(target).toContainText(`deep${stamp} 00`);
    await expect(target).toBeInViewport();
    await expect(target).toHaveAttribute("data-highlighted", "true");
  });
});
