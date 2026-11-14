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

  async function readPostAs(
    person: LivePerson,
    postId: string
  ): Promise<PostRow> {
    const { data, error } = await person.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("id", postId)
      .single();
    expect(error).toBeNull();
    return data as unknown as PostRow;
  }

  async function readMomentumAs(
    person: LivePerson,
    characterId: string
  ): Promise<number> {
    const { data, error } = await person.client
      .from("characters")
      .select("momentum")
      .eq("id", characterId)
      .single();
    expect(error).toBeNull();
    return (data as { momentum: number }).momentum;
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

      const row = await readPostAs(player, postId);
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

      // The single post update spent the momentum too: one transaction,
      // the sheet's reset (no debilities, so back to 2).
      expect(await readMomentumAs(player, kira)).toBe(2);
    }
  );

  it(
    "refuses tampered burns at the database and leaves the row unchanged",
    { timeout: 180000 },
    async () => {
      const { player, campaignId, icChannelId } = await setUpCampaign();
      const kira = await createCharacterAs(player, campaignId, "Kira Vey", 5);

      await signInAs(player);
      const postId = await createPost({
        channelId: icChannelId,
        text: "Kira strikes.",
        speakerCharacterId: kira,
        roll: missRoll(kira, player.userId),
      });
      await signOut();

      // Every attempt below is refused by the roll lock itself, and the
      // row -- roll and momentum alike -- is unchanged afterwards. The
      // battery builds each tamper from the stored roll, so the dice and
      // timestamp stay exactly as posted unless the case says otherwise.
      const unchanged = async (
        makeTamper: (
          stored: Record<string, unknown>
        ) => Record<string, unknown>,
        label: string
      ): Promise<void> => {
        const before = await readPostAs(player, postId);
        const stored = before.roll as unknown as Record<string, unknown>;
        const { error } = await player.client
          .from(CHAT_POSTS_TABLE)
          .update({ roll: makeTamper(stored) })
          .eq("id", postId);
        expect(error, label).not.toBeNull();
        const after = await readPostAs(player, postId);
        expect(after.roll, label).toEqual(before.roll);
        expect(await readMomentumAs(player, kira), label).toBe(5);
      };

      // A burn value that is not the character's momentum.
      await unchanged((stored) => ({ ...stored, momentumBurned: 11, result: 0 }), "burn of 11");
      await unchanged((stored) => ({ ...stored, momentumBurned: "NaN", result: 0 }), "burn of NaN");
      await unchanged((stored) => ({ ...stored, momentumBurned: 5.5, result: ROLL_RESULT.WEAK_HIT }), "fractional burn");
      await unchanged((stored) => ({ ...stored, momentumBurned: -1, result: ROLL_RESULT.MISS }), "negative burn");
      // The right burn value with the wrong outcome.
      await unchanged((stored) => ({ ...stored, momentumBurned: 5, result: ROLL_RESULT.HIT }), "wrong result");
      // Dice tweaked without touching the timestamp.
      await unchanged((stored) => ({ ...stored, action: 6, momentumBurned: 5, result: ROLL_RESULT.WEAK_HIT }), "dice change");
      // Dice tweaked with a fresh timestamp.
      await unchanged(
        (stored) => ({
          ...stored,
          action: 6,
          timestamp: new Date().toISOString(),
          momentumBurned: 5,
          result: ROLL_RESULT.WEAK_HIT,
        }),
        "dice and timestamp change"
      );
      // A GM-only flip riding with an otherwise valid burn.
      {
        const before = await readPostAs(player, postId);
        const stored = before.roll as unknown as Record<string, unknown>;
        const { error } = await player.client
          .from(CHAT_POSTS_TABLE)
          .update({
            roll: { ...stored, momentumBurned: 5, result: ROLL_RESULT.WEAK_HIT },
            gms_only: true,
          })
          .eq("id", postId);
        expect(error, "gms_only flip").not.toBeNull();
        const after = await readPostAs(player, postId);
        expect(after.roll, "gms_only flip").toEqual(before.roll);
        expect(after.gms_only, "gms_only flip").toBe(before.gms_only);
        expect(await readMomentumAs(player, kira), "gms_only flip").toBe(5);
      }
      // A text change riding with an otherwise valid burn.
      {
        const before = await readPostAs(player, postId);
        const stored = before.roll as unknown as Record<string, unknown>;
        const { error } = await player.client
          .from(CHAT_POSTS_TABLE)
          .update({
            text: "Tampered words.",
            roll: { ...stored, momentumBurned: 5, result: ROLL_RESULT.WEAK_HIT },
          })
          .eq("id", postId);
        expect(error, "text change").not.toBeNull();
        const after = await readPostAs(player, postId);
        expect(after.roll, "text change").toEqual(before.roll);
        expect(after.text, "text change").toBe(before.text);
        expect(await readMomentumAs(player, kira), "text change").toBe(5);
      }

      // A valid burn through the database rule itself takes effect and
      // spends the momentum in the same update.
      {
        const before = await readPostAs(player, postId);
        const stored = before.roll as unknown as Record<string, unknown>;
        const { error } = await player.client
          .from(CHAT_POSTS_TABLE)
          .update({
            roll: { ...stored, momentumBurned: 5, result: ROLL_RESULT.WEAK_HIT },
          })
          .eq("id", postId);
        expect(error).toBeNull();
        const after = await readPostAs(player, postId);
        const roll = after.roll as unknown as {
          momentumBurned: number;
          result: number;
        };
        expect(roll.momentumBurned).toBe(5);
        expect(roll.result).toBe(ROLL_RESULT.WEAK_HIT);
        expect(await readMomentumAs(player, kira)).toBe(2);
      }

      // A second burn is refused, and the first burn stands.
      {
        const burned = await readPostAs(player, postId);
        const stored = burned.roll as unknown as Record<string, unknown>;
        const { error } = await player.client
          .from(CHAT_POSTS_TABLE)
          .update({
            roll: { ...stored, momentumBurned: 5, result: ROLL_RESULT.HIT },
          })
          .eq("id", postId);
        expect(error, "second burn").not.toBeNull();
        const after = await readPostAs(player, postId);
        expect(after.roll, "second burn").toEqual(burned.roll);
        expect(await readMomentumAs(player, kira), "second burn").toBe(2);
      }
    }
  );

  it(
    "refuses a lone GM-only flip and leaves the row unchanged",
    { timeout: 120000 },
    async () => {
      const { player, campaignId, icChannelId } = await setUpCampaign();
      const kira = await createCharacterAs(player, campaignId, "Kira Vey", 5);

      await signInAs(player);
      const postId = await createPost({
        channelId: icChannelId,
        text: "Kira strikes.",
        speakerCharacterId: kira,
        roll: missRoll(kira, player.userId),
      });
      await signOut();

      // A lone gms_only flip with the roll untouched is refused: the flag
      // stays pinned always, so a burn can never leak a secret roll. A
      // denied update can return no error with zero rows, so the row
      // itself -- flag, roll and momentum -- must stand either way.
      const before = await readPostAs(player, postId);
      const { data: updated, error } = await player.client
        .from(CHAT_POSTS_TABLE)
        .update({ gms_only: true })
        .eq("id", postId)
        .select("id");
      expect(
        error !== null || (updated ?? []).length === 0,
        "lone gms_only flip"
      ).toBe(true);
      const after = await readPostAs(player, postId);
      expect(after.gms_only, "lone gms_only flip").toBe(before.gms_only);
      expect(after.roll, "lone gms_only flip").toEqual(before.roll);
      expect(after.text, "lone gms_only flip").toBe(before.text);
      expect(await readMomentumAs(player, kira), "lone gms_only flip").toBe(5);
    }
  );

  it(
    "refuses burns by anyone else, by GMs, and on deleted posts at the database",
    { timeout: 180000 },
    async () => {
      const { gm, player, other, campaignId, icChannelId } =
        await setUpCampaign();
      const kira = await createCharacterAs(player, campaignId, "Kira Vey", 5);

      await signInAs(player);
      const postId = await createPost({
        channelId: icChannelId,
        text: "Kira tries again.",
        speakerCharacterId: kira,
        roll: missRoll(kira, player.userId),
      });
      await signOut();

      const validBurn = (stored: Record<string, unknown>) => ({
        ...stored,
        momentumBurned: 5,
        result: ROLL_RESULT.WEAK_HIT,
      });

      // A burn by anyone else: no update policy matches, so the database
      // changes no rows -- possibly with no error -- and the row stands.
      {
        const before = await readPostAs(player, postId);
        await other.client
          .from(CHAT_POSTS_TABLE)
          .update({
            roll: validBurn(before.roll as unknown as Record<string, unknown>),
          })
          .eq("id", postId);
        const after = await readPostAs(player, postId);
        expect(after.roll, "burn by anyone else").toEqual(before.roll);
        expect(await readMomentumAs(player, kira), "burn by anyone else").toBe(5);
      }

      // A GM burns nobody's roll but the author's: the rule refuses.
      {
        const before = await readPostAs(player, postId);
        const { error } = await gm.client
          .from(CHAT_POSTS_TABLE)
          .update({
            roll: validBurn(before.roll as unknown as Record<string, unknown>),
          })
          .eq("id", postId);
        expect(error, "burn by a GM").not.toBeNull();
        const after = await readPostAs(player, postId);
        expect(after.roll, "burn by a GM").toEqual(before.roll);
        expect(await readMomentumAs(player, kira), "burn by a GM").toBe(5);
      }

      // The wrapper still refuses early for anyone but the author.
      await signInAs(other);
      await expect(burnPostMomentum({ postId })).rejects.toBeTruthy();
      await signOut();
      await signInAs(gm);
      await expect(burnPostMomentum({ postId })).rejects.toBeTruthy();
      await signOut();

      // No burns on deleted posts, through the database or the wrapper.
      await signInAs(player);
      await player.client
        .from(CHAT_POSTS_TABLE)
        .update({ text: "", deleted_at: new Date().toISOString() })
        .eq("id", postId);
      await expect(burnPostMomentum({ postId })).rejects.toBeTruthy();
      await signOut();
      {
        const deleted = await readPostAs(player, postId);
        expect(deleted.roll).toBeNull();
        const { error } = await player.client
          .from(CHAT_POSTS_TABLE)
          .update({ roll: validBurn(missRoll(kira, player.userId) as unknown as Record<string, unknown>) })
          .eq("id", postId);
        expect(error, "burn on a deleted post").not.toBeNull();
        const after = await readPostAs(player, postId);
        expect(after.roll, "burn on a deleted post").toBeNull();
      }
    }
  );

  it(
    "posts a composer send carrying a burn atomically and refuses bad ones",
    { timeout: 120000 },
    async () => {
      const { player, campaignId, icChannelId } = await setUpCampaign();
      const kira = await createCharacterAs(player, campaignId, "Kira Vey", 5);

      const burnedRoll = (
        overrides: Record<string, unknown> = {}
      ): Record<string, unknown> => ({
        type: 0,
        rollLabel: "Edge",
        moveName: "Face Danger",
        action: 2,
        challenge1: 3,
        challenge2: 8,
        result: ROLL_RESULT.WEAK_HIT,
        timestamp: new Date().toISOString(),
        characterId: kira,
        uid: player.userId,
        gmsOnly: false,
        momentumBurned: 5,
        ...overrides,
      });

      // The composer's send: one insert carries the burned roll, and the
      // same transaction spends the momentum.
      const postId = crypto.randomUUID();
      const { error } = await player.client.from(CHAT_POSTS_TABLE).insert({
        id: postId,
        channel_id: icChannelId,
        author_id: player.userId,
        speaker_character_id: kira,
        text: "Kira dives for cover.",
        roll: burnedRoll(),
        gms_only: false,
      });
      expect(error).toBeNull();
      const row = await readPostAs(player, postId);
      const roll = row.roll as unknown as {
        momentumBurned: number;
        result: number;
      };
      expect(roll.momentumBurned).toBe(5);
      expect(roll.result).toBe(ROLL_RESULT.WEAK_HIT);
      expect(await readMomentumAs(player, kira)).toBe(2);

      // A send carrying the wrong outcome is refused outright.
      const badResultId = crypto.randomUUID();
      const { error: badResultError } = await player.client
        .from(CHAT_POSTS_TABLE)
        .insert({
          id: badResultId,
          channel_id: icChannelId,
          author_id: player.userId,
          speaker_character_id: kira,
          text: "Kira strikes.",
          roll: burnedRoll({ momentumBurned: 5, result: ROLL_RESULT.HIT }),
          gms_only: false,
        });
      expect(badResultError, "wrong outcome on send").not.toBeNull();

      // A send carrying another value than the speaker's momentum is
      // refused outright, and the momentum stands.
      const badBurnId = crypto.randomUUID();
      const { error: badBurnError } = await player.client
        .from(CHAT_POSTS_TABLE)
        .insert({
          id: badBurnId,
          channel_id: icChannelId,
          author_id: player.userId,
          speaker_character_id: kira,
          text: "Kira strikes.",
          roll: burnedRoll({ momentumBurned: 11, result: ROLL_RESULT.HIT }),
          gms_only: false,
        });
      expect(badBurnError, "wrong burn value on send").not.toBeNull();
      // The refused sends posted nothing and spent nothing: the spent
      // momentum above is untouched.
      expect(await readMomentumAs(player, kira)).toBe(2);
    }
  );

  it(
    "keeps a GM-only roll GM-only after a burn",
    { timeout: 120000 },
    async () => {
      const { gm, player, campaignId, icChannelId } = await setUpCampaign();
      const oracle = await createCharacterAs(gm, campaignId, "GM Oracle", 5);

      await signInAs(gm);
      const postId = await createPost({
        channelId: icChannelId,
        text: "The shadows move.",
        speakerCharacterId: oracle,
        roll: { ...missRoll(oracle, gm.userId), gmsOnly: true },
        gmsOnly: true,
      });

      await burnPostMomentum({ postId });
      await signOut();

      const row = await readPostAs(gm, postId);
      expect(row.gms_only).toBe(true);
      const roll = row.roll as unknown as {
        momentumBurned: number;
        result: number;
      };
      expect(roll.momentumBurned).toBe(5);
      expect(roll.result).toBe(ROLL_RESULT.WEAK_HIT);
      expect(await readMomentumAs(gm, oracle)).toBe(2);

      // Players still cannot read the burned GM-only post.
      const { data, error } = await player.client
        .from(CHAT_POSTS_TABLE)
        .select("id")
        .eq("id", postId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  );
});
