import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { updateCampaignGM } from "api-calls/campaign/updateCampaignGM";
import { updateCampaignWorld } from "api-calls/campaign/updateCampaignWorld";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { createCharacter } from "api-calls/character/createCharacter";
import { createWorld } from "api-calls/world/createWorld";
import { deleteWorld } from "api-calls/world/deleteWorld";
import { updateWorld } from "api-calls/world/updateWorld";
import { updateWorldGuide } from "api-calls/world/updateWorldGuide";
import { getWorldForExport } from "api-calls/world/getWorldForExport";
import { listenToUsersWorlds } from "api-calls/world/listenToUsersWorlds";
import { listenToWorld } from "api-calls/world/listenToWorld";
import { createLocation } from "api-calls/world/locations/createLocation";
import { deleteLocation } from "api-calls/world/locations/deleteLocation";
import { listenToLocationGMNotes } from "api-calls/world/locations/listenToLocationGMNotes";
import { listenToLocationGMProperties } from "api-calls/world/locations/listenToLocationGMProperties";
import { listenToLocationNotes } from "api-calls/world/locations/listenToLocationNotes";
import { listenToLocations } from "api-calls/world/locations/listenToLocations";
import { updateLocation } from "api-calls/world/locations/updateLocation";
import { updateLocationCharacterBond } from "api-calls/world/locations/updateLocationCharacterBond";
import { updateLocationGMNotes } from "api-calls/world/locations/updateLocationGMNotes";
import { updateLocationGMProperties } from "api-calls/world/locations/updateLocationGMProperties";
import { updateLocationNotes } from "api-calls/world/locations/updateLocationNotes";
import { createLore } from "api-calls/world/lore/createLore";
import { listenToLoreDocuments } from "api-calls/world/lore/listenToLoreDocuments";
import { updateLore } from "api-calls/world/lore/updateLore";
import { createNPC } from "api-calls/world/npcs/createNPC";
import { listenToNPCs } from "api-calls/world/npcs/listenToNPCs";
import { updateNPC } from "api-calls/world/npcs/updateNPC";
import {
  getWorldItemNoteIds,
  listenToWorldNoteContent,
} from "api-calls/world/worldNotes";
import type { Location } from "types/Locations.type";
import type { World } from "api-calls/world/_world.type";

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

describe.skipIf(!config)("worlds end to end", () => {
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

  async function setUpQuartet() {
    const owner = await createPerson(cfg, "owner");
    const campaignGM = await createPerson(cfg, "campaignGM");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, campaignGM, player, outsider);
    return { owner, campaignGM, player, outsider };
  }

  /** Owner creates a world; the campaign GM links it and the player joins. */
  async function setUpLinkedWorld(parts: {
    owner: LivePerson;
    campaignGM: LivePerson;
    player: LivePerson;
  }): Promise<{ worldId: string; campaignId: string }> {
    await signInAs(parts.owner);
    const worldId = await createWorld({ name: "Linked world" });
    await signOut();
    await signInAs(parts.campaignGM);
    const campaignId = await createCampaign({
      uid: parts.campaignGM.userId,
      campaignName: "World campaign",
      campaignType: CampaignType.Coop,
    });
    await updateCampaignWorld({ campaignId, gmIds: [], worldId });
    await signOut();
    await signInAs(parts.player);
    await joinCampaign({ campaignId });
    await signOut();
    return { worldId, campaignId };
  }

  it("creates a world its owner reads and outsiders never see", { timeout: 90000 }, async () => {
    const { owner, outsider } = await setUpQuartet();
    await signInAs(owner);
    const worldId = await createWorld({ name: "Secret world" });
    const world = await getWorldForExport(worldId);
    expect(world?.name).toBe("Secret world");
    expect(world?.ownerIds).toContain(owner.userId);

    // Outsiders read nothing: no rows, no export, no listener payload.
    const outsiderRows = await outsider.client
      .from("worlds")
      .select("id")
      .eq("id", worldId);
    expect(outsiderRows.error).toBeNull();
    expect(outsiderRows.data ?? []).toEqual([]);
    await signOut();
    await signInAs(outsider);
    await expect(getWorldForExport(worldId)).resolves.toBeNull();
    await expect(
      createLocation({ worldId })
    ).rejects.toBeTruthy();
    await expect(deleteWorld(worldId)).rejects.toBeTruthy();

    const received: Array<World | undefined> = [];
    await signOut();
    await signInAs(outsider);
    unsubscribes.push(
      listenToWorld(
        worldId,
        (doc) => received.push(doc),
        () => {}
      )
    );
    await waitFor(() => (received.length >= 1 ? received : null));
    expect(received.at(-1)).toBeUndefined();

    // The owner follows their worlds live, and deleting ends them.
    await signOut();
    await signInAs(owner);
    const owned: Array<{ id: string; doc: World }> = [];
    const removed: string[] = [];
    unsubscribes.push(
      listenToUsersWorlds(
        owner.userId,
        {
          onDocChange: (id, doc) => owned.push({ id, doc }),
          onDocRemove: (id) => removed.push(id),
          onLoaded: () => {},
        },
        (error) => {
          throw error;
        }
      ) ?? (() => {})
    );
    await waitFor(() =>
      owned.some((entry) => entry.id === worldId) ? owned : null
    );
    await deleteWorld(worldId);
    await waitFor(() => (removed.includes(worldId) ? removed : null));
  });

  it("lets campaign GMs manage linked worlds while players see shared items", { timeout: 120000 }, async () => {
    const { owner, campaignGM, player, outsider } = await setUpQuartet();
    const { worldId } = await setUpLinkedWorld({ owner, campaignGM, player });

    // The owner stocks the world: one shared and one hidden location.
    await signInAs(owner);
    const sharedId = await createLocation({ worldId });
    const hiddenId = await createLocation({ worldId });
    await updateLocation({
      worldId,
      locationId: hiddenId,
      location: { name: "Hidden vault", sharedWithPlayers: false },
    });
    const loreId = await createLore({ worldId });
    await updateLore({
      worldId,
      loreId,
      lore: { name: "Hidden lore", sharedWithPlayers: false },
    });
    const npcId = await createNPC({ worldId, npc: { name: "Guide" } });

    // The campaign GM (never a world owner) renames shared items and
    // writes GM details through the access rules.
    await signOut();
    await signInAs(campaignGM);
    await updateLocation({
      worldId,
      locationId: sharedId,
      location: { name: "Renamed by the campaign GM" },
    });
    await updateLocationGMProperties({
      worldId,
      locationId: sharedId,
      locationGMProperties: { descriptor: "GM-only descriptor" },
    });
    await updateLocationGMNotes({
      worldId,
      locationId: sharedId,
      notes: new Uint8Array([7, 7]),
    });
    await updateLore({
      worldId,
      loreId,
      lore: { name: "Renamed lore" },
    });
    await updateNPC({
      worldId,
      npcId,
      npc: { name: "Renamed NPC" },
    });

    // The player reads shared items and their public notes, but no hidden
    // items, no GM details and no GM notes.
    const playerLocations = await player.client
      .from("world_locations")
      .select("id")
      .eq("world_id", worldId);
    expect(playerLocations.error).toBeNull();
    expect((playerLocations.data ?? []).map((row) => row.id)).toEqual(
      expect.arrayContaining([sharedId])
    );
    expect(
      (playerLocations.data ?? []).map((row) => row.id)
    ).not.toContain(hiddenId);
    const playerLore = await player.client
      .from("world_lore")
      .select("id")
      .eq("world_id", worldId);
    expect(playerLore.error).toBeNull();
    expect(playerLore.data ?? []).toEqual([]);
    const playerDetails = await player.client
      .from("world_location_gm_details")
      .select("location_id")
      .eq("location_id", sharedId);
    expect(playerDetails.error).toBeNull();
    expect(playerDetails.data ?? []).toEqual([]);

    const ids = await (async () => {
      await signOut();
      await signInAs(owner);
      return getWorldItemNoteIds("location", sharedId);
    })();
    expect(ids.publicNoteId).toBeTruthy();
    const publicContents = await player.client
      .from("world_note_contents")
      .select("note_id")
      .eq("note_id", ids.publicNoteId as string);
    expect(publicContents.error).toBeNull();
    const gmContents = await player.client
      .from("world_note_contents")
      .select("note_id")
      .eq("note_id", ids.gmNoteId as string);
    expect(gmContents.error).toBeNull();
    expect(gmContents.data ?? []).toEqual([]);

    // Player writes fail everywhere; outsiders read nothing at all.
    await signOut();
    await signInAs(player);
    await expect(
      updateLocation({
        worldId,
        locationId: sharedId,
        location: { name: "Hijacked" },
      })
    ).rejects.toBeTruthy();
    await expect(
      updateLocationGMProperties({
        worldId,
        locationId: sharedId,
        locationGMProperties: { descriptor: "Hijacked" },
      })
    ).rejects.toBeTruthy();
    const outsiderWorlds = await outsider.client
      .from("worlds")
      .select("id")
      .eq("id", worldId);
    expect(outsiderWorlds.error).toBeNull();
    expect(outsiderWorlds.data ?? []).toEqual([]);
    const outsiderNotes = await outsider.client
      .from("world_notes")
      .select("id")
      .eq("world_id", worldId);
    expect(outsiderNotes.error).toBeNull();
    expect(outsiderNotes.data ?? []).toEqual([]);
  });

  it("keeps ownership with owners: campaign GMs cannot self-promote or delete", { timeout: 90000 }, async () => {
    const { owner, campaignGM, player } = await setUpQuartet();
    const { worldId } = await setUpLinkedWorld({ owner, campaignGM, player });

    // A hostile campaign GM tries every path to ownership. The direct row
    // write hits the owner-change trigger and the guide RPC is owners-only,
    // so both fail and the owners list never changes.
    await signInAs(campaignGM);
    const hostile = await campaignGM.client
      .from("worlds")
      .update({ owner_ids: [campaignGM.userId] })
      .eq("id", worldId);
    expect(hostile.error).toBeTruthy();
    await expect(
      updateWorldGuide({ worldId, guideId: campaignGM.userId })
    ).rejects.toBeTruthy();
    const ownersAfter = await owner.client
      .from("worlds")
      .select("owner_ids")
      .eq("id", worldId)
      .single();
    expect(ownersAfter.error).toBeNull();
    expect(
      (ownersAfter.data as { owner_ids: string[] }).owner_ids
    ).not.toContain(campaignGM.userId);

    // The GM still edits everything else, but cannot delete the world: the
    // owner-only delete policy matches no row for them, so the delete is a
    // silent no-op and the world survives with its owners intact.
    await updateWorld({ worldId, partialWorld: { name: "GM rename" } });
    await deleteWorld(worldId).catch(() => undefined);
    const survived = await owner.client
      .from("worlds")
      .select("id, name, owner_ids")
      .eq("id", worldId)
      .single();
    expect(survived.error).toBeNull();
    expect(
      (survived.data as { name: string; owner_ids: string[] }).name
    ).toBe("GM rename");
    expect(
      (survived.data as { name: string; owner_ids: string[] }).owner_ids
    ).not.toContain(campaignGM.userId);

    // The owner still manages guides end to end and can delete.
    await signOut();
    await signInAs(owner);
    await updateWorldGuide({ worldId, guideId: campaignGM.userId });
    const promoted = await owner.client
      .from("worlds")
      .select("owner_ids")
      .eq("id", worldId)
      .single();
    expect(promoted.error).toBeNull();
    expect(
      (promoted.data as { owner_ids: string[] }).owner_ids
    ).toContain(campaignGM.userId);
    await updateWorldGuide({
      worldId,
      guideId: campaignGM.userId,
      shouldRemove: true,
    });
    const demoted = await owner.client
      .from("worlds")
      .select("owner_ids")
      .eq("id", worldId)
      .single();
    expect(demoted.error).toBeNull();
    expect(
      (demoted.data as { owner_ids: string[] }).owner_ids
    ).not.toContain(campaignGM.userId);
    await deleteWorld(worldId);
    const gone = await owner.client
      .from("worlds")
      .select("id")
      .eq("id", worldId);
    expect(gone.error).toBeNull();
    expect(gone.data ?? []).toEqual([]);
  });

  it("streams sharing changes live: share appears, unshare disappears", { timeout: 120000 }, async () => {
    const { owner, campaignGM, player } = await setUpQuartet();
    const { worldId } = await setUpLinkedWorld({ owner, campaignGM, player });

    await signInAs(owner);
    const locationId = await createLocation({ worldId });
    await updateLocation({
      worldId,
      locationId,
      location: { name: "Secret room", sharedWithPlayers: false },
    });

    // The player follows the world's locations live.
    await signOut();
    await signInAs(player);
    const tracked: Array<{ id: string; doc: Location }> = [];
    const names: string[][] = [];
    unsubscribes.push(
      listenToLocations(
        worldId,
        (id, doc) => {
          const entry = tracked.find((item) => item.id === id);
          if (entry) entry.doc = doc;
          else tracked.push({ id, doc });
          names.push(tracked.map((item) => item.doc.name).sort());
        },
        () => {},
        (id) => {
          const index = tracked.findIndex((item) => item.id === id);
          if (index >= 0) tracked.splice(index, 1);
          names.push(tracked.map((item) => item.doc.name).sort());
        },
        (error) => {
          throw error;
        }
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(
      tracked.find((item) => item.id === locationId)
    ).toBeUndefined();

    await signOut();
    await signInAs(owner);
    await updateLocation({
      worldId,
      locationId,
      location: { sharedWithPlayers: true },
    });
    await waitFor(() =>
      tracked.some((item) => item.id === locationId) ? tracked : null
    );

    await updateLocation({
      worldId,
      locationId,
      location: { sharedWithPlayers: false },
    });
    await waitFor(() =>
      !tracked.some((item) => item.id === locationId) ? tracked : null
    );
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it("never leaks GM details to players, including over live updates", { timeout: 120000 }, async () => {
    const { owner, campaignGM, player } = await setUpQuartet();
    const { worldId } = await setUpLinkedWorld({ owner, campaignGM, player });

    await signInAs(owner);
    const locationId = await createLocation({ worldId });

    // The player follows GM details, GM notes and public notes live.
    await signOut();
    await signInAs(player);
    const details: unknown[] = [];
    const gmNotes: Array<Uint8Array | undefined> = [];
    const notes: Array<Uint8Array | undefined> = [];
    unsubscribes.push(
      listenToLocationGMProperties(
        worldId,
        locationId,
        (properties) => details.push(properties),
        () => {}
      )
    );
    unsubscribes.push(
      listenToLocationGMNotes(
        worldId,
        locationId,
        (content) => gmNotes.push(content),
        () => {}
      )
    );
    unsubscribes.push(
      listenToLocationNotes(
        worldId,
        locationId,
        (content) => notes.push(content),
        () => {}
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // The GM writes every GM-only field; the player still receives nothing
    // but undefined, while public notes stream.
    await signOut();
    await signInAs(owner);
    await updateLocationGMProperties({
      worldId,
      locationId,
      locationGMProperties: {
        descriptor: "Secret",
        trouble: "Trouble",
        locationFeatures: "Features",
        fields: { climate: "Cold" },
      },
    });
    await updateLocationGMNotes({
      worldId,
      locationId,
      notes: new Uint8Array([1, 2, 3]),
    });
    await updateLocationNotes({
      worldId,
      locationId,
      notes: new Uint8Array([4, 5, 6]),
    });
    await waitFor(() =>
      notes.some((content) => content?.length === 3) ? notes : null
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(details.every((entry) => entry === undefined)).toBe(true);
    expect(gmNotes.every((entry) => entry === undefined)).toBe(true);

    // And the rows are unreadable directly too.
    const gmRow = await player.client
      .from("world_location_gm_details")
      .select("location_id")
      .eq("location_id", locationId);
    expect(gmRow.error).toBeNull();
    expect(gmRow.data ?? []).toEqual([]);
    const gmContents = await player.client
      .from("world_note_contents")
      .select("note_id")
      .eq("note_id", (await getWorldItemNoteIds("location", locationId)).gmNoteId as string);
    expect(gmContents.error).toBeNull();
    expect(gmContents.data ?? []).toEqual([]);
  });

  it("lets players toggle their own characters' bonds, and nobody else's", { timeout: 90000 }, async () => {
    const { owner, campaignGM, player, outsider } = await setUpQuartet();
    const { worldId, campaignId } = await setUpLinkedWorld({
      owner,
      campaignGM,
      player,
    });

    await signInAs(owner);
    const locationId = await createLocation({ worldId });
    await signOut();
    await signInAs(player);
    const characterId = await createCharacter({
      uid: player.userId,
      name: "Bonded",
      stats: {},
      assets: [],
    });

    // The player toggles their own character's bond on and off.
    await updateLocationCharacterBond({
      worldId,
      locationId,
      characterId,
      bonded: true,
    });
    const bondsOn = await owner.client
      .from("world_locations")
      .select("character_bonds")
      .eq("id", locationId)
      .single();
    expect(bondsOn.error).toBeNull();
    expect(
      (bondsOn.data as { character_bonds: Record<string, boolean> })
        .character_bonds[characterId]
    ).toBe(true);
    await updateLocationCharacterBond({
      worldId,
      locationId,
      characterId,
      bonded: false,
    });

    // Nobody else's character: the outsider owns none here, and a stranger's
    // character id is rejected even though the player belongs to the world.
    await signOut();
    await signInAs(outsider);
    const strangerId = await createCharacter({
      uid: outsider.userId,
      name: "Stranger",
      stats: {},
      assets: [],
    });
    await expect(
      updateLocationCharacterBond({
        worldId,
        locationId,
        characterId: strangerId,
        bonded: true,
      })
    ).rejects.toBeTruthy();
    await signOut();
    await signInAs(player);
    await expect(
      updateLocationCharacterBond({
        worldId,
        locationId,
        characterId: strangerId,
        bonded: true,
      })
    ).rejects.toBeTruthy();
    void campaignId;
  });

  it("ends a campaign GM's access when the world is unlinked", { timeout: 90000 }, async () => {
    const { owner, campaignGM, player } = await setUpQuartet();
    const { worldId, campaignId } = await setUpLinkedWorld({
      owner,
      campaignGM,
      player,
    });

    await signInAs(owner);
    const locationId = await createLocation({ worldId });
    const before = await campaignGM.client
      .from("world_locations")
      .select("id")
      .eq("id", locationId);
    expect(before.error).toBeNull();
    expect((before.data ?? []).map((row) => row.id)).toEqual([locationId]);

    // Unlinking the world drops the campaign GM to outsider for it; the
    // owner keeps full access.
    await signOut();
    await signInAs(campaignGM);
    await updateCampaignWorld({ campaignId, gmIds: [], worldId: undefined });
    const after = await campaignGM.client
      .from("world_locations")
      .select("id")
      .eq("id", locationId);
    expect(after.error).toBeNull();
    expect(after.data ?? []).toEqual([]);
    const ownerStill = await owner.client
      .from("world_locations")
      .select("id")
      .eq("id", locationId);
    expect(ownerStill.error).toBeNull();
    expect((ownerStill.data ?? []).map((row) => row.id)).toEqual([locationId]);

    // Relinking restores the campaign GM's access at once.
    await updateCampaignWorld({ campaignId, gmIds: [], worldId });
    const relinked = await campaignGM.client
      .from("world_locations")
      .select("id")
      .eq("id", locationId);
    expect(relinked.error).toBeNull();
    expect((relinked.data ?? []).map((row) => row.id)).toEqual([locationId]);

    // Demoting the campaign GM to player ends their GM access too: shared
    // items stay visible, GM details go dark.
    await signOut();
    await signInAs(campaignGM);
    await updateCampaignGM({
      campaignId,
      gmId: campaignGM.userId,
      shouldRemove: true,
    });
    const demotedDetails = await campaignGM.client
      .from("world_location_gm_details")
      .select("location_id")
      .eq("location_id", locationId);
    expect(demotedDetails.error).toBeNull();
    expect(demotedDetails.data ?? []).toEqual([]);
  });

  it("follows lore and NPCs live with the same shared-only rule", { timeout: 120000 }, async () => {
    const { owner, campaignGM, player } = await setUpQuartet();
    const { worldId } = await setUpLinkedWorld({ owner, campaignGM, player });

    await signInAs(player);
    const loreNames: string[][] = [];
    const trackedLore: Array<{ id: string; name: string }> = [];
    unsubscribes.push(
      listenToLoreDocuments(
        worldId,
        (id, doc) => {
          const entry = trackedLore.find((item) => item.id === id);
          if (entry) entry.name = doc.name;
          else trackedLore.push({ id, name: doc.name });
          loreNames.push(trackedLore.map((item) => item.name).sort());
        },
        () => {},
        (id) => {
          const index = trackedLore.findIndex((item) => item.id === id);
          if (index >= 0) trackedLore.splice(index, 1);
          loreNames.push(trackedLore.map((item) => item.name).sort());
        },
        (error) => {
          throw error;
        }
      )
    );
    const npcNames: string[][] = [];
    const trackedNPCs: Array<{ id: string; name: string }> = [];
    unsubscribes.push(
      listenToNPCs(
        worldId,
        (id, doc) => {
          const entry = trackedNPCs.find((item) => item.id === id);
          if (entry) entry.name = doc.name;
          else trackedNPCs.push({ id, name: doc.name });
          npcNames.push(trackedNPCs.map((item) => item.name).sort());
        },
        () => {},
        (id) => {
          const index = trackedNPCs.findIndex((item) => item.id === id);
          if (index >= 0) trackedNPCs.splice(index, 1);
          npcNames.push(trackedNPCs.map((item) => item.name).sort());
        },
        (error) => {
          throw error;
        }
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await signOut();
    await signInAs(owner);
    const loreId = await createLore({ worldId });
    await updateLore({
      worldId,
      loreId,
      lore: { name: "Shared tale", sharedWithPlayers: true },
    });
    const npcId = await createNPC({ worldId, npc: { name: "Innkeep" } });
    const doomedId = await createLocation({ worldId });
    await deleteLocation({ worldId, locationId: doomedId }).catch(() => {});
    await waitFor(() =>
      trackedLore.some((item) => item.id === loreId) &&
      trackedNPCs.some((item) => item.id === npcId)
        ? trackedLore
        : null
    );
    expect(loreNames.at(-1)).toContain("Shared tale");
    expect(npcNames.at(-1)).toContain("Innkeep");
  });

  it("reads world note bytes through the contents rows with the same rules", { timeout: 90000 }, async () => {
    const { owner, campaignGM, player, outsider } = await setUpQuartet();
    const { worldId } = await setUpLinkedWorld({ owner, campaignGM, player });

    await signInAs(owner);
    const locationId = await createLocation({ worldId });
    await updateLocationNotes({
      worldId,
      locationId,
      notes: new Uint8Array([9, 9]),
    });
    await updateLocationGMNotes({
      worldId,
      locationId,
      notes: new Uint8Array([8, 8]),
    });
    const ids = await getWorldItemNoteIds("location", locationId);
    expect(ids.publicNoteId).toBeTruthy();
    expect(ids.gmNoteId).toBeTruthy();

    // The player streams the public bytes live; GM bytes never arrive.
    await signOut();
    await signInAs(player);
    const contents: Array<Uint8Array | undefined> = [];
    unsubscribes.push(
      listenToWorldNoteContent(
        ids.publicNoteId as string,
        (content) => contents.push(content),
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      contents.some((content) => content?.length === 2) ? contents : null
    );
    expect(contents.at(-1)).toEqual(new Uint8Array([9, 9]));
    const gmContents: Array<Uint8Array | undefined> = [];
    unsubscribes.push(
      listenToWorldNoteContent(
        ids.gmNoteId as string,
        (content) => gmContents.push(content),
        () => {}
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(gmContents.every((entry) => entry === undefined)).toBe(true);

    // Outsiders cannot resolve the note rows at all.
    const outsiderNotes = await outsider.client
      .from("world_notes")
      .select("id")
      .eq("world_id", worldId);
    expect(outsiderNotes.error).toBeNull();
    expect(outsiderNotes.data ?? []).toEqual([]);
  });
});
