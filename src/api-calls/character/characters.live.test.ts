import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCharacter } from "api-calls/character/createCharacter";
import { updateCharacter } from "api-calls/character/updateCharacter";
import { deleteCharacter } from "api-calls/character/deleteCharacter";
import { listenToCharacter } from "api-calls/character/listenToCharacter";
import { listenToUsersCharacters } from "api-calls/character/listenToUsersCharacters";
import { getCharacterForExport } from "api-calls/character/getCharacterForExport";
import type { CharacterDocument } from "api-calls/character/_character.type";
import {
  createPerson,
  deletePerson,
  ensureCampaign,
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

describe.skipIf(!config)("characters end to end", () => {
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

  it("creates, updates live and deletes a solo character", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    await signInAs(owner);

    const seenIds: string[][] = [];
    const listUnsubscribe = listenToUsersCharacters(
      owner.userId,
      {
        onDocChange: (id, data) => {
          seenIds.push([id, data.name]);
        },
        onDocRemove: (id) => {
          seenIds.push([`removed:${id}`]);
        },
        onLoaded: () => {},
      },
      (error) => {
        throw error;
      }
    );
    if (listUnsubscribe) {
      unsubscribes.push(listUnsubscribe);
    }

    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Del Nar",
      stats: { edge: 2 },
      assets: [
        { id: "ironsworn/assets/companion", enabledAbilities: {}, order: 0 },
      ],
    });
    await waitFor(() =>
      seenIds.some(([id]) => id === characterId) ? seenIds : null
    );

    const seenSingle: CharacterDocument[] = [];
    const singleErrors: unknown[] = [];
    unsubscribes.push(
      listenToCharacter(
        characterId,
        (character) => seenSingle.push(character),
        (error) => singleErrors.push(error)
      )
    );
    await waitFor(() => (seenSingle.length >= 1 ? seenSingle : null));
    expect(seenSingle[0].name).toBe("Del Nar");

    // Let live updates catch up with the fresh subscriptions: on a cold
    // stack the replication slot is still being created while the first
    // writes land, so an update issued immediately here never produces an
    // event and the wait below times out. Later tests reuse the warm slot.
    await new Promise((resolve) => setTimeout(resolve, 10000));

    await updateCharacter({
      characterId,
      character: {
        name: "Renamed",
        "conditionMeters.health": 4,
        momentum: 5,
      },
    });
    const updated = await waitFor(() =>
      seenSingle.some((character) => character.name === "Renamed")
        ? seenSingle
        : null
    );
    expect(updated.at(-1)).toMatchObject({
      name: "Renamed",
      momentum: 5,
      conditionMeters: { health: 4 },
    });
    expect(singleErrors).toEqual([]);

    const exported = await getCharacterForExport(characterId);
    expect(exported?.data.name).toBe("Renamed");

    await deleteCharacter({ uid: owner.userId, characterId });
    await waitFor(() =>
      seenIds.some(([id]) => id === `removed:${characterId}`)
        ? seenIds
        : null
    );
    // The single listener reports the missing row instead of a document.
    await waitFor(() => (singleErrors.length >= 1 ? singleErrors : null));
  });

  it("lets campaign members read live but never write", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const member = await createPerson(cfg, "member");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, member, outsider);
    const campaignId = randomCampaignId();
    await ensureCampaign(cfg, campaignId);
    await grantMembership(cfg, campaignId, member.userId, "player");

    await signInAs(owner);
    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Shared",
      stats: { edge: 1 },
      assets: [],
    });
    await updateCharacter({ characterId, character: { campaignId } });

    // A member of the campaign reads the character; an outsider sees nothing.
    const asMember = await member.client
      .from("characters")
      .select("id, name")
      .eq("id", characterId);
    expect(asMember.error).toBeNull();
    expect(asMember.data).toHaveLength(1);

    const asOutsider = await outsider.client
      .from("characters")
      .select("id, name")
      .eq("id", characterId);
    expect(asOutsider.error).toBeNull();
    expect(asOutsider.data).toEqual([]);

    // The member follows the character live through the owner's changes.
    await signOut();
    await signInAs(member);
    const seen: CharacterDocument[] = [];
    unsubscribes.push(
      listenToCharacter(
        characterId,
        (character) => seen.push(character),
        () => {}
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    await owner.client
      .from("characters")
      .update({ name: "Shared update" })
      .eq("id", characterId);
    const live = await waitFor(() =>
      seen.some((character) => character.name === "Shared update")
        ? seen
        : null
    );
    expect(live.at(-1)?.name).toBe("Shared update");

    // Neither the member nor the outsider may change the character.
    await expect(
      updateCharacter({ characterId, character: { name: "Hijacked" } })
    ).rejects.toBeTruthy();
    await expect(
      deleteCharacter({ uid: member.userId, characterId })
    ).rejects.toBeTruthy();

    await signOut();
    await signInAs(outsider);
    await expect(
      updateCharacter({ characterId, character: { name: "Hijacked" } })
    ).rejects.toBeTruthy();
    const directUpdate = await outsider.client
      .from("characters")
      .update({ name: "Hijacked" })
      .eq("id", characterId)
      .select("id");
    expect(directUpdate.data ?? []).toEqual([]);
  });

  it("keeps an outsider's subscription empty", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, outsider);

    await signInAs(owner);
    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Private",
      stats: {},
      assets: [],
    });
    await signOut();

    await signInAs(outsider);
    const seenLists: Array<[string, CharacterDocument]> = [];
    const seenSingle: CharacterDocument[] = [];
    const errors: unknown[] = [];
    const outsiderListUnsubscribe = listenToUsersCharacters(
      owner.userId,
      {
        onDocChange: (id, data) => seenLists.push([id, data]),
        onDocRemove: () => {},
        onLoaded: () => {},
      },
      () => {}
    );
    if (outsiderListUnsubscribe) {
      unsubscribes.push(outsiderListUnsubscribe);
    }
    unsubscribes.push(
      listenToCharacter(
        characterId,
        (character) => seenSingle.push(character),
        (error) => errors.push(error)
      )
    );
    await waitFor(() => (errors.length >= 1 ? errors : null));

    await owner.client
      .from("characters")
      .update({ name: "Still private" })
      .eq("id", characterId);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(seenLists).toEqual([]);
    expect(seenSingle).toEqual([]);
  });
});
