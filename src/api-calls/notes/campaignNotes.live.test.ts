import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { addNote } from "api-calls/notes/addNote";
import { updateNote } from "api-calls/notes/updateNote";
import { updateNoteShared } from "api-calls/notes/updateNoteShared";
import { updateNoteOrder } from "api-calls/notes/updateNoteOrder";
import { removeNote } from "api-calls/notes/removeNote";
import { deleteNotes } from "api-calls/notes/deleteNotes";
import { listenToNotes } from "api-calls/notes/listenToNotes";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import type { Note } from "types/Notes.type";
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

describe.skipIf(!config)("campaign notes end to end", () => {
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
      campaignName: "Shared notes",
      campaignType: CampaignType.Guided,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    return { gm, player, outsider, campaignId };
  }

  it("saves campaign notes and streams their contents live", { timeout: 120000 }, async () => {
    const { gm, campaignId } = await setUpCampaign();
    await signInAs(gm);

    const seen: Note[][] = [];
    unsubscribes.push(
      listenToNotes(
        campaignId,
        undefined,
        (_source, notes) => seen.push(notes),
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));

    const noteId = await addNote({ campaignId, order: 0 });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId) ? seen : null
    );

    const contents: Array<Uint8Array | undefined> = [];
    unsubscribes.push(
      listenToNoteContent(
        campaignId,
        undefined,
        noteId,
        (content) => contents.push(content),
        (error) => {
          throw error;
        }
      )
    );
    await updateNote({
      campaignId,
      characterId: undefined,
      noteId,
      title: "Marching order",
    });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.title === "Marching order")
        ? seen
        : null
    );

    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: true,
    });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId && note.shared)
        ? seen
        : null
    );

    await updateNoteOrder({
      campaignId,
      characterId: undefined,
      noteId,
      order: 3,
    });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId && note.order === 3)
        ? seen
        : null
    );

    await removeNote({ campaignId, noteId });
    await waitFor(() =>
      seen.at(-1)?.every((note) => note.noteId !== noteId) ? seen : null
    );

    const secondId = await addNote({ campaignId, order: 1 });
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === secondId) ? seen : null
    );
    await deleteNotes({ campaignId });
    await waitFor(() =>
      seen.at(-1)?.every((note) => note.noteId !== secondId) ? seen : null
    );
  });

  it("blocks outsiders from every campaign note table", { timeout: 90000 }, async () => {
    const { gm, outsider, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const noteId = await addNote({ campaignId, order: 0, shared: true });
    await updateNote({
      campaignId,
      characterId: undefined,
      noteId,
      title: "Shared plan",
    });

    for (const [table, column] of [
      ["campaign_notes", "campaign_id"],
      ["campaign_note_contents", "note_id"],
    ]) {
      const read = await outsider.client
        .from(table)
        .select("id")
        .eq(column, table === "campaign_notes" ? campaignId : noteId);
      expect(read.error).toBeNull();
      expect(read.data ?? []).toEqual([]);
    }

    const deniedInsert = await outsider.client.from("campaign_notes").insert({
      campaign_id: campaignId,
      sort_order: 0,
      title: "Hijacked",
    });
    expect(deniedInsert.error).not.toBeNull();

    const deniedUpdate = await outsider.client
      .from("campaign_notes")
      .update({ title: "Hijacked" })
      .eq("id", noteId)
      .select("id");
    expect(deniedUpdate.data ?? []).toEqual([]);

    await signOut();
    await signInAs(outsider);
    await expect(addNote({ campaignId, order: 1 })).rejects.toBeTruthy();
    await expect(
      updateNote({
        campaignId,
        characterId: undefined,
        noteId,
        title: "Hijacked",
      })
    ).rejects.toBeTruthy();
  });

  it("never leaks unshared campaign notes, including over live updates", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const noteId = await addNote({ campaignId, order: 0 });

    // The player is a member but the note is unshared: nothing leaks.
    const playerNotes = await player.client
      .from("campaign_notes")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(playerNotes.error).toBeNull();
    expect(playerNotes.data ?? []).toEqual([]);
    const playerContents = await player.client
      .from("campaign_note_contents")
      .select("note_id")
      .eq("note_id", noteId);
    expect(playerContents.error).toBeNull();
    expect(playerContents.data ?? []).toEqual([]);

    // The player follows the notes live; the unshared note never arrives.
    await signOut();
    await signInAs(player);
    const seen: Note[][] = [];
    unsubscribes.push(
      listenToNotes(
        campaignId,
        undefined,
        (_source, notes) => seen.push(notes),
        () => {}
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    expect(seen.at(-1) ?? []).toEqual([]);

    await gm.client.from("campaign_notes").update({ title: "Still secret" }).eq("id", noteId);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(seen.every((notes) => notes.length === 0)).toBe(true);

    // Sharing opens exactly that note to the player, live.
    await signOut();
    await signInAs(gm);
    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: true,
    });
    const shared = await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId) ? seen : null
    );
    expect(shared.at(-1)?.find((note) => note.noteId === noteId)).toMatchObject({
      noteId,
      shared: true,
    });

    // Unsharing hides it again, live.
    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: false,
    });
    await waitFor(() =>
      seen.at(-1)?.every((note) => note.noteId !== noteId) ? seen : null
    );
  });

  it("lets the GM see unshared notes and lets members write", { timeout: 90000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(player);
    const noteId = await addNote({ campaignId, order: 0 });

    // The player cannot see their own unshared note, but the GM can.
    const reread = await player.client
      .from("campaign_notes")
      .select("id")
      .eq("id", noteId);
    expect(reread.data ?? []).toEqual([]);
    const gmRead = await gm.client
      .from("campaign_notes")
      .select("id")
      .eq("id", noteId);
    expect((gmRead.data ?? []).map((row) => row.id)).toEqual([noteId]);

    // Any member may retitle a note they can see: share it, then edit.
    await signOut();
    await signInAs(gm);
    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: true,
    });
    await signOut();
    await signInAs(player);
    await updateNote({
      campaignId,
      characterId: undefined,
      noteId,
      title: "Player edit",
    });
    const edited = await gm.client
      .from("campaign_notes")
      .select("title")
      .eq("id", noteId)
      .single();
    expect(edited.data?.title).toBe("Player edit");
  });
});
