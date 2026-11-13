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
      campaignType: CampaignType.Coop,
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
        .select(table === "campaign_note_contents" ? "note_id" : "id")
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
    // The singleton takes the player's session before subscribing and
    // keeps it for the whole live phase: the GM acts through their own
    // client, so the subscription never rides a mid-stream identity
    // switch (which stalls the channel).
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

    // Sharing opens exactly that note to the player, live. The GM writes
    // through their own client — byte-identical to updateNoteShared —
    // while the player still listens.
    const sharedOn = await gm.client
      .from("campaign_notes")
      .update({ shared: true })
      .eq("id", noteId)
      .eq("campaign_id", campaignId)
      .select("id");
    expect(sharedOn.error).toBeNull();
    expect(sharedOn.data ?? []).not.toEqual([]);
    const shared = await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === noteId) ? seen : null
    );
    expect(shared.at(-1)?.find((note) => note.noteId === noteId)).toMatchObject({
      noteId,
      shared: true,
    });

    // Unsharing hides it again, live: the GM writes through their own
    // client while the player still listens.
    const sharedOff = await gm.client
      .from("campaign_notes")
      .update({ shared: false })
      .eq("id", noteId)
      .eq("campaign_id", campaignId)
      .select("id");
    expect(sharedOff.error).toBeNull();
    expect(sharedOff.data ?? []).not.toEqual([]);
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

  it("refuses contents writes to notes the writer cannot read (#106)", { timeout: 90000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const noteId = await addNote({ campaignId, order: 0 });
    // Seed the contents row as the GM, who can read the unshared draft.
    const seed = await gm.client
      .from("campaign_note_contents")
      .insert({ note_id: noteId, content: "e30=" })
      .select("note_id");
    expect(seed.error).toBeNull();

    // The player cannot see the unshared draft, so neither insert nor
    // update of its contents may go through.
    const deniedInsert = await player.client
      .from("campaign_note_contents")
      .insert({ note_id: noteId, content: "e30=" });
    expect(deniedInsert.error).not.toBeNull();
    const deniedUpdate = await player.client
      .from("campaign_note_contents")
      .update({ content: "e30=" })
      .eq("note_id", noteId)
      .select("note_id");
    expect(deniedUpdate.error ? [] : (deniedUpdate.data ?? [])).toEqual([]);
  });

  it("locks shared, move and delete to the note author or a GM (#106)", { timeout: 90000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const noteId = await addNote({ campaignId, order: 0 });
    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: true,
    });

    // A second campaign the player also belongs to, so a move would pass
    // the membership checks and only the campaign lock can stop it.
    const otherId = await createCampaign({
      uid: gm.userId,
      campaignName: "Other campaign",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId: otherId });
    await signOut();

    // The player sees the shared note but did not write it: shared flips,
    // moves and deletes all fail.
    const deniedShared = await player.client
      .from("campaign_notes")
      .update({ shared: false })
      .eq("id", noteId)
      .select("id");
    expect(deniedShared.error ? [] : (deniedShared.data ?? [])).toEqual([]);
    const deniedMove = await player.client
      .from("campaign_notes")
      .update({ campaign_id: otherId })
      .eq("id", noteId)
      .select("id");
    expect(deniedMove.error ? [] : (deniedMove.data ?? [])).toEqual([]);
    const deniedDelete = await player.client
      .from("campaign_notes")
      .delete()
      .eq("id", noteId)
      .select("id");
    expect(deniedDelete.error ? [] : (deniedDelete.data ?? [])).toEqual([]);

    // Retitling a note they can see still works for members.
    const allowedTitle = await player.client
      .from("campaign_notes")
      .update({ title: "Player edit" })
      .eq("id", noteId)
      .select("id");
    expect(allowedTitle.error).toBeNull();
    expect((allowedTitle.data ?? []).map((row) => row.id)).toEqual([noteId]);

    // The GM, who authored the note, can flip shared back and delete it.
    await signInAs(gm);
    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: false,
    });
    await removeNote({ campaignId, noteId });
  });

  it("blocks a removed author from updating or deleting their note (#106)", { timeout: 90000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(player);
    const noteId = await addNote({ campaignId, order: 0 });
    await signOut();

    // Share the player's draft so the author can see it while a member.
    // (Unshared notes are invisible to players, so even the returning
    // SELECT stays empty; sharing keeps the write proof readable.)
    const shared = await gm.client
      .from("campaign_notes")
      .update({ shared: true })
      .eq("id", noteId)
      .select("id");
    expect(shared.error).toBeNull();

    // While still a member the author may retitle the shared note.
    const allowedWhileMember = await player.client
      .from("campaign_notes")
      .update({ title: "Draft" })
      .eq("id", noteId)
      .select("id");
    expect(allowedWhileMember.error).toBeNull();
    expect(
      ((allowedWhileMember.data ?? []) as Array<{ id: string }>).map(
        (row) => row.id
      )
    ).toEqual([noteId]);
    const draftRead = await gm.client
      .from("campaign_notes")
      .select("id, title")
      .eq("id", noteId)
      .single();
    expect(draftRead.error).toBeNull();
    expect(draftRead.data?.title).toBe("Draft");

    // The GM removes the author from the campaign.
    const kicked = await gm.client.rpc("remove_campaign_member", {
      cid: campaignId,
      target_uid: player.userId,
    });
    expect(kicked.error).toBeNull();

    // The removed author can no longer update, share, or delete, even
    // though they wrote the note. Returning SELECTs stay empty for lack
    // of read access too, so the GM re-reads to prove nothing changed.
    const deniedUpdate = await player.client
      .from("campaign_notes")
      .update({ title: "Hijacked" })
      .eq("id", noteId)
      .select("id");
    expect(deniedUpdate.error ? [] : (deniedUpdate.data ?? [])).toEqual([]);
    const deniedShared = await player.client
      .from("campaign_notes")
      .update({ shared: false })
      .eq("id", noteId)
      .select("id");
    expect(deniedShared.error ? [] : (deniedShared.data ?? [])).toEqual([]);
    const deniedDelete = await player.client
      .from("campaign_notes")
      .delete()
      .eq("id", noteId)
      .select("id");
    expect(deniedDelete.error ? [] : (deniedDelete.data ?? [])).toEqual([]);

    // The note is still there for the GM, unchanged.
    const gmRead = await gm.client
      .from("campaign_notes")
      .select("id, title, shared")
      .eq("id", noteId)
      .single();
    expect(gmRead.error).toBeNull();
    expect(gmRead.data?.id).toBe(noteId);
    expect(gmRead.data?.title).toBe("Draft");
    expect(gmRead.data?.shared).toBe(true);
  });

  it("deleting an author's account keeps the note and clears the author (#106)", { timeout: 90000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(player);
    const noteId = await addNote({ campaignId, order: 0 });
    await signOut();

    // Removing the account must not trip the author-change guard: the
    // foreign key clears the author to NULL.
    await deletePerson(cfg, player.userId);
    people = people.filter((person) => person.userId !== player.userId);

    const reread = await gm.client
      .from("campaign_notes")
      .select("id, created_by")
      .eq("id", noteId);
    expect(reread.error).toBeNull();
    const rows = (reread.data ?? []) as Array<{
      id: string;
      created_by: string | null;
    }>;
    expect(rows.map((row) => row.id)).toEqual([noteId]);
    expect(rows[0]?.created_by).toBeNull();

    // The GM still manages the orphaned note.
    const deleted = await gm.client
      .from("campaign_notes")
      .delete()
      .eq("id", noteId)
      .select("id");
    expect(deleted.error).toBeNull();
    expect(
      ((deleted.data ?? []) as Array<{ id: string }>).map((row) => row.id)
    ).toEqual([noteId]);
  });
});
