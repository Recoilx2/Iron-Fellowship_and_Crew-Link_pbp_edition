import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCharacter } from "api-calls/character/createCharacter";
import { updateCharacter } from "api-calls/character/updateCharacter";
import { addAsset } from "api-calls/assets/addAsset";
import { updateAsset } from "api-calls/assets/updateAsset";
import { updateAssetCheckbox } from "api-calls/assets/updateAssetCheckbox";
import { removeAsset } from "api-calls/assets/removeAsset";
import { listenToAssets } from "api-calls/assets/listenToAssets";
import type { AssetDocument } from "api-calls/assets/_asset.type";
import { addProgressTrack } from "api-calls/tracks/addProgressTrack";
import { updateProgressTrack } from "api-calls/tracks/updateProgressTrack";
import { removeProgressTrack } from "api-calls/tracks/removeProgressTrack";
import { listenToProgressTracks } from "api-calls/tracks/listenToProgressTracks";
import { addNote } from "api-calls/notes/addNote";
import { updateNote } from "api-calls/notes/updateNote";
import { updateNoteShared } from "api-calls/notes/updateNoteShared";
import { removeNote } from "api-calls/notes/removeNote";
import { listenToNotes } from "api-calls/notes/listenToNotes";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import { updateSettings } from "api-calls/character-campaign-settings/updateSettings";
import { showOrHideCustomMove } from "api-calls/character-campaign-settings/showOrHideCustomMove";
import { listenToSettings } from "api-calls/character-campaign-settings/listenToSettings";
import type { SettingsDocument } from "api-calls/character-campaign-settings/_character-campaign-settings.type";
import { addRoll } from "api-calls/game-log/addRoll";
import { updateLog } from "api-calls/game-log/updateLog";
import { removeLog } from "api-calls/game-log/removeLog";
import { listenToLogs } from "api-calls/game-log/listenToLogs";
import type { Note } from "types/Notes.type";
import type { Track, TrackSectionTracks } from "types/Track.type";
import { TrackStatus, TrackTypes, Difficulty } from "types/Track.type";
import type { Roll } from "types/DieRolls.type";
import { ROLL_RESULT, ROLL_TYPE } from "types/DieRolls.type";
import {
  createPerson,
  deletePerson,
  grantMembership,
  liveStackConfig,
  randomCampaignId,
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

function statRoll(characterId: string, uid: string): Roll {
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
  };
}

describe.skipIf(!config)("character children end to end", () => {
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

  async function createSoloCharacter(owner: LivePerson): Promise<string> {
    await signInAs(owner);
    return createCharacter({
      uid: owner.userId,
      name: "Sheet",
      stats: { edge: 2 },
      assets: [],
    });
  }

  it("saves and streams assets live", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const characterId = await createSoloCharacter(owner);

    const seen: Array<{ [assetId: string]: AssetDocument }> = [];
    const errors: unknown[] = [];
    unsubscribes.push(
      listenToAssets(
        characterId,
        undefined,
        (assets) => seen.push(assets),
        (error) => errors.push(error)
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    expect(seen[0]).toEqual({});

    await addAsset({
      characterId,
      asset: { id: "ironsworn/assets/companion", enabledAbilities: {}, order: 0 },
    });
    const added = await waitFor(() =>
      Object.keys(seen.at(-1) ?? {}).length === 1 ? seen : null
    );
    const assetId = Object.keys(added.at(-1) ?? {})[0];
    expect(added.at(-1)?.[assetId]).toMatchObject({
      id: "ironsworn/assets/companion",
      order: 0,
    });

    await updateAssetCheckbox({ characterId, assetId, abilityIndex: 1, checked: true });
    await updateAsset({
      characterId,
      assetId,
      asset: { "optionValues.role": "guard" },
    });
    const patched = await waitFor(() =>
      seen.at(-1)?.[assetId]?.optionValues?.role === "guard" &&
      seen.at(-1)?.[assetId]?.enabledAbilities?.[1] === true
        ? seen
        : null
    );
    expect(patched.at(-1)?.[assetId]).toMatchObject({
      enabledAbilities: { 1: true },
      optionValues: { role: "guard" },
    });

    await removeAsset({ characterId, assetId });
    await waitFor(() =>
      Object.keys(seen.at(-1) ?? {}).length === 0 ? seen : null
    );
    expect(errors).toEqual([]);
  });

  it("saves and streams progress tracks live", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const characterId = await createSoloCharacter(owner);

    const added: Array<{ [trackId: string]: Track }> = [];
    const removed: Array<[string, TrackSectionTracks]> = [];
    const trackUnsubscribe = listenToProgressTracks(
      undefined,
      characterId,
      TrackStatus.Active,
      (tracks) => added.push(tracks),
      (trackId, type) => removed.push([trackId, type]),
      (error) => {
        throw error;
      }
    );
    if (trackUnsubscribe) {
      unsubscribes.push(trackUnsubscribe);
    }

    await addProgressTrack({
      characterId,
      track: {
        label: "Find the pass",
        type: TrackTypes.Journey,
        value: 1,
        status: TrackStatus.Active,
        difficulty: Difficulty.Dangerous,
        createdDate: new Date("2026-11-01T00:00:00.000Z"),
      },
    });
    const withTrack = await waitFor(() =>
      Object.keys(added.at(-1) ?? {}).length === 1 ? added : null
    );
    const trackId = Object.keys(withTrack.at(-1) ?? {})[0];
    expect(withTrack.at(-1)?.[trackId]).toMatchObject({
      label: "Find the pass",
      type: TrackTypes.Journey,
      value: 1,
    });

    await updateProgressTrack({ characterId, trackId, track: { value: 4 } });
    await waitFor(() =>
      withTrack.at(-1)?.[trackId]?.value === 4 ? added : null
    );

    await removeProgressTrack({ characterId, id: trackId });
    await waitFor(() => (removed.length >= 1 ? removed : null));
    expect(removed[0][0]).toBe(trackId);
  });

  it("saves notes and streams their contents live", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const characterId = await createSoloCharacter(owner);

    const seen: Note[][] = [];
    unsubscribes.push(
      listenToNotes(
        undefined,
        characterId,
        false,
        (_source, notes) => seen.push(notes),
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));

    const noteId = await addNote({ characterId, order: 0 });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId) ? seen : null
    );

    const contents: Array<Uint8Array | undefined> = [];
    unsubscribes.push(
      listenToNoteContent(
        undefined,
        characterId,
        noteId,
        (content) => contents.push(content),
        (error) => {
          throw error;
        }
      )
    );
    await updateNote({
      campaignId: undefined,
      characterId,
      noteId,
      title: "Session prep",
      content: new Uint8Array([1, 2, 3, 250]),
    });
    const updated = await waitFor(() =>
      contents.some((content) => content?.length === 4) ? contents : null
    );
    expect(updated.at(-1)).toEqual(new Uint8Array([1, 2, 3, 250]));
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.title === "Session prep")
        ? seen
        : null
    );

    await updateNoteShared({
      campaignId: undefined,
      characterId,
      noteId,
      shared: true,
    });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId && note.shared)
        ? seen
        : null
    );

    await removeNote({ characterId, noteId });
    await waitFor(() =>
      seen.at(-1)?.every((note) => note.noteId !== noteId) ? seen : null
    );
  });

  it("saves and streams character settings live", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const characterId = await createSoloCharacter(owner);

    const seen: SettingsDocument[] = [];
    unsubscribes.push(
      listenToSettings(
        undefined,
        characterId,
        (settings) => seen.push(settings),
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    expect(seen[0]).toMatchObject({
      hiddenCustomMoveIds: [],
      hiddenCustomOraclesIds: [],
    });

    await updateSettings({
      characterId,
      settings: { customStats: ["wits"], hideDelveMoves: true },
    });
    await waitFor(() =>
      seen.at(-1)?.customStats?.includes("wits") ? seen : null
    );

    await showOrHideCustomMove({ characterId, moveId: "move-1", hidden: true });
    await waitFor(() =>
      seen.at(-1)?.hiddenCustomMoveIds?.includes("move-1") ? seen : null
    );

    await showOrHideCustomMove({ characterId, moveId: "move-1", hidden: false });
    await waitFor(() =>
      seen.at(-1)?.hiddenCustomMoveIds?.length === 0 ? seen : null
    );
  });

  it("keeps a solo roll log live", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const characterId = await createSoloCharacter(owner);

    const updated: Array<[string, Roll]> = [];
    const removed: string[] = [];
    unsubscribes.push(
      listenToLogs({
        isGM: true,
        characterId,
        totalLogsToLoad: 25,
        updateLog: (rollId, roll) => updated.push([rollId, roll]),
        removeLog: (rollId) => removed.push(rollId),
        onError: (error) => {
          throw new Error(error);
        },
      })
    );

    const logId = await addRoll({
      characterId,
      roll: statRoll(characterId, owner.userId),
    });
    await waitFor(() =>
      updated.some(([id]) => id === logId) ? updated : null
    );
    expect(updated.at(-1)?.[1].rollLabel).toBe("wits");

    await updateLog({
      characterId,
      logId,
      log: { ...statRoll(characterId, owner.userId), rollLabel: "edited" },
    });
    await waitFor(() =>
      updated.some(
        ([id, roll]) => id === logId && roll.rollLabel === "edited"
      )
        ? updated
        : null
    );

    await removeLog({ characterId, logId });
    await waitFor(() => (removed.includes(logId) ? removed : null));
  });

  it("blocks outsiders from every character table", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, outsider);
    const characterId = await createSoloCharacter(owner);
    await addNote({ characterId, order: 0 });

    for (const table of [
      "characters",
      "character_assets",
      "character_tracks",
      "character_notes",
      "character_note_contents",
      "character_settings",
      "character_rolls",
    ]) {
      const read = await outsider.client.from(table).select("id").limit(1);
      expect(read.error).toBeNull();
      expect(read.data ?? []).toEqual([]);
    }

    const deniedInsert = await outsider.client.from("character_assets").insert({
      character_id: characterId,
      datasworn_id: "x",
      sort_order: 0,
    });
    expect(deniedInsert.error).not.toBeNull();

    const deniedUpdate = await outsider.client
      .from("characters")
      .update({ name: "Hijacked" })
      .eq("id", characterId)
      .select("id");
    expect(deniedUpdate.data ?? []).toEqual([]);

    await signOut();
    await signInAs(outsider);
    await expect(
      addAsset({
        characterId,
        asset: { id: "x", enabledAbilities: {}, order: 0 },
      })
    ).rejects.toBeTruthy();
    await expect(
      addNote({ characterId, order: 1 })
    ).rejects.toBeTruthy();
  });

  it("never leaks unshared notes, including over live updates", { timeout: 120000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const member = await createPerson(cfg, "member");
    people.push(owner, member);
    const campaignId = randomCampaignId();
    await grantMembership(cfg, campaignId, member.userId, "player");

    await signInAs(owner);
    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Shared",
      stats: {},
      assets: [],
    });
    await updateCharacter({ characterId, character: { campaignId } });
    const privateNoteId = await addNote({ characterId, order: 0 });

    // The member sees the shared character but not its unshared notes.
    const memberNotes = await member.client
      .from("character_notes")
      .select("id")
      .eq("character_id", characterId);
    expect(memberNotes.error).toBeNull();
    expect(memberNotes.data ?? []).toEqual([]);
    const memberContents = await member.client
      .from("character_note_contents")
      .select("note_id")
      .eq("note_id", privateNoteId);
    expect(memberContents.error).toBeNull();
    expect(memberContents.data ?? []).toEqual([]);

    // The member follows the notes live; the unshared note never arrives.
    await signOut();
    await signInAs(member);
    const seen: Note[][] = [];
    unsubscribes.push(
      listenToNotes(
        undefined,
        characterId,
        false,
        (_source, notes) => seen.push(notes),
        () => {}
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    expect(seen.at(-1) ?? []).toEqual([]);

    await owner.client
      .from("character_notes")
      .update({ title: "Still secret" })
      .eq("id", privateNoteId);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(seen.every((notes) => notes.length === 0)).toBe(true);

    // Sharing the note opens exactly that note to the member.
    await signOut();
    await signInAs(owner);
    await updateNoteShared({
      campaignId: undefined,
      characterId,
      noteId: privateNoteId,
      shared: true,
    });
    await signOut();
    await signInAs(member);
    let shared: Array<{ id: string }> | null = null;
    const deadline = Date.now() + 30000;
    while (!shared) {
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for the shared note");
      }
      const rereadNotes = await member.client
        .from("character_notes")
        .select("id")
        .eq("character_id", characterId);
      if ((rereadNotes.data ?? []).length === 1) {
        shared = rereadNotes.data as Array<{ id: string }>;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    expect(shared[0]).toMatchObject({ id: privateNoteId });

    // But the member still cannot change it.
    await expect(
      updateNote({
        campaignId: undefined,
        characterId,
        noteId: privateNoteId,
        title: "Hijacked",
      })
    ).rejects.toBeTruthy();
  });
});
