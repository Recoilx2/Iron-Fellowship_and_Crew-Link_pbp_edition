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
 * Search as people observe it (ticket #202, part of spec #200): a player
 * searches a long campaign, pages the results and jumps to a post in the
 * feed; private channels, DMs and GM-only posts reach only readers the
 * database rules allow. The live test covers the same rules at the data
 * layer; the browser only proves what each member sees and can click.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("chat post search", () => {
  let config: StackConfig;
  let campaignId: string;
  let gm: E2EPerson;
  let player: E2EPerson;
  let leftOut: E2EPerson;
  let people: E2EPerson[] = [];
  const stamp = Date.now().toString(36);
  const publicWord = `public${stamp}`;
  const privateWord = `private${stamp}`;
  const dmWord = `dm${stamp}`;
  const gmWord = `gmsecret${stamp}`;
  const pageWord = `page${stamp}`;
  const pageIds: string[] = [];

  async function postAs(
    person: E2EPerson,
    channelId: string,
    text: string,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await person.client.from("chat_posts").insert({
      id,
      channel_id: channelId,
      author_id: person.userId,
      text,
      ...extra,
    });
    if (error) {
      throw new Error(`e2e: could not seed a search post: ${error.message}`);
    }
    return id;
  }

  test.beforeAll(async () => {
    config = stackConfig();
    gm = await createPerson(config, `e2e-search-gm-${stamp}`);
    player = await createPerson(config, `e2e-search-player-${stamp}`);
    leftOut = await createPerson(config, `e2e-search-out-${stamp}`);
    people = [gm, player, leftOut];
    campaignId = await createCampaignAs(
      gm,
      `E2E Search ${Date.now()}`,
      "co-op"
    );
    await joinCampaignAs(player, campaignId);
    await joinCampaignAs(leftOut, campaignId);

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
    const icId = (channels.data as { id: string }).id;

    const privateChannel = await gm.client.rpc("create_private_channel", {
      cid: campaignId,
      cname: `Hidden quest ${stamp}`,
      ckind: "IC",
      member_ids: [player.userId],
    });
    if (privateChannel.error || !privateChannel.data) {
      throw new Error(
        `e2e: could not create private channel: ${privateChannel.error?.message}`
      );
    }
    const dm = await player.client.rpc("get_or_create_dm_channel", {
      cid: campaignId,
      other_id: leftOut.userId,
    });
    if (dm.error || !dm.data) {
      throw new Error(`e2e: could not create DM: ${dm.error?.message}`);
    }

    await postAs(player, icId, `The lantern is ${publicWord}`);
    await postAs(player, privateChannel.data as string, `A debt: ${privateWord}`);
    await postAs(player, dm.data as string, `Just us: ${dmWord}`);
    await postAs(gm, icId, `Secret roll: ${gmWord}`, { gms_only: true });

    // More than one page of a single phrase, a minute apart so the order is
    // fixed and a jump to the oldest result has to page forward first.
    const base = Date.now() - 24 * 60_000;
    for (let i = 0; i < 24; i += 1) {
      pageIds.push(
        await postAs(player, icId, `${pageWord} ${String(i).padStart(2, "0")}`, {
          created_at: new Date(base + i * 60_000).toISOString(),
        })
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

  async function openSearch(page: import("@playwright/test").Page) {
    await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
    await page.getByRole("button", { name: "Search posts" }).first().click();
    return page.getByRole("dialog");
  }

  async function findPosts(
    page: import("@playwright/test").Page,
    dialog: import("@playwright/test").Locator,
    phrase: string
  ) {
    await dialog.getByRole("textbox", { name: "Search post text" }).fill(phrase);
    await dialog.getByRole("button", { name: "Search" }).click();
    return resultButtons(dialog, phrase);
  }

  function resultButtons(
    dialog: import("@playwright/test").Locator,
    phrase: string
  ) {
    return dialog.locator("button").filter({ hasText: phrase });
  }

  test("pages the results and jumps to a post in the feed", async ({ page }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));
    const dialog = await openSearch(page);

    const firstPage = await findPosts(page, dialog, pageWord);
    // Twenty to a page: the oldest four wait behind Next.
    await expect(firstPage).toHaveCount(20);
    await expect(firstPage.first()).toContainText(`${pageWord} 23`);
    await expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Next" })).toBeEnabled();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(firstPage.first()).toContainText(`${pageWord} 03`);
    await expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();

    // The oldest result lives past the live window; the jump loads its
    // context first, then scrolls the feed to the highlighted row.
    const oldest = resultButtons(dialog, `${pageWord} 00`);
    await expect(oldest).toHaveCount(1);
    await oldest.click();
    await expect(dialog).toHaveCount(0);

    const target = page.locator(`[id="post-${pageIds[0]}"]`);
    await expect(target).toBeVisible();
    await expect(target).toBeInViewport();
    await expect(target).toHaveAttribute("data-highlighted", "true");
  });

  test("shared, private, DM and GM-only posts follow the reader's access", async ({
    page,
  }) => {
    await signInAs(page, config, player, campaignUrl(campaignId));
    let dialog = await openSearch(page);
    expect(await findPosts(page, dialog, publicWord)).toHaveCount(1);
    expect(await findPosts(page, dialog, privateWord)).toHaveCount(1);
    expect(await findPosts(page, dialog, dmWord)).toHaveCount(1);
    await expect(
      await findPosts(page, dialog, gmWord)
    ).toHaveCount(0);
    await expect(dialog.getByText("No posts match that phrase.")).toBeVisible();

    // A campaign member outside the private channel and the DM sees neither,
    // and players never see GM-only rolls.
    await signInAs(page, config, leftOut, campaignUrl(campaignId));
    dialog = await openSearch(page);
    expect(await findPosts(page, dialog, publicWord)).toHaveCount(1);
    expect(await findPosts(page, dialog, privateWord)).toHaveCount(0);
    expect(await findPosts(page, dialog, dmWord)).toHaveCount(0);
    expect(await findPosts(page, dialog, gmWord)).toHaveCount(0);

    // A GM sees private channels and their own GM-only posts, but a GM who
    // is not in a direct message stays blind to it.
    await signInAs(page, config, gm, campaignUrl(campaignId));
    dialog = await openSearch(page);
    expect(await findPosts(page, dialog, privateWord)).toHaveCount(1);
    expect(await findPosts(page, dialog, gmWord)).toHaveCount(1);
    expect(await findPosts(page, dialog, dmWord)).toHaveCount(0);
  });
});
