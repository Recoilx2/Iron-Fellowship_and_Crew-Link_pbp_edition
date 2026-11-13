import { afterEach, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { updateCampaignWorld } from "api-calls/campaign/updateCampaignWorld";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { createWorld } from "api-calls/world/createWorld";
import { createLocation } from "api-calls/world/locations/createLocation";
import { updateLocation } from "api-calls/world/locations/updateLocation";
import { getWorldItemNoteIds } from "api-calls/world/worldNotes";
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
 * Opens a world document on the stack's note server as the given person.
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

describe.skipIf(!config)("world notes on the note server", () => {
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

  async function setUpLinkedLocation(): Promise<{
    owner: LivePerson;
    player: LivePerson;
    outsider: LivePerson;
    worldId: string;
    locationId: string;
    publicNoteId: string;
    gmNoteId: string;
  }> {
    const owner = await createPerson(cfg, "owner");
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, gm, player, outsider);
    await signInAs(owner);
    const worldId = await createWorld({ name: "Noted world" });
    const locationId = await createLocation({ worldId });
    const { publicNoteId, gmNoteId } = await getWorldItemNoteIds(
      "location",
      locationId
    );
    await signOut();
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Noted campaign",
      campaignType: CampaignType.Coop,
    });
    await updateCampaignWorld({ campaignId, gmIds: [], worldId });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    if (!publicNoteId || !gmNoteId) {
      throw new Error("world item notes were not created with the location");
    }
    return { owner, player, outsider, worldId, locationId, publicNoteId, gmNoteId };
  }

  it("persists a GM's edit to the world note row within seconds", { timeout: 120000 }, async () => {
    const { owner, publicNoteId } = await setUpLinkedLocation();
    const note = await connectNote(cfg, owner, `world-notes/${publicNoteId}`);
    connected.push(note);
    note.doc.getText("body").insert(0, "A GM describes the vault.");

    const stored = await waitFor<string>(async () => {
      const read = await owner.client
        .from("world_note_contents")
        .select("content")
        .eq("note_id", publicNoteId)
        .maybeSingle();
      const content: unknown = read.data?.content;
      return typeof content === "string" && content ? content : null;
    }, 60000);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, decodeNoteContent(stored));
    expect(fresh.getText("body").toString()).toBe(
      "A GM describes the vault."
    );
  });

  it("persists world description edits beside the world row", { timeout: 120000 }, async () => {
    const { owner, worldId } = await setUpLinkedLocation();
    const note = await connectNote(
      cfg,
      owner,
      `world-descriptions/${worldId}`
    );
    connected.push(note);
    note.doc.getText("body").insert(0, "A world of iron and snow.");

    const stored = await waitFor<string>(async () => {
      const read = await owner.client
        .from("worlds")
        .select("description")
        .eq("id", worldId)
        .maybeSingle();
      const description: unknown = read.data?.description;
      return typeof description === "string" && description ? description : null;
    }, 60000);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, decodeNoteContent(stored));
    expect(fresh.getText("body").toString()).toBe("A world of iron and snow.");
  });

  it("refuses note connections without access", { timeout: 120000 }, async () => {
    const { owner, player, outsider, publicNoteId, gmNoteId, worldId } =
      await setUpLinkedLocation();

    // The player reads the public note but never the GM-only one.
    const playerNote = await connectNote(
      cfg,
      player,
      `world-notes/${publicNoteId}`
    );
    connected.push(playerNote);
    await expect(
      connectNote(cfg, player, `world-notes/${gmNoteId}`)
    ).rejects.toThrow(/access refused/);

    // An outsider's valid token opens neither the note nor the description.
    await expect(
      connectNote(cfg, outsider, `world-notes/${publicNoteId}`)
    ).rejects.toThrow(/access refused/);
    await expect(
      connectNote(cfg, outsider, `world-descriptions/${worldId}`)
    ).rejects.toThrow(/access refused/);

    // But the owner opens the description, and a forged token opens nothing.
    const description = await connectNote(
      cfg,
      owner,
      `world-descriptions/${worldId}`
    );
    connected.push(description);
    const doc = new Y.Doc();
    const events: string[] = [];
    const forged = new HocuspocusProvider({
      url: hocuspocusUrl(cfg),
      name: `world-notes/${publicNoteId}`,
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
  });

  it("cuts off a connected reader when their item is unshared", { timeout: 120000 }, async () => {
    const { owner, player, worldId, locationId, publicNoteId } =
      await setUpLinkedLocation();

    const ownerNote = await connectNote(
      cfg,
      owner,
      `world-notes/${publicNoteId}`
    );
    const playerNote = await connectNote(
      cfg,
      player,
      `world-notes/${publicNoteId}`
    );
    connected.push(ownerNote, playerNote);
    playerNote.provider.on("close", () => playerNote.events.push("close"));

    await signInAs(owner);
    await updateLocation({
      worldId,
      locationId,
      location: { sharedWithPlayers: false },
    });
    await signOut();

    // The player loses live access: their connection closes.
    await waitFor(
      () => (playerNote.events.includes("close") ? true : null),
      60000
    );

    // The owner stays connected and keeps editing.
    ownerNote.doc.getText("body").insert(0, "GM only now");
    await waitFor(
      () =>
        ownerNote.doc.getText("body").toString().includes("GM only now")
          ? true
          : null,
      30000
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(playerNote.doc.getText("body").toString()).not.toContain(
      "GM only now"
    );
  });
});
