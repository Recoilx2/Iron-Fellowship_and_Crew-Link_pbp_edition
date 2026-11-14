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
  personClient,
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

  it("lets a player hold several characters but never two active at once", { timeout: 120000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const other = await createPerson(cfg, "other");
    people.push(owner, other);
    const campaignId = randomCampaignId();
    await ensureCampaign(cfg, campaignId);
    await grantMembership(cfg, campaignId, owner.userId, "player");
    await grantMembership(cfg, campaignId, other.userId, "player");

    const link = (person: LivePerson, characterId: string, campaign: string | null, active = true) =>
      person.client
        .from("characters")
        .update({ campaign_id: campaign, is_active: active })
        .eq("id", characterId)
        .select("id");
    const setActive = (person: LivePerson, characterId: string, makeActive: boolean) =>
      person.client.rpc("set_campaign_character_active", {
        char_id: characterId,
        make_active: makeActive,
      });
    const readFlags = async (ids: string[]) => {
      const { data, error } = await owner.client
        .from("characters")
        .select("id, campaign_id, is_active")
        .in("id", ids);
      expect(error).toBeNull();
      return new Map((data ?? []).map((row) => [row.id, row]));
    };

    await signInAs(owner);
    const firstId = await createCharacter({
      uid: owner.userId,
      name: "First",
      stats: {},
      assets: [],
    });
    const secondId = await createCharacter({
      uid: owner.userId,
      name: "Second",
      stats: {},
      assets: [],
    });
    await signOut();
    await signInAs(other);
    const otherId = await createCharacter({
      uid: other.userId,
      name: "Other",
      stats: {},
      assets: [],
    });
    await signOut();

    // The owner's first character links fine, active.
    expect((await link(owner, firstId, campaignId)).error).toBeNull();

    // A second active character from the same player is refused by the
    // partial unique index.
    const duplicate = await link(owner, secondId, campaignId);
    expect(duplicate.error?.code, "second active character").toBe("23505");

    // The same character linked inactive is allowed.
    expect((await link(owner, secondId, campaignId, false)).error).toBeNull();
    const both = await readFlags([firstId, secondId]);
    expect(both.get(firstId)).toMatchObject({
      campaign_id: campaignId,
      is_active: true,
    });
    expect(both.get(secondId)).toMatchObject({
      campaign_id: campaignId,
      is_active: false,
    });

    // A different player's character in the same campaign succeeds.
    expect((await link(other, otherId, campaignId)).error).toBeNull();

    // Retiring the active character, then reactivating it.
    expect((await setActive(owner, firstId, false)).error).toBeNull();
    expect((await readFlags([firstId])).get(firstId)).toMatchObject({
      is_active: false,
    });
    expect((await setActive(owner, firstId, true)).error).toBeNull();
    expect((await readFlags([firstId])).get(firstId)).toMatchObject({
      is_active: true,
    });

    // Swapping in one step: making the second active retires the first.
    expect((await setActive(owner, secondId, true)).error).toBeNull();
    const swapped = await readFlags([firstId, secondId]);
    expect(swapped.get(firstId)).toMatchObject({ is_active: false });
    expect(swapped.get(secondId)).toMatchObject({
      campaign_id: campaignId,
      is_active: true,
    });

    // Only the owner retires or reactivates: another player is refused
    // with a privilege error and the flags stand.
    const refused = await setActive(other, secondId, false);
    expect(refused.error?.code, "non-owner swap").toBe("42501");
    expect((await readFlags([secondId])).get(secondId)).toMatchObject({
      is_active: true,
    });

    // A GM who does not own the character is refused the same way: the
    // swap is owner-only with no GM exception.
    const gm = await createPerson(cfg, "gm");
    people.push(gm);
    await grantMembership(cfg, campaignId, gm.userId, "gm");
    const gmRefused = await setActive(gm, secondId, false);
    expect(gmRefused.error?.code, "gm non-owner swap").toBe("42501");
    expect((await readFlags([secondId])).get(secondId)).toMatchObject({
      is_active: true,
    });

    // A signed-out caller never reaches the owner check: with no JWT,
    // auth.uid() is NULL, so the guard refuses outright -- and anon holds
    // no EXECUTE on the swap at all. The flags stand either way.
    const anon = personClient(cfg);
    const anonRefused = await anon.rpc("set_campaign_character_active", {
      char_id: secondId,
      make_active: false,
    });
    expect(anonRefused.error?.code, "signed-out swap").toBe("42501");
    expect((await readFlags([secondId])).get(secondId)).toMatchObject({
      is_active: true,
    });

    // A direct write of the flag is owner-only too: row-level security
    // leaves a non-owner's update (a GM is no exception -- the only UPDATE
    // policy on the table is owner-only) touching zero rows, so the flags
    // stand without a privilege error from the swap function.
    const directRetire = await other.client
      .from("characters")
      .update({ is_active: false })
      .eq("id", secondId)
      .select("id");
    expect(directRetire.error).toBeNull();
    expect(directRetire.data ?? []).toEqual([]);
    expect((await readFlags([secondId])).get(secondId)).toMatchObject({
      is_active: true,
    });

    // Swapping by unlinking the old character first still succeeds: the
    // unlinked row leaves the campaign, and the other links active.
    expect((await link(owner, secondId, null)).error).toBeNull();
    expect((await link(owner, firstId, campaignId)).error).toBeNull();
    const rows = await readFlags([firstId, secondId]);
    expect(rows.get(secondId)?.campaign_id).toBeNull();
    expect(rows.get(firstId)).toMatchObject({
      campaign_id: campaignId,
      is_active: true,
    });
  });
});
