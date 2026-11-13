import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { addRoll } from "api-calls/game-log/addRoll";
import { updateLog } from "api-calls/game-log/updateLog";
import { removeLog } from "api-calls/game-log/removeLog";
import { listenToLogs } from "api-calls/game-log/listenToLogs";
import { campaignRollToColumns } from "api-calls/game-log/_getRef";
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

describe.skipIf(!config)("campaign roll log end to end", () => {
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
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Roll log",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    return { gm, player, outsider, campaignId };
  }

  it("shares rolls live with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, player, outsider, campaignId } = await setUpLog();

    // The singleton keeps the player's session for the whole test; the GM
    // and the outsider act through their own clients, so the subscription
    // never rides a mid-stream identity switch (which stalls the channel).
    const updated: Array<[string, Roll]> = [];
    const removed: string[] = [];
    unsubscribes.push(
      listenToLogs({
        isGM: false,
        campaignId,
        totalLogsToLoad: 25,
        updateLog: (rollId, roll) => updated.push([rollId, roll]),
        removeLog: (rollId) => removed.push(rollId),
        onError: (error) => {
          throw new Error(error);
        },
      })
    );

    const logId = await addRoll({
      campaignId,
      roll: statRoll(null, player.userId),
    });
    await waitFor(() =>
      updated.some(([id]) => id === logId) ? updated : null
    );
    expect(updated.at(-1)?.[1].rollLabel).toBe("wits");

    // An outsider reads nothing and writes nothing. The outsider writes
    // through their own client, so the singleton never leaves the player.
    const outsiderRows = await outsider.client
      .from("campaign_rolls")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(outsiderRows.error).toBeNull();
    expect(outsiderRows.data ?? []).toEqual([]);
    const deniedRoll = await outsider.client
      .from("campaign_rolls")
      .insert(campaignRollToColumns(campaignId, statRoll(null, outsider.userId)));
    expect(deniedRoll.error).not.toBeNull();

    // Only the author or a GM changes a roll: the GM edits through their
    // own client — byte-identical to updateLog — and the player follows.
    const edited = await gm.client
      .from("campaign_rolls")
      .update(
        campaignRollToColumns(campaignId, {
          ...statRoll(null, player.userId),
          rollLabel: "GM edited",
        })
      )
      .eq("id", logId)
      .select("id");
    expect(edited.error).toBeNull();
    expect(edited.data ?? []).not.toEqual([]);
    await waitFor(() =>
      updated.some(
        ([id, roll]) => id === logId && roll.rollLabel === "GM edited"
      )
        ? updated
        : null
    );
    // The player authored this roll, so they can remove it themselves.
    await removeLog({ campaignId, logId });
    await waitFor(() => (removed.includes(logId) ? removed : null));

    const secondId = await addRoll({
      campaignId,
      roll: statRoll(null, gm.userId),
    });
    // The singleton is still the player, so no switch is needed to prove a
    // non-author cannot touch the GM's roll.
    await expect(
      updateLog({
        campaignId,
        logId: secondId,
        log: { ...statRoll(null, gm.userId), rollLabel: "Hijacked" },
      })
    ).rejects.toBeTruthy();
    await expect(removeLog({ campaignId, logId: secondId })).rejects.toBeTruthy();
    // Cleanup runs as the GM through their own client.
    const cleaned = await gm.client
      .from("campaign_rolls")
      .delete()
      .eq("campaign_id", campaignId);
    expect(cleaned.error).toBeNull();
    const remaining = await gm.client
      .from("campaign_rolls")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(remaining.error).toBeNull();
    expect(remaining.data ?? []).toEqual([]);
  });

  it("hides GM-only rolls from players, including over live updates", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpLog();

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
    const openId = await addRoll({
      campaignId,
      roll: statRoll(null, player.userId),
    });
    await waitFor(() =>
      updated.some(([id]) => id === openId) ? updated : null
    );

    // The GM rolls in secret: it never reaches the player, directly or live.
    // The GM acts through their own client so the player's listener keeps
    // the player's session the whole time.
    const secretRoll = statRoll(null, gm.userId, { gmsOnly: true });
    const secretInsert = await gm.client.from("campaign_rolls").insert({
      campaign_id: campaignId,
      roll: { ...secretRoll, timestamp: secretRoll.timestamp.toISOString() },
      gms_only: true,
    });
    expect(secretInsert.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const secretId = (
      await gm.client
        .from("campaign_rolls")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("gms_only", true)
        .single()
    ).data?.id as string;
    expect(updated.some(([id]) => id === secretId)).toBe(false);
    const playerRows = await player.client
      .from("campaign_rolls")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(playerRows.error).toBeNull();
    expect(playerRows.data?.map((row) => row.id)).toEqual([openId]);

    // Revealing the roll opens it to the player live: the GM writes through
    // their own client — byte-identical to updateLog — while the player
    // still listens.
    const revealed = await gm.client
      .from("campaign_rolls")
      .update(
        campaignRollToColumns(
          campaignId,
          statRoll(null, gm.userId, { gmsOnly: false })
        )
      )
      .eq("id", secretId)
      .select("id");
    expect(revealed.error).toBeNull();
    expect(revealed.data ?? []).not.toEqual([]);
    await waitFor(() =>
      updated.some(([id]) => id === secretId) ? updated : null
    );

    // The live assertions are done: pause the subscription before the
    // export identity switches below. (Unsubscribing is idempotent, so the
    // afterEach cleanup stays safe.)
    stopListening();

    // Export matches: GMs see everything, players only the open rolls. The
    // singleton takes each session in turn now that nothing listens — the
    // GM export must run as the GM, or row-level security hides the secret.
    await signOut();
    await signInAs(gm);
    const gmExport = await getAllLogsForExport({ campaignId, isGM: true });
    expect(gmExport.map((entry) => entry.id).sort()).toEqual(
      [openId, secretId].sort()
    );
    await signOut();
    await signInAs(player);
    const playerExport = await getAllLogsForExport({
      campaignId,
      isGM: false,
    });
    expect(playerExport.map((entry) => entry.id)).toEqual([openId]);

    // A player cannot mark their roll GM-only to hide it.
    await expect(
      updateLog({
        campaignId,
        logId: openId,
        log: statRoll(null, player.userId, { gmsOnly: true }),
      })
    ).rejects.toBeTruthy();
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
    const firstId = await addRoll({
      campaignId,
      roll: statRoll(null, player.userId),
    });
    await waitFor(() =>
      updated.some(([id]) => id === firstId) ? updated : null
    );

    // The GM removes the player: later rolls never arrive, and the past
    // ones vanish from reads. The GM acts through their own client so the
    // player's listener keeps the player's session the whole time.
    const removed = await gm.client.rpc("remove_campaign_member", {
      cid: campaignId,
      target_uid: player.userId,
    });
    expect(removed.error).toBeNull();
    const laterRoll = statRoll(null, gm.userId);
    const laterInsert = await gm.client.from("campaign_rolls").insert({
      campaign_id: campaignId,
      roll: { ...laterRoll, timestamp: laterRoll.timestamp.toISOString() },
      gms_only: false,
    });
    expect(laterInsert.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(updated.some(([, roll]) => roll.uid === gm.userId)).toBe(false);
    const playerRows = await player.client
      .from("campaign_rolls")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(playerRows.error).toBeNull();
    expect(playerRows.data ?? []).toEqual([]);
  });
});
