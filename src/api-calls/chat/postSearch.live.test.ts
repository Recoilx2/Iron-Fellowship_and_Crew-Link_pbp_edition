import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE } from "api-calls/chat/_postRef";
import { searchCampaignPosts } from "api-calls/chat/searchCampaignPosts";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();

async function signInAs(person: LivePerson): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw error;
}

async function signOut(): Promise<void> {
  await getSupabaseClient().auth.signOut();
}

/**
 * Inserts a post through the person's own client, so the row-level rules the
 * search function relies on are the only gate. The caller must be a member
 * of the channel's campaign; GM-only rows are written by the GM.
 */
async function postAs(
  person: LivePerson,
  channelId: string,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await person.client.from(CHAT_POSTS_TABLE).insert({
    id,
    channel_id: channelId,
    author_id: person.userId,
    text,
    ...extra,
  });
  expect(error).toBeNull();
  return id;
}

describe.skipIf(!config)("campaign post search end to end", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];

  afterEach(async () => {
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUp(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    other: LivePerson;
    outsider: LivePerson;
    campaignId: string;
    icChannelId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const other = await createPerson(cfg, "other");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, other, outsider);

    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Searchable quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    await signInAs(other);
    await joinCampaign({ campaignId });
    await signOut();

    const { data, error } = await gm.client
      .from(CHAT_CHANNELS_TABLE)
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "IC")
      .eq("is_starting", true)
      .single();
    expect(error).toBeNull();
    return {
      gm,
      player,
      other,
      outsider,
      campaignId,
      icChannelId: (data as { id: string }).id,
    };
  }

  async function searchAs(
    person: LivePerson,
    campaignId: string,
    query: string,
    pageSize?: number
  ) {
    await signInAs(person);
    return searchCampaignPosts({ campaignId, query, pageSize });
  }

  it(
    "returns only rows the reader may read, across public, private, DM and GM-only channels",
    { timeout: 180000 },
    async () => {
      const { gm, player, other, outsider, campaignId, icChannelId } =
        await setUp();
      const stamp = Date.now().toString(36);
      const publicWord = `publicneedle${stamp}`;
      const privateWord = `privateneedle${stamp}`;
      const dmWord = `dmneedle${stamp}`;
      const gmWord = `gmneedle${stamp}`;
      const goneWord = `goneneedle${stamp}`;
      const elsewhereWord = `elsewhereneedle${stamp}`;

      await postAs(player, icChannelId, `The lantern: ${publicWord}`);
      // A soft-deleted row keeps its words in storage but must never be
      // searchable again.
      await postAs(gm, icChannelId, `${goneWord} is gone`, {
        deleted_at: new Date().toISOString(),
      });

      const { data: privateId, error: privateError } = await gm.client.rpc(
        "create_private_channel",
        {
          cid: campaignId,
          cname: "Hidden side",
          ckind: "IC",
          member_ids: [player.userId],
        }
      );
      expect(privateError).toBeNull();
      await postAs(player, privateId as string, `A debt: ${privateWord}`);

      const { data: dmId, error: dmError } = await player.client.rpc(
        "get_or_create_dm_channel",
        { cid: campaignId, other_id: other.userId }
      );
      expect(dmError).toBeNull();
      await postAs(player, dmId as string, `Just between us: ${dmWord}`);

      await postAs(gm, icChannelId, `Secret roll: ${gmWord}`, {
        gms_only: true,
      });

      // Same phrase in a campaign the reader does not belong to.
      await signInAs(gm);
      const otherCampaignId = await createCampaign({
        uid: gm.userId,
        campaignName: "Somewhere else",
        campaignType: CampaignType.Coop,
      });
      const otherRows = await gm.client
        .from(CHAT_CHANNELS_TABLE)
        .select("id")
        .eq("campaign_id", otherCampaignId)
        .eq("kind", "IC")
        .eq("is_starting", true)
        .single();
      expect(otherRows.error).toBeNull();
      await postAs(
        gm,
        (otherRows.data as { id: string }).id,
        `Far away: ${elsewhereWord}`
      );

      const gmResult = await searchAs(gm, campaignId, "needle");
      const gmTexts = gmResult.posts.map((post) => post.text);
      expect(gmTexts).toContain(`The lantern: ${publicWord}`);
      expect(gmTexts).toContain(`A debt: ${privateWord}`);
      expect(gmTexts).toContain(`Secret roll: ${gmWord}`);
      // A GM outside the DM neither sees nor finds it.
      expect(gmTexts).not.toContain(`Just between us: ${dmWord}`);
      expect(gmTexts).not.toContain(`Far away: ${elsewhereWord}`);
      expect(gmTexts.some((text) => text.includes(goneWord))).toBe(false);

      const playerResult = await searchAs(player, campaignId, "needle");
      const playerTexts = playerResult.posts.map((post) => post.text);
      expect(playerTexts).toContain(`The lantern: ${publicWord}`);
      expect(playerTexts).toContain(`A debt: ${privateWord}`);
      expect(playerTexts).toContain(`Just between us: ${dmWord}`);
      expect(playerTexts).not.toContain(`Secret roll: ${gmWord}`);

      const otherResult = await searchAs(other, campaignId, "needle");
      const otherTexts = otherResult.posts.map((post) => post.text);
      expect(otherTexts).toContain(`The lantern: ${publicWord}`);
      expect(otherTexts).not.toContain(`A debt: ${privateWord}`);
      expect(otherTexts).not.toContain(`Just between us: ${dmWord}`);
      expect(otherTexts).not.toContain(`Secret roll: ${gmWord}`);

      const outsiderResult = await searchAs(outsider, campaignId, "needle");
      expect(outsiderResult.posts).toEqual([]);
    }
  );

  it("pages a phrase without duplicates or gaps", { timeout: 180000 }, async () => {
    const { player, campaignId, icChannelId } = await setUp();
    const stamp = Date.now().toString(36);
    const word = `pageword${stamp}`;
    const base = Date.now() - 8 * 60_000;
    const expected: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const text = `${word} ${String(i).padStart(2, "0")}`;
      expected.unshift(text);
      await postAs(player, icChannelId, text, {
        created_at: new Date(base + i * 60_000).toISOString(),
      });
    }

    await signInAs(player);
    const seen: string[] = [];
    const seenIds: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    let pages = 0;
    do {
      const result = await searchCampaignPosts({
        campaignId,
        query: word,
        cursor,
        pageSize: 2,
      });
      pages += 1;
      expect(result.posts.length).toBeGreaterThan(0);
      expect(result.posts.length).toBeLessThanOrEqual(2);
      for (const post of result.posts) {
        seen.push(post.text);
        seenIds.push(post.id);
      }
      cursor = result.nextCursor;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(seen).toEqual(expected);
    expect(new Set(seenIds).size).toBe(seenIds.length);

    // Wildcard characters in the phrase are literal text, not patterns.
    const literal = await searchCampaignPosts({
      campaignId,
      query: `${word}%`,
    });
    expect(literal.posts).toEqual([]);
    const all = await searchCampaignPosts({ campaignId, query: word });
    expect(all.posts).toHaveLength(7);
  });
});
