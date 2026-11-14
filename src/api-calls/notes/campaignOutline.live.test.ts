import { afterEach, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { addNote } from "api-calls/notes/addNote";
import { updateNote } from "api-calls/notes/updateNote";
import { updateNoteShared } from "api-calls/notes/updateNoteShared";
import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import { listenToNotes } from "api-calls/notes/listenToNotes";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import { getAllNotesWithContent } from "api-calls/notes/getAllNotesWithContent";
import type { Note } from "types/Notes.type";
import {
  createPerson,
  deletePerson,
  hocuspocusUrl,
  liveStackConfig,
  personToken,
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

interface ConnectedNote {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  events: string[];
}

/**
 * Opens a note document on the stack's note server as the given person.
 * Resolves once the provider synced; rejects when access is refused.
 */
async function connectNote(
  cfg: LiveStackConfig,
  person: LivePerson,
  documentName: string
): Promise<ConnectedNote> {
  const token = await personToken(person);
  const doc = new Y.Doc();
  const events: string[] = [];
  let syncedFlag = false;
  const provider = new HocuspocusProvider({
    url: hocuspocusUrl(cfg),
    name: documentName,
    document: doc,
    token,
    onSynced: () => {
      syncedFlag = true;
      events.push("synced");
    },
    onAuthenticationFailed: ({ reason }) => {
      events.push(`authfailed:${reason ?? "refused"}`);
    },
  });
  await waitFor(
    () =>
      syncedFlag || events.some((event) => event.startsWith("authfailed"))
        ? true
        : null,
    30000
  );
  if (!syncedFlag) {
    provider.destroy();
    throw new Error(`access refused for ${person.tag}: ${events.join(",")}`);
  }
  return { provider, doc, events };
}

describe.skipIf(!config)("campaign outline end to end (#131)", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const unsubscribes: Array<() => void> = [];
  const connected: ConnectedNote[] = [];

  afterEach(async () => {
    for (const note of connected.splice(0)) note.provider.destroy();
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
      campaignName: "Outlined quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    return { gm, player, outsider, campaignId };
  }

  async function promoteToGm(
    gm: LivePerson,
    campaignId: string,
    target: LivePerson
  ): Promise<void> {
    const promoted = await gm.client
      .from("campaign_members")
      .update({ role: "gm" })
      .eq("campaign_id", campaignId)
      .eq("user_id", target.userId)
      .select();
    expect(promoted.error).toBeNull();
  }

  it("a GM creates, reads and edits one shared outline", { timeout: 120000 }, async () => {
    const { gm, campaignId } = await setUpCampaign();
    await signInAs(gm);

    const first = await getOrCreateCampaignOutline({ campaignId });
    expect(typeof first).toBe("string");
    const second = await getOrCreateCampaignOutline({ campaignId });
    expect(second).toBe(first);

    const row = await gm.client
      .from("campaign_notes")
      .select("id, kind, shared, title")
      .eq("id", first)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      id: first,
      kind: "outline",
      shared: false,
    });

    await updateNote({
      campaignId,
      characterId: undefined,
      noteId: first,
      title: "Our story so far",
    });
    const reread = await gm.client
      .from("campaign_notes")
      .select("title")
      .eq("id", first)
      .single();
    expect(reread.data?.title).toBe("Our story so far");
  });

  it("shares the outline live between co-GMs", { timeout: 180000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await promoteToGm(gm, campaignId, player);

    // The co-GM opens the same outline row the GM created.
    await signInAs(gm);
    const outlineId = await getOrCreateCampaignOutline({ campaignId });
    await signOut();
    await signInAs(player);
    const same = await getOrCreateCampaignOutline({ campaignId });
    expect(same).toBe(outlineId);

    // The co-GM follows the campaign notes live while the GM retitles
    // the outline through their own client.
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
    await waitFor(() =>
      seen.length >= 1 &&
      seen.at(-1)?.some((note) => note.noteId === outlineId)
        ? seen
        : null
    );
    await gm.client
      .from("campaign_notes")
      .update({ title: "Co-written plan" })
      .eq("id", outlineId);
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.title === "Co-written plan")
        ? seen
        : null
    );

    // Outline bytes travel through the note server: the GM writes, the
    // co-GM reads the same text back over live updates.
    const contents: Array<Uint8Array | undefined> = [];
    unsubscribes.push(
      listenToNoteContent(
        campaignId,
        undefined,
        outlineId,
        (content) => contents.push(content),
        (error) => {
          throw error;
        }
      )
    );
    const gmNote = await connectNote(cfg, gm, `campaign-notes/${outlineId}`);
    connected.push(gmNote);
    gmNote.doc.getText("body").insert(0, "Act one: the bell rings.");
    await waitFor(() => {
      const latest = contents.at(-1);
      if (!latest) return null;
      const fresh = new Y.Doc();
      Y.applyUpdate(fresh, latest);
      return fresh.getText("body").toString().includes("Act one")
        ? true
        : null;
    }, 60000);
  });

  it("keeps the outline from players and outsiders everywhere", { timeout: 180000 }, async () => {
    const { gm, player, outsider, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const outlineId = await getOrCreateCampaignOutline({ campaignId });

    // A shared regular note proves the player's subscription works while
    // the outline stays invisible beside it.
    const sharedId = await addNote({ campaignId, order: 0, shared: true });
    await signOut();

    for (const person of [player, outsider]) {
      const notes = await person.client
        .from("campaign_notes")
        .select("id")
        .eq("campaign_id", campaignId);
      expect(notes.error).toBeNull();
      const ids = ((notes.data ?? []) as Array<{ id: string }>).map(
        (row) => row.id
      );
      expect(ids).not.toContain(outlineId);
      if (person === outsider) {
        expect(ids).toEqual([]);
      } else {
        // The player sees the shared note but never the outline.
        expect(ids).toEqual([sharedId]);
      }

      const contents = await person.client
        .from("campaign_note_contents")
        .select("note_id")
        .eq("note_id", outlineId);
      expect(contents.error).toBeNull();
      expect(contents.data ?? []).toEqual([]);

      // getOrCreate through the data layer fails for non-GMs.
      await signInAs(person);
      await expect(
        getOrCreateCampaignOutline({ campaignId })
      ).rejects.toBeTruthy();
      const withContent = await getAllNotesWithContent({
        source: "campaign",
        ownerId: campaignId,
      });
      expect(
        withContent.map((entry) => entry.noteId)
      ).not.toContain(outlineId);
      expect(withContent.map((entry) => entry.noteId)).toEqual(
        person === outsider
          ? []
          : expect.arrayContaining([sharedId])
      );
      await signOut();

      // The note server refuses the outline document to non-GMs.
      await expect(
        connectNote(cfg, person, `campaign-notes/${outlineId}`)
      ).rejects.toThrow(/access refused/);
    }

    // The player's live note list carries the shared note but never the
    // outline, even after the GM edits it.
    await signInAs(player);
    const seen: Note[][] = [];
    unsubscribes.push(
      listenToNotes(campaignId, undefined, (_source, notes) => seen.push(notes), () => {})
    );
    await waitFor(() =>
      seen.at(-1)?.some((note) => note.noteId === sharedId) ? seen : null
    );
    expect(seen.at(-1)?.some((note) => note.noteId === outlineId)).toBe(false);
    await gm.client
      .from("campaign_notes")
      .update({ title: "Still secret" })
      .eq("id", outlineId);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(seen.every((notes) => notes.every((note) => note.noteId !== outlineId))).toBe(true);
    await signOut();
  });

  it("refuses sharing flips and a second outline", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const outlineId = await getOrCreateCampaignOutline({ campaignId });

    // A player cannot flip the outline to shared.
    await signInAs(player);
    await expect(
      updateNoteShared({
        campaignId,
        characterId: undefined,
        noteId: outlineId,
        shared: true,
      })
    ).rejects.toBeTruthy();
    const deniedFlip = await player.client
      .from("campaign_notes")
      .update({ shared: true })
      .eq("id", outlineId)
      .select("id");
    expect(deniedFlip.error ? [] : (deniedFlip.data ?? [])).toEqual([]);
    await signOut();

    // Neither can the GM: the outline is never shared with players.
    await signInAs(gm);
    await expect(
      updateNoteShared({
        campaignId,
        characterId: undefined,
        noteId: outlineId,
        shared: true,
      })
    ).rejects.toBeTruthy();
    const stillPrivate = await gm.client
      .from("campaign_notes")
      .select("shared")
      .eq("id", outlineId)
      .single();
    expect(stillPrivate.data?.shared).toBe(false);

    // A second outline for the same campaign is refused, as is smuggling
    // `shared` into the creation.
    const refusedSecond = await gm.client.from("campaign_notes").insert({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      kind: "outline",
      title: "Rival plan",
      shared: false,
      sort_order: 1,
    });
    expect(refusedSecond.error).not.toBeNull();
    const refusedShared = await gm.client.from("campaign_notes").insert({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      kind: "outline",
      title: "Shared plan",
      shared: true,
      sort_order: 1,
    });
    expect(refusedShared.error).not.toBeNull();

    // A player cannot create an outline row at all.
    const refusedPlayer = await player.client.from("campaign_notes").insert({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      kind: "outline",
      title: "Hijacked plan",
      shared: false,
      sort_order: 1,
    });
    expect(refusedPlayer.error).not.toBeNull();
    await signOut();
  });
});
