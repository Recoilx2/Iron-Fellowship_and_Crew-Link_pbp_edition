import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { createPost } from "api-calls/chat/createPost";
import {
  CHAT_POST_PAGE_SIZE,
  listenToChannelPosts,
  type PostWithId,
} from "api-calls/chat/listenToChannelPosts";
import { ROLL_RESULT, ROLL_TYPE, type Roll } from "types/DieRolls.type";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
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

function statRoll(characterId: string | null, uid: string, gmsOnly: boolean): Roll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    moveName: "Face Danger",
    action: 4,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.WEAK_HIT,
    timestamp: new Date(),
    characterId,
    uid,
    gmsOnly,
  };
}

describe.skipIf(!config)("chat roll posts end to end", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const unsubscribes: Array<() => void> = [];

  afterEach(async () => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUpCampaign(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    campaignId: string;
    icChannelId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    people.push(gm, player);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Rolling quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
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
      campaignId,
      icChannelId: (data as { id: string }).id,
    };
  }

  async function createCharacterAs(
    person: LivePerson,
    campaignId: string,
    name: string
  ): Promise<string> {
    // The id is generated here so the insert needs no RETURNING clause: the
    // characters SELECT policy re-queries its own table, which cannot see a
    // just-inserted row in the same statement, so insert-then-select always
    // fails RLS (#69). The plain INSERT policy compares owner_id directly
    // and accepts the row.
    const id = crypto.randomUUID();
    const { error } = await person.client.from("characters").insert({
      id,
      owner_id: person.userId,
      name,
      campaign_id: campaignId,
    });
    expect(error).toBeNull();
    return id;
  }

  it("posts a roll with its existing shape beside the author's text", { timeout: 90000 }, async () => {
    const { player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    await signInAs(player);
    const roll = statRoll(kira, player.userId, false);
    const postId = await createPost({
      channelId: icChannelId,
      text: "Kira dives for cover.",
      speakerCharacterId: kira,
      roll,
      gmsOnly: false,
    });
    const { data, error } = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("id", postId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as PostRow;
    // The roll travels in its existing shape with its timestamp inside;
    // the dice result is what the roller produced, bit for bit.
    expect(row.roll).toEqual({ ...roll, timestamp: roll.timestamp.toISOString() });
    expect(row.gms_only).toBe(false);

    // A roll stands in for the words: a roll-only post carries empty text.
    const bare = statRoll(kira, player.userId, false);
    const bareId = await createPost({
      channelId: icChannelId,
      text: "   ",
      speakerCharacterId: kira,
      roll: bare,
    });
    const { data: bareData, error: bareError } = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("id", bareId)
      .single();
    expect(bareError).toBeNull();
    expect((bareData as unknown as PostRow).text).toBe("");
  });

  it("withholds GM-only roll posts from players over reads and live updates", { timeout: 180000 }, async () => {
    const { gm, player, icChannelId } = await setUpCampaign();

    // The GM's secret table roll posts GM-only.
    await signInAs(gm);
    const secret = statRoll(null, gm.userId, true);
    await createPost({
      channelId: icChannelId,
      text: "",
      roll: secret,
      gmsOnly: true,
    });

    // The player reads nothing, direct or subscribed.
    const { data, error } = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("channel_id", icChannelId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    await signInAs(player);
    const seen: PostWithId[][] = [];
    let loaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        icChannelId,
        CHAT_POST_PAGE_SIZE,
        {
          onPosts: (posts) => seen.push(posts),
          onHasOlder: () => {},
          onLoaded: () => {
            loaded = true;
          },
        },
        (listenerError) => {
          throw listenerError;
        }
      )
    );
    await waitFor(() => (loaded && seen.length >= 1 ? seen : null));
    expect(seen.at(-1)).toEqual([]);

    // Another secret roll lands; the player's feed stays empty past the
    // reconcile re-fetch that would heal a dropped event.
    await gm.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: gm.userId,
      speaker_character_id: null,
      text: "",
      roll: { ...statRoll(null, gm.userId, true), timestamp: new Date().toISOString() },
      gms_only: true,
    });
    await waitFor(
      async () =>
        (
          await gm.client
            .from(CHAT_POSTS_TABLE)
            .select("id", { count: "exact" })
            .eq("channel_id", icChannelId)
        ).count === 2
          ? true
          : null,
      30000
    );
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(seen.every((window) => window.length === 0)).toBe(true);
  });

  it("refuses GM-only posts from non-GMs and freezes posted dice", { timeout: 90000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // A non-GM cannot mark a post GM-only, through the interface or direct.
    await signInAs(player);
    await expect(
      createPost({
        channelId: icChannelId,
        text: "Sneaky secret",
        speakerCharacterId: kira,
        roll: statRoll(kira, player.userId, true),
        gmsOnly: true,
      })
    ).rejects.toBeTruthy();
    const forged = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      text: "Sneaky secret",
      roll: { ...statRoll(kira, player.userId, true), timestamp: new Date().toISOString() },
      gms_only: true,
    });
    expect(forged.error).not.toBeNull();

    // Posted dice never change: the immutability trigger pins the roll and
    // its flag. The author may still fix the words around the dice (#27):
    // a text edit succeeds while a roll or flag change is refused.
    await signInAs(gm);
    const postId = await createPost({
      channelId: icChannelId,
      text: "The mists part.",
      roll: statRoll(null, gm.userId, false),
    });
    const editedText = await gm.client
      .from(CHAT_POSTS_TABLE)
      .update({ text: "The mists part!" })
      .eq("id", postId);
    expect(editedText.error).toBeNull();
    const changedRoll = await gm.client
      .from(CHAT_POSTS_TABLE)
      .update({
        roll: { ...statRoll(null, gm.userId, false), timestamp: new Date().toISOString() },
      })
      .eq("id", postId);
    expect(changedRoll.error).not.toBeNull();
    const changedFlag = await gm.client
      .from(CHAT_POSTS_TABLE)
      .update({ gms_only: true })
      .eq("id", postId);
    expect(changedFlag.error).not.toBeNull();
    const { data, error } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("id", postId)
      .single();
    expect(error).toBeNull();
    expect((data as unknown as PostRow).text).toBe("The mists part!");
    expect((data as unknown as PostRow).gms_only).toBe(false);
  });

  it("rejects a roll forged for another character", { timeout: 120000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");
    const warden = await createCharacterAs(gm, campaignId, "Warden Rey");

    // A player files dice under another player's character through a
    // direct insert: the database refuses the row.
    await signInAs(player);
    const forgedCharacter = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "Kira strikes.",
      roll: { ...statRoll(kira, player.userId, false), characterId: warden, timestamp: new Date().toISOString() },
      gms_only: false,
    });
    expect(forgedCharacter.error).not.toBeNull();

    // Filing under another author's name fails the same way.
    const forgedAuthor = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "Kira strikes.",
      roll: { ...statRoll(kira, gm.userId, false), timestamp: new Date().toISOString() },
      gms_only: false,
    });
    expect(forgedAuthor.error).not.toBeNull();

    // Claiming a character while posting as oneself fails as well.
    const forgedSelf = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: null,
      text: "Table talk.",
      roll: { ...statRoll(kira, player.userId, false), timestamp: new Date().toISOString() },
      gms_only: false,
    });
    expect(forgedSelf.error).not.toBeNull();

    // Nothing forged reached the channel.
    const { data, error } = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("id")
      .eq("channel_id", icChannelId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
    await signOut();
  });
});
