import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { getSupabaseClient } from "config/supabase.config";
import { createCharacter } from "api-calls/character/createCharacter";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { addNote } from "api-calls/notes/addNote";
import { updateNoteShared } from "api-calls/notes/updateNoteShared";
import { decodeNoteContent } from "api-calls/notes/noteContent";
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
  synced: () => boolean;
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
  return { provider, doc, events, synced: () => syncedFlag };
}

/** Best-effort restart of the stack's note server; false when unavailable. */
function tryRestartHocuspocus(): boolean {
  try {
    const names = execFileSync(
      "docker",
      ["ps", "--format", "{{.Names}}", "--filter", "name=hocuspocus"],
      { encoding: "utf8" }
    )
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return false;
    execFileSync("docker", ["restart", names[0]], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function waitForGatewayHealthy(cfg: LiveStackConfig): Promise<void> {
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      const response = await fetch(`${cfg.url}/hocuspocus/`);
      if (response.ok) return;
    } catch {
      // The container is still booting.
    }
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for the note server to come back");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

describe.skipIf(!config)("shared note editing on the note server", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const connected: ConnectedNote[] = [];

  afterEach(async () => {
    for (const note of connected.splice(0)) note.provider.destroy();
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function ownCharacterNote(owner: LivePerson): Promise<string> {
    await signInAs(owner);
    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Sheet",
      stats: {},
      assets: [],
    });
    const noteId = await addNote({ characterId, order: 0 });
    await signOut();
    return noteId;
  }

  async function sharedCampaignNote(
    gm: LivePerson,
    player: LivePerson
  ): Promise<{ campaignId: string; noteId: string }> {
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Shared editing",
      campaignType: CampaignType.Guided,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    await signInAs(gm);
    const noteId = await addNote({ campaignId, order: 0, shared: true });
    await signOut();
    return { campaignId, noteId };
  }

  it("persists a solo edit to the note row within seconds", { timeout: 120000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const noteId = await ownCharacterNote(owner);

    const note = await connectNote(cfg, owner, `character-notes/${noteId}`);
    connected.push(note);
    note.doc.getText("body").insert(0, "A lone player writes.");

    // The server writes the document to the note's content row on its
    // debounce; the row is the proof the bytes reached Postgres.
    const stored = await waitFor(async () => {
      const read = await owner.client
        .from("character_note_contents")
        .select("content")
        .eq("note_id", noteId)
        .maybeSingle();
      return read.data?.content ? (read.data.content as string) : null;
    }, 60000);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, decodeNoteContent(stored as string));
    expect(fresh.getText("body").toString()).toBe("A lone player writes.");
  });

  it("merges two people's concurrent edits", { timeout: 120000 }, async () => {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    people.push(gm, player);
    const { noteId } = await sharedCampaignNote(gm, player);

    const gmNote = await connectNote(cfg, gm, `campaign-notes/${noteId}`);
    const playerNote = await connectNote(cfg, player, `campaign-notes/${noteId}`);
    connected.push(gmNote, playerNote);

    gmNote.doc.getText("body").insert(0, "Hello ");
    playerNote.doc.getText("body").insert(0, "world");
    const merged = await waitFor(() => {
      const a = gmNote.doc.getText("body").toString();
      const b = playerNote.doc.getText("body").toString();
      return a.includes("Hello ") && a.includes("world") && a === b ? a : null;
    }, 60000);
    expect(merged).toContain("Hello ");
    expect(merged).toContain("world");
  });

  it("refuses connections without access", { timeout: 120000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, outsider);
    const noteId = await ownCharacterNote(owner);
    const documentName = `character-notes/${noteId}`;

    // An outsider's valid token opens nothing.
    await expect(connectNote(cfg, outsider, documentName)).rejects.toThrow(
      /access refused/
    );

    // A forged token opens nothing.
    const doc = new Y.Doc();
    const events: string[] = [];
    const forged = new HocuspocusProvider({
      url: hocuspocusUrl(cfg),
      name: documentName,
      document: doc,
      token: "forged.token.here",
      onSynced: () => events.push("synced"),
      onAuthenticationFailed: ({ reason }) =>
        events.push(`authfailed:${reason ?? "refused"}`),
    });
    connected.push({
      provider: forged,
      doc,
      events,
      synced: () => events.includes("synced"),
    });
    await waitFor(
      () => (events.some((event) => event.startsWith("authfailed")) ? true : null),
      30000
    );
    expect(events).not.toContain("synced");

    // A valid token for a note that does not exist opens nothing.
    await expect(
      connectNote(
        cfg,
        owner,
        "character-notes/99999999-9999-9999-9999-999999999999"
      )
    ).rejects.toThrow(/access refused/);
  });

  it("cuts off a connected editor when their note is unshared", { timeout: 120000 }, async () => {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    people.push(gm, player);
    const { campaignId, noteId } = await sharedCampaignNote(gm, player);

    const gmNote = await connectNote(cfg, gm, `campaign-notes/${noteId}`);
    const playerNote = await connectNote(cfg, player, `campaign-notes/${noteId}`);
    connected.push(gmNote, playerNote);
    playerNote.provider.on("close", () => playerNote.events.push("close"));

    await signInAs(gm);
    await updateNoteShared({
      campaignId,
      characterId: undefined,
      noteId,
      shared: false,
    });
    await signOut();

    // The player loses live access: their connection closes.
    await waitFor(
      () => (playerNote.events.includes("close") ? true : null),
      60000
    );

    // The GM stays connected and keeps editing.
    gmNote.doc.getText("body").insert(0, "GM only now");
    await waitFor(
      () => (gmNote.doc.getText("body").toString().includes("GM only now") ? true : null),
      30000
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(playerNote.doc.getText("body").toString()).not.toContain(
      "GM only now"
    );
  });

  it("survives a container restart", { timeout: 180000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    const noteId = await ownCharacterNote(owner);

    const note = await connectNote(cfg, owner, `character-notes/${noteId}`);
    note.doc.getText("body").insert(0, "Survives the restart.");
    await waitFor(async () => {
      const read = await owner.client
        .from("character_note_contents")
        .select("content")
        .eq("note_id", noteId)
        .maybeSingle();
      return read.data?.content ? true : null;
    }, 60000);
    note.provider.destroy();
    connected.splice(connected.indexOf(note), 1);

    if (!tryRestartHocuspocus()) {
      console.warn("hocuspocus restart test skipped: no container found");
      return;
    }
    await waitForGatewayHealthy(cfg);

    // A fresh connection reads the persisted document back.
    const revived = await connectNote(cfg, owner, `character-notes/${noteId}`);
    connected.push(revived);
    expect(revived.doc.getText("body").toString()).toBe("Survives the restart.");
  });
});
