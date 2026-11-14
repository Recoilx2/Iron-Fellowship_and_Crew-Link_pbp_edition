import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { createPost } from "api-calls/chat/createPost";
import { burnPostMomentum } from "api-calls/chat/burnPostMomentum";
import { ROLL_RESULT, ROLL_TYPE, type Roll } from "types/DieRolls.type";
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

function missRoll(characterId: string | null, uid: string): Roll {
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: "Edge",
    moveName: "Face Danger",
    action: 2,
    challenge1: 3,
    challenge2: 8,
    result: ROLL_RESULT.MISS,
    timestamp: new Date(),
    characterId,
    uid,
    gmsOnly: false,
  };
}

describe.skipIf(!config)("chat momentum burn end to end", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];

  afterEach(async () => {
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUpCampaign(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    other: LivePerson;
    campaignId: string;
    icChannelId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const other = await createPerson(cfg, "other");
    people.push(gm, player, other);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Burn quest",
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
      campaignId,
      icChannelId: (data as { id: string }).id,
    };
  }

  async function createCharacterAs(
    person: LivePerson,
    campaignId: string,
    name: string,
    momentum = 5
  ): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await person.client.from("characters").insert({
      id,
      owner_id: person.userId,
      name,
      campaign_id: campaignId,
      momentum,
    });
    expect(error).toBeNull();
    return id;
  }

  it(
    "lets the author burn once with the recalculated outcome and resets momentum",
    { timeout: 120000 },
    async () => {
      const { player, campaignId, icChannelId } = await setUpCampaign();
      const kira = await createCharacterAs(player, campaignId, "Kira Vey", 5);

      await signInAs(player);
      const postId = await createPost({
        channelId: icChannelId,
        text: "Kira dives for cover.",
        speakerCharacterId: kira,
        roll: missRoll(kira, player.userId),
      });

      await burnPostMomentum({ postId });
      await signOut();

      const { data, error } = await player.client
        .from(CHAT_POSTS_TABLE)
        .select("*")
        .eq("id", postId)
        .single();
      expect(error).toBeNull();
      const row = data as unknown as PostRow;
      const roll = row.roll as unknown as {
        momentumBurned: number;
        result: number;
        action: number;
      };
      // 5 beats 3 but not 8: a miss becomes a weak hit, and the card shows
      // the burn in the existing roll style.
      expect(roll.momentumBurned).toBe(5);
      expect(roll.result).toBe(ROLL_RESULT.WEAK_HIT);
      expect(roll.action).toBe(2);

      const { data: character } = await player.client
        .from("characters")
        .select("momentum")
        .eq("id", kira)
        .single();
      expect((character as { momentum: number }).momentum).toBe(2);
    }
  );

  it("refuses a second burn, burns by others, burns on deleted posts and other roll changes", { timeout: 120000 }, async () => {
    const { player, other, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey", 9);

    await signInAs(player);
    const postId = await createPost({
      channelId: icChannelId,
      text: "Kira strikes.",
      speakerCharacterId: kira,
      roll: missRoll(kira, player.userId),
    });
    await burnPostMomentum({ postId });
    // A second burn is refused, through the wrapper and direct.
    await expect(burnPostMomentum({ postId })).rejects.toBeTruthy();
    const second = await player.client
      .from(CHAT_POSTS_TABLE)
      .update({
        roll: { ...missRoll(kira, player.userId), momentumBurned: 9, result: ROLL_RESULT.HIT, timestamp: new Date().toISOString() },
      })
      .eq("id", postId);
    expect(second.error).not.toBeNull();
    await signOut();

    // A burn by anyone else is refused.
    await signInAs(other);
    await expect(burnPostMomentum({ postId })).rejects.toBeTruthy();
    await signOut();

    // Any other change to the roll in the same update is refused: the dice
    // may not move with the burn.
    await signInAs(player);
    const freshId = await createPost({
      channelId: icChannelId,
      text: "Kira tries again.",
      speakerCharacterId: kira,
      roll: missRoll(kira, player.userId),
    });
    await signOut();
    const tampered = await player.client
      .from(CHAT_POSTS_TABLE)
      .update({
        roll: { ...missRoll(kira, player.userId), action: 6, momentumBurned: 9, result: ROLL_RESULT.HIT, timestamp: new Date().toISOString() },
      })
      .eq("id", freshId);
    expect(tampered.error).not.toBeNull();

    // No burns on deleted posts.
    await signInAs(player);
    await player.client
      .from(CHAT_POSTS_TABLE)
      .update({ text: "", deleted_at: new Date().toISOString() })
      .eq("id", freshId);
    await expect(burnPostMomentum({ postId: freshId })).rejects.toBeTruthy();
    await signOut();
  });
});
