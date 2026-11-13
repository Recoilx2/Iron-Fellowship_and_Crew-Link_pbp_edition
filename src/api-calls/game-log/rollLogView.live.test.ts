import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { createPost } from "api-calls/chat/createPost";
import { listenToCampaignRollPosts } from "api-calls/chat/listenToCampaignRollPosts";
import { postCampaignRoll } from "api-calls/chat/postCampaignRoll";
import { listenToLogs } from "api-calls/game-log/listenToLogs";
import { getAllLogsForExport } from "api-calls/game-log/getAllLogsForExport";
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

function statRoll(
  characterId: string | null,
  uid: string,
  overrides: Partial<Roll> = {}
): Roll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "wits",
    timestamp: new Date(),
    characterId,
    uid,
    gmsOnly: false,
    action: 3,
    challenge1: 4,
    challenge2: 7,
    result: ROLL_RESULT.HIT,
    ...overrides,
  } as Roll;
}

describe.skipIf(!config)("campaign roll log as a view of roll posts", () => {
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

  async function setUpLog(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
    icChannelId: string;
    kiraId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Roll log view",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    const kiraId = crypto.randomUUID();
    const { error: characterError } = await player.client
      .from("characters")
      .insert({ id: kiraId, owner_id: player.userId, name: "Kira Vey", campaign_id: campaignId });
    expect(characterError).toBeNull();
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
      outsider,
      campaignId,
      icChannelId: (data as { id: string }).id,
      kiraId,
    };
  }

  it("posts a sheet roll to the starting IC channel and lists it in the roll log", { timeout: 120000 }, async () => {
    const { player, outsider, campaignId, icChannelId, kiraId } =
      await setUpLog();

    // A roll made for the character sheet posts to the starting IC channel
    // as that character, carrying its existing shape and open flag.
    await signInAs(player);
    const postId = await postCampaignRoll({
      campaignId,
      speakerCharacterId: kiraId,
      roll: statRoll(kiraId, player.userId),
    });
    const { data: posted, error: postedError } = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("id", postId)
      .single();
    expect(postedError).toBeNull();
    const row = posted as unknown as PostRow;
    expect(row.channel_id).toBe(icChannelId);
    expect(row.speaker_character_id).toBe(kiraId);
    expect(row.gms_only).toBe(false);
    expect(row.roll).toMatchObject({
      rollLabel: "wits",
      action: 3,
      challenge1: 4,
      challenge2: 7,
      characterId: kiraId,
      uid: player.userId,
    });

    // The campaign roll log is a view of those posts: the same roll
    // arrives live, keyed by its post, while a text-only post in the same
    // channel never enters the log.
    const updated: Array<[string, Roll]> = [];
    unsubscribes.push(
      listenToLogs({
        isGM: false,
        campaignId,
        totalLogsToLoad: 25,
        updateLog: (rollId, roll) => updated.push([rollId, roll]),
        removeLog: () => {},
        onError: (error) => {
          throw new Error(error);
        },
      })
    );
    await waitFor(() =>
      updated.some(([id]) => id === postId) ? updated : null
    );
    expect(updated.at(-1)?.[1].rollLabel).toBe("wits");

    await createPost({ channelId: icChannelId, text: "Table talk, no dice." });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(updated.every(([id]) => id === postId)).toBe(true);

    const exported = await getAllLogsForExport({ campaignId, isGM: false });
    expect(exported.map((entry) => entry.id)).toEqual([postId]);

    // An outsider reads nothing and writes nothing: the starting channel
    // lookup itself refuses them.
    const outsiderRows = await outsider.client
      .from(CHAT_POSTS_TABLE)
      .select("id")
      .eq("channel_id", icChannelId);
    expect(outsiderRows.error).toBeNull();
    expect(outsiderRows.data ?? []).toEqual([]);
    await expect(
      postCampaignRoll({
        campaignId,
        speakerCharacterId: null,
        roll: statRoll(null, outsider.userId),
      })
    ).rejects.toBeTruthy();
  });

  it("hides GM-only rolls from players over reads and live updates", { timeout: 180000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpLog();

    // The player follows the log live. The singleton keeps the player's
    // session until the live assertions are done; the GM acts through
    // their own client throughout, so the subscription never rides a
    // mid-stream identity switch.
    const updated: Array<[string, Roll]> = [];
    const stopListening = listenToLogs({
      isGM: false,
      campaignId,
      totalLogsToLoad: 25,
      updateLog: (rollId, roll) => updated.push([rollId, roll]),
      removeLog: () => {},
      onError: (error) => {
        throw new Error(error);
      },
    });
    unsubscribes.push(stopListening);

    await signInAs(player);
    const openId = await postCampaignRoll({
      campaignId,
      speakerCharacterId: null,
      roll: statRoll(null, player.userId),
    });
    await waitFor(() =>
      updated.some(([id]) => id === openId) ? updated : null
    );

    // A player cannot mark their roll GM-only to hide it.
    await expect(
      postCampaignRoll({
        campaignId,
        speakerCharacterId: null,
        roll: statRoll(null, player.userId, { gmsOnly: true }),
      })
    ).rejects.toBeTruthy();

    // The GM rolls in secret through their own client: it never reaches
    // the player, directly or live.
    const secretRoll = statRoll(null, gm.userId, { gmsOnly: true });
    const secretInsert = await gm.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: gm.userId,
      speaker_character_id: null,
      text: "",
      roll: { ...secretRoll, timestamp: secretRoll.timestamp.toISOString() },
      gms_only: true,
    });
    expect(secretInsert.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const secretRow = await gm.client
      .from(CHAT_POSTS_TABLE)
      .select("id")
      .eq("channel_id", icChannelId)
      .eq("gms_only", true)
      .limit(1)
      .single();
    expect(secretRow.error).toBeNull();
    const secretPostId = (secretRow.data as { id: string }).id;
    expect(updated.some(([id]) => id === secretPostId)).toBe(false);
    const playerRows = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("id")
      .eq("channel_id", icChannelId);
    expect(playerRows.error).toBeNull();
    expect((playerRows.data ?? []).map((row) => row.id)).toEqual([openId]);

    // The live assertions are done: pause the subscription before the
    // export identity switches below.
    stopListening();

    // Export matches: GMs see every roll post, players only the open ones.
    // The singleton takes each session in turn now that nothing listens.
    await signOut();
    await signInAs(gm);
    const gmExport = await getAllLogsForExport({ campaignId, isGM: true });
    expect(gmExport.map((entry) => entry.id).sort()).toEqual(
      [openId, secretPostId].sort()
    );
    await signOut();
    await signInAs(player);
    const playerExport = await getAllLogsForExport({
      campaignId,
      isGM: false,
    });
    expect(playerExport.map((entry) => entry.id)).toEqual([openId]);
  });

  it("cuts a removed member off the roll log at once", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpLog();

    // The player follows the log live.
    const updated: Array<[string, Roll]> = [];
    unsubscribes.push(
      listenToLogs({
        isGM: false,
        campaignId,
        totalLogsToLoad: 25,
        updateLog: (rollId, roll) => updated.push([rollId, roll]),
        removeLog: () => {},
        onError: (error) => {
          throw new Error(error);
        },
      })
    );
    await signInAs(player);
    const firstId = await postCampaignRoll({
      campaignId,
      speakerCharacterId: null,
      roll: statRoll(null, player.userId),
    });
    await waitFor(() =>
      updated.some(([id]) => id === firstId) ? updated : null
    );

    // The GM removes the player: the past roll vanishes from reads, and a
    // later roll never arrives. The GM acts through their own client so
    // the player's listener keeps the player's session the whole time.
    const removed = await gm.client.rpc("remove_campaign_member", {
      cid: campaignId,
      target_uid: player.userId,
    });
    expect(removed.error).toBeNull();
    const { data: channels } = await gm.client
      .from(CHAT_CHANNELS_TABLE)
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("is_starting", true)
      .eq("kind", "IC")
      .single();
    const laterRoll = statRoll(null, gm.userId);
    const laterInsert = await gm.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: (channels as { id: string }).id,
      author_id: gm.userId,
      speaker_character_id: null,
      text: "",
      roll: { ...laterRoll, timestamp: laterRoll.timestamp.toISOString() },
      gms_only: false,
    });
    expect(laterInsert.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(updated.some(([, roll]) => roll.uid === gm.userId)).toBe(false);
    const playerRows = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("id");
    expect(playerRows.error).toBeNull();
    expect(playerRows.data ?? []).toEqual([]);
  });

  it("streams the campaign's roll posts through their own listener", { timeout: 120000 }, async () => {
    const { player, campaignId } = await setUpLog();

    await signInAs(player);
    const seen: Array<[string, Roll]> = [];
    unsubscribes.push(
      listenToCampaignRollPosts({
        campaignId,
        totalLogsToLoad: 25,
        isGM: false,
        updateLog: (postId, roll) => seen.push([postId, roll]),
        removeLog: () => {},
        onError: (error) => {
          throw new Error(error);
        },
      })
    );
    const postId = await postCampaignRoll({
      campaignId,
      speakerCharacterId: null,
      roll: statRoll(null, player.userId),
    });
    await waitFor(() => (seen.some(([id]) => id === postId) ? seen : null));
    expect(seen.at(-1)?.[1].rollLabel).toBe("wits");
  });
});
