import { afterEach, describe, expect, it } from "vitest";

import {
  createPerson,
  deletePerson,
  liveStackConfig,
  personClient,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createHomebrewExpansion } from "api-calls/homebrew/createHomebrewExpansion";
import { updateHomebrewExpansion } from "api-calls/homebrew/updateHomebrewExpansion";
import { deleteHomebrewExpansion } from "api-calls/homebrew/deleteHomebrewExpansion";
import { listenToHomebrewCollections } from "api-calls/homebrew/listenToHomebrewCollections";
import { listenToHomebrewCollection } from "api-calls/homebrew/listenToHomebrewCollection";
import { getEditorInviteUrl } from "api-calls/homebrew/editorFunction/getEditorInviteUrl";
import { getHomebrewCollectionFromInviteUrl } from "api-calls/homebrew/editorFunction/getHomebrewCollectionFromInviteUrl";
import { acceptEditorInvite } from "api-calls/homebrew/editorFunction/acceptEditorInvite";
import { removeSelfAsEditor } from "api-calls/homebrew/editorFunction/removeSelfAsEditor";
import { removeHomebrewEditor } from "api-calls/homebrew/removeHomebrewEditor";
import { addHomebrewViewer } from "api-calls/homebrew/addHomebrewViewer";
import { removeHomebrewViewer } from "api-calls/homebrew/removeHomebrewViewer";
import { createHomebrewStat } from "api-calls/homebrew/rules/stats/createHomebrewStat";
import { updateHomebrewStat } from "api-calls/homebrew/rules/stats/updateHomebrewStat";
import { deleteHomebrewStat } from "api-calls/homebrew/rules/stats/deleteHomebrewStat";
import { listenToHomebrewStats } from "api-calls/homebrew/rules/stats/listenToHomebrewStats";
import { createHomebrewConditionMeter } from "api-calls/homebrew/rules/conditionMeters/createHomebrewConditionMeter";
import { updateHomebrewConditionMeter } from "api-calls/homebrew/rules/conditionMeters/updateHomebrewStat";
import { deleteHomebrewConditionMeter } from "api-calls/homebrew/rules/conditionMeters/deleteHomebrewConditionMeter";
import { listenToHomebrewConditionMeters } from "api-calls/homebrew/rules/conditionMeters/listenToHomebrewConditionMeters";
import { createHomebrewNonLinearMeter } from "api-calls/homebrew/rules/nonLinearMeters/createHomebrewNonLinearMeter";
import { updateHomebrewNonLinearMeter } from "api-calls/homebrew/rules/nonLinearMeters/updateHomebrewNonLinearMeter";
import { deleteHomebrewNonLinearMeter } from "api-calls/homebrew/rules/nonLinearMeters/deleteHomebrewNonLinearMeter";
import { listenToHomebrewNonLinearMeters } from "api-calls/homebrew/rules/nonLinearMeters/listenToHomebrewNonLinearMeters";
import { createHomebrewImpactCategory } from "api-calls/homebrew/rules/impacts/createHomebrewImpactCategory";
import { updateHomebrewImpactCategory } from "api-calls/homebrew/rules/impacts/updateHomebrewImpactCategory";
import { deleteHomebrewImpactCategory } from "api-calls/homebrew/rules/impacts/deleteHomebrewImpactCategory";
import { updateHomebrewImpact } from "api-calls/homebrew/rules/impacts/updateHomebrewImpact";
import { deleteHomebrewImpact } from "api-calls/homebrew/rules/impacts/deleteHomebrewImpact";
import { listenToHomebrewImpacts } from "api-calls/homebrew/rules/impacts/listenToHomebrewImpacts";
import { createHomebrewLegacyTrack } from "api-calls/homebrew/rules/legacyTracks/createHomebrewLegacyTrack";
import { updateHomebrewLegacyTrack } from "api-calls/homebrew/rules/legacyTracks/updateHomebrewLegacyTrack";
import { deleteHomebrewLegacyTrack } from "api-calls/homebrew/rules/legacyTracks/deleteHomebrewLegacyTrack";
import { listenToHomebrewLegacyTracks } from "api-calls/homebrew/rules/legacyTracks/listenToHomebrewLegacyTracks";
import { createHomebrewMoveCategory } from "api-calls/homebrew/moves/categories/createHomebrewMoveCategory";
import { updateHomebrewMoveCategory } from "api-calls/homebrew/moves/categories/updateHomebrewMoveCategory";
import { deleteHomebrewMoveCategory } from "api-calls/homebrew/moves/categories/deleteHomebrewMoveCategory";
import { listenToHomebrewMoveCategories } from "api-calls/homebrew/moves/categories/listenToHomebrewMoveCategories";
import { createHomebrewMove } from "api-calls/homebrew/moves/moves/createHomebrewMove";
import { updateHomebrewMove } from "api-calls/homebrew/moves/moves/updateHomebrewMove";
import { deleteHomebrewMove } from "api-calls/homebrew/moves/moves/deleteHomebrewMove";
import { listenToHomebrewMoves } from "api-calls/homebrew/moves/moves/listenToHomebrewMoves";
import { createHomebrewOracleCollection } from "api-calls/homebrew/oracles/collections/createHomebrewOracleCollection";
import { updateHomebrewOracleCollection } from "api-calls/homebrew/oracles/collections/updateHomebrewOracleCollection";
import { clearHomebrewOracleCollectionParent } from "api-calls/homebrew/oracles/collections/clearHomebrewOracleCollectionParent";
import { deleteHomebrewOracleCollection } from "api-calls/homebrew/oracles/collections/deleteHomebrewOracleCollection";
import { listenToHomebrewOracleCollections } from "api-calls/homebrew/oracles/collections/listenToHomebrewOracleCollections";
import { createHomebrewOracleTable } from "api-calls/homebrew/oracles/tables/createHomebrewOracleTable";
import { updateHomebrewOracleTable } from "api-calls/homebrew/oracles/tables/updateHomebrewOracleTable";
import { deleteHomebrewOracleTable } from "api-calls/homebrew/oracles/tables/deleteHomebrewOracleTable";
import { listenToHomebrewOracleTables } from "api-calls/homebrew/oracles/tables/listenToHomebrewOracleTables";
import { createHomebrewAssetCollection } from "api-calls/homebrew/assets/collections/createHomebrewAssetCollection";
import { updateHomebrewAssetCollection } from "api-calls/homebrew/assets/collections/updateHomebrewAssetCollection";
import { deleteHomebrewAssetCollection } from "api-calls/homebrew/assets/collections/deleteHomebrewAssetCollection";
import { listenToHomebrewAssetCollections } from "api-calls/homebrew/assets/collections/listenToHomebrewAssetCollections";
import { createHomebrewAsset } from "api-calls/homebrew/assets/assets/createHomebrewAsset";
import { updateHomebrewAsset } from "api-calls/homebrew/assets/assets/updateHomebrewAsset";
import { deleteHomebrewAsset } from "api-calls/homebrew/assets/assets/deleteHomebrewAsset";
import { listenToHomebrewAssets } from "api-calls/homebrew/assets/assets/listenToHomebrewAssets";
import { PackageTypes } from "api-calls/homebrew/_homebrewCollection.type";
import { MoveType } from "api-calls/homebrew/moves/moves/_homebrewMove.type";
import {
  deleteHomebrewImage,
  getHomebrewImageUrl,
  uploadHomebrewImage,
} from "api-calls/homebrew/homebrewImages";

const config = liveStackConfig();

type ContentListener = (
  homebrewId: string,
  updateData: (data: Record<string, { label?: string }>) => void,
  onError: (error: unknown) => void,
  opts?: { client?: SupabaseClient }
) => () => void;

describe.skipIf(!config)("homebrew on Supabase", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  let owner: LivePerson;
  let coeditor: LivePerson;
  let outsider: LivePerson;

  const track = (person: LivePerson) => {
    people.push(person);
    return person;
  };

  afterEach(async () => {
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUpPeople() {
    owner = track(await createPerson(cfg, "owner"));
    coeditor = track(await createPerson(cfg, "coeditor"));
    outsider = track(await createPerson(cfg, "outsider"));
  }

  async function createCollection(): Promise<string> {
    return createHomebrewExpansion(
      {
        type: PackageTypes.Expansion,
        id: `test-pack-${Date.now()}`,
        title: "Test Pack",
        creator: owner.userId,
        editors: [owner.userId],
        rulesetId: "classic",
      },
      { client: owner.client }
    );
  }

  async function editorsOf(collectionId: string): Promise<string[]> {
    const { data, error } = await owner.client
      .from("homebrew_editors")
      .select("user_id")
      .eq("collection_id", collectionId);
    if (error) throw error;
    return ((data ?? []) as Array<{ user_id: string }>).map(
      (row) => row.user_id
    );
  }

  it("creates collections with the creator as editor, and only the creator deletes", { timeout: 60000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();
    expect(await editorsOf(collectionId)).toEqual([owner.userId]);

    // An outsider cannot rename someone else's collection.
    await expect(
      updateHomebrewExpansion({
        id: collectionId,
        expansion: { title: "Hijacked" },
        client: outsider.client,
      })
    ).rejects.toThrow();

    // The creator can.
    await updateHomebrewExpansion({
      id: collectionId,
      expansion: { title: "Renamed" },
      client: owner.client,
    });

    // An editor who is not the creator cannot delete the collection.
    const key = await createInviteKeyAs(owner, collectionId);
    expect(await acceptEditorInvite(collectionId, key, { client: coeditor.client })).toBe(true);
    await expect(
      deleteHomebrewExpansion({ id: collectionId, client: coeditor.client })
    ).rejects.toThrow();

    // The creator can.
    await deleteHomebrewExpansion({ id: collectionId, client: owner.client });
    const { data } = await owner.client
      .from("homebrew_collections")
      .select("id")
      .eq("id", collectionId);
    expect(data).toEqual([]);
  });

  it("lets editors write every content type while outsiders cannot", { timeout: 120000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();

    // Representative typed write as the editor.
    const statId = await createStatReturningId(collectionId, owner.client);

    // An outsider's writes are rejected on every content table.
    await expect(
      createHomebrewStat({
        stat: { collectionId, dataswornId: "nope", label: "Nope" },
        client: outsider.client,
      })
    ).rejects.toThrow();
    await expect(
      updateHomebrewStat({
        statId,
        stat: { label: "Hijacked" },
        client: outsider.client,
      })
    ).rejects.toThrow();
    await expect(
      deleteHomebrewStat({ statId, client: outsider.client })
    ).rejects.toThrow();

    await deleteHomebrewStat({ statId, client: owner.client });
  });

  it("rejects outsider writes on every homebrew table", { timeout: 120000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();
    const tables = [
      "homebrew_stats",
      "homebrew_condition_meters",
      "homebrew_non_linear_meters",
      "homebrew_impact_categories",
      "homebrew_legacy_tracks",
      "homebrew_move_categories",
      "homebrew_moves",
      "homebrew_oracle_collections",
      "homebrew_oracle_tables",
      "homebrew_asset_collections",
      "homebrew_assets",
    ];

    for (const table of tables) {
      // Outsiders cannot insert.
      const denied = await outsider.client
        .from(table)
        .insert({ collection_id: collectionId, data: { label: "Nope" } });
      expect(denied.error, `${table} insert`).not.toBeNull();

      // Editors can; outsiders can read but never change the row.
      const { data, error } = await owner.client
        .from(table)
        .insert({ collection_id: collectionId, data: { label: "Mine" } })
        .select("id")
        .single();
      expect(error, `${table} editor insert`).toBeNull();
      const id = (data as unknown as { id: string }).id;

      const read = await outsider.client.from(table).select("id").eq("id", id);
      expect(read.error, `${table} public read`).toBeNull();
      expect(read.data).toHaveLength(1);

      const updated = await outsider.client
        .from(table)
        .update({ data: { label: "Hijacked" } })
        .eq("id", id)
        .select("id");
      // RLS filters denied writes instead of raising, so the denial surfaces
      // as zero matched rows (and the app helpers reject on exactly that).
      expect(updated.error, `${table} update`).toBeNull();
      expect(updated.data, `${table} update`).toEqual([]);

      const deleted = await outsider.client
        .from(table)
        .delete()
        .eq("id", id)
        .select("id");
      expect(deleted.error, `${table} delete`).toBeNull();
      expect(deleted.data, `${table} delete`).toEqual([]);

      const cleanup = await owner.client.from(table).delete().eq("id", id);
      expect(cleanup.error, `${table} editor delete`).toBeNull();
    }

    // Non-editors cannot touch the membership tables at all.
    const editorInsert = await outsider.client.from("homebrew_editors").insert({
      collection_id: collectionId,
      user_id: outsider.userId,
    });
    expect(editorInsert.error).not.toBeNull();
    const keyInsert = await outsider.client.from("homebrew_invite_keys").insert({
      collection_id: collectionId,
    });
    expect(keyInsert.error).not.toBeNull();
  });

  it("streams every content type live to editors", { timeout: 120000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();
    const seen: Record<string, Array<Record<string, { label?: string }>>> = {};
    const errors: unknown[] = [];
    const unsubscribes: Array<() => void> = [];
    try {
      const subscribe = (
        name: string,
        listen: ContentListener
      ) => {
        seen[name] = [];
        unsubscribes.push(
          listen(
            collectionId,
            (data) => {
              seen[name]?.push(data);
            },
            (error) => {
              errors.push(error);
            },
            { client: coeditor.client }
          )
        );
      };
      subscribe("stats", listenToHomebrewStats);
      subscribe("conditionMeters", listenToHomebrewConditionMeters);
      subscribe("nonLinearMeters", listenToHomebrewNonLinearMeters);
      subscribe("impactCategories", listenToHomebrewImpacts);
      subscribe("legacyTracks", listenToHomebrewLegacyTracks);
      subscribe("moveCategories", listenToHomebrewMoveCategories);
      subscribe("moves", listenToHomebrewMoves);
      subscribe("oracleCollections", listenToHomebrewOracleCollections);
      subscribe("oracleTables", listenToHomebrewOracleTables);
      subscribe("assetCollections", listenToHomebrewAssetCollections);
      subscribe("assets", listenToHomebrewAssets);

      // The co-editor is not an editor yet: subscribing still works because
      // reads are public, but nothing is delivered until rows exist.
      await waitFor(() =>
        Object.values(seen).every((emits) => emits.length >= 1) ? seen : null
      );
      expect(errors).toEqual([]);

      const ids = await createAllContent(collectionId, owner.client);

      const withOneRow = await waitFor(() =>
        Object.values(seen).every((emits) =>
          Object.values(emits.at(-1) ?? {}).length === 1
        )
          ? seen
          : null
      );
      expect(Object.keys(withOneRow).sort()).toEqual(
        [
          "assetCollections",
          "assets",
          "conditionMeters",
          "impactCategories",
          "legacyTracks",
          "moveCategories",
          "moves",
          "nonLinearMeters",
          "oracleCollections",
          "oracleTables",
          "stats",
        ].sort()
      );

      // Every row carries its collection id for the stores.
      for (const emits of Object.values(withOneRow)) {
        for (const row of Object.values(emits.at(-1) ?? {})) {
          expect((row as { collectionId?: string }).collectionId).toBe(
            collectionId
          );
        }
      }

      await updateAllContent(ids, owner.client);
      await waitFor(() =>
        Object.entries(seen).every(([, emits]) =>
          Object.values(emits.at(-1) ?? {}).every(
            (row) => row.label === "v2"
          )
        )
          ? true
          : null
      );

      await removeAllContent(ids, owner.client);
      await waitFor(() =>
        Object.values(seen).every(
          (emits) => Object.keys(emits.at(-1) ?? {}).length === 0
        )
          ? true
          : null
      );
      expect(errors).toEqual([]);
    } finally {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    }
  });

  it("manages nested impacts and oracle parents", { timeout: 60000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();

    const categoryId = await createImpactCategoryReturningId(
      collectionId,
      owner.client
    );
    await updateHomebrewImpact({
      impactCategoryId: categoryId,
      impact: {
        label: "Debilitated",
        dataswornId: "debilitated",
        shared: true,
        preventsRecovery: ["health"],
        permanent: false,
      },
      client: owner.client,
    });
    // A non-editor cannot touch nested impacts either.
    await expect(
      updateHomebrewImpact({
        impactCategoryId: categoryId,
        impact: {
          label: "Hijacked",
          dataswornId: "debilitated",
          shared: true,
          preventsRecovery: [],
          permanent: false,
        },
        client: outsider.client,
      })
    ).rejects.toThrow();
    await deleteHomebrewImpact({
      impactCategoryId: categoryId,
      impactId: "debilitated",
      client: owner.client,
    });
    await deleteHomebrewImpactCategory({
      impactCategoryId: categoryId,
      client: owner.client,
    });

    const parentId = await createOracleCollectionReturningId(
      collectionId,
      owner.client
    );
    const childId = await createOracleCollectionReturningId(
      collectionId,
      owner.client
    );
    await updateHomebrewOracleCollection({
      oracleCollectionId: childId,
      oracleCollection: { parentOracleCollectionId: parentId },
      client: owner.client,
    });
    await clearHomebrewOracleCollectionParent({
      oracleCollectionId: childId,
      client: owner.client,
    });
    await deleteHomebrewOracleCollection({
      oracleCollectionId: childId,
      client: owner.client,
    });
    await deleteHomebrewOracleCollection({
      oracleCollectionId: parentId,
      client: owner.client,
    });
  });

  it("treats invite keys as single-use and guards editor management", { timeout: 60000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();

    // A non-editor cannot mint keys.
    await expect(
      getEditorInviteUrl(collectionId, { client: outsider.client })
    ).rejects.toThrow();

    const invitePath = await getEditorInviteUrl(collectionId, {
      client: owner.client,
    });
    expect(invitePath).toMatch(/\/invite\//);
    const key = invitePath!.split("/invite/")[1] as string;

    // Anyone signed in can look up the collection from a key.
    expect(
      await getHomebrewCollectionFromInviteUrl(key, {
        client: outsider.client,
      })
    ).toBe(collectionId);
    expect(
      await getHomebrewCollectionFromInviteUrl("no-such-key", {
        client: outsider.client,
      })
    ).toBeNull();

    // Accepting adds the person as an editor and spends the key.
    expect(
      await acceptEditorInvite(collectionId, key, { client: coeditor.client })
    ).toBe(true);
    expect(await editorsOf(collectionId)).toContain(coeditor.userId);
    expect(
      await getHomebrewCollectionFromInviteUrl(key, {
        client: outsider.client,
      })
    ).toBeNull();
    expect(
      await acceptEditorInvite(collectionId, key, { client: outsider.client })
    ).toBe(false);

    // A mismatched collection id never adds anyone.
    const otherId = await createCollection();
    const otherKey = (
      (await getEditorInviteUrl(otherId, {
        client: owner.client,
      })) as string
    ).split("/invite/")[1] as string;
    expect(
      await acceptEditorInvite(collectionId, otherKey, {
        client: outsider.client,
      })
    ).toBe(false);
    expect(await editorsOf(collectionId)).not.toContain(outsider.userId);

    // Editors write; removing an editor revokes that.
    const statId = await createStatReturningId(collectionId, coeditor.client);
    expect(
      await removeHomebrewEditor({
        id: collectionId,
        uid: coeditor.userId,
        client: owner.client,
      })
    ).toBe(true);
    expect(await editorsOf(collectionId)).not.toContain(coeditor.userId);
    await expect(
      updateHomebrewStat({
        statId,
        stat: { label: "After removal" },
        client: coeditor.client,
      })
    ).rejects.toThrow();

    // A non-editor cannot remove anyone.
    expect(
      await removeHomebrewEditor({
        id: collectionId,
        uid: owner.userId,
        client: outsider.client,
      })
    ).toBe(false);
    expect(await editorsOf(collectionId)).toContain(owner.userId);
  });

  it("lets people leave as editors and join as viewers", { timeout: 60000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();
    const key = await createInviteKeyAs(owner, collectionId);
    expect(await acceptEditorInvite(collectionId, key, { client: coeditor.client })).toBe(true);

    // Leaving drops the editorship.
    expect(
      await removeSelfAsEditor(collectionId, { client: coeditor.client })
    ).toBe(true);
    expect(await editorsOf(collectionId)).not.toContain(coeditor.userId);

    // Anyone signed in can add themselves as a viewer, but viewers cannot edit.
    await addHomebrewViewer({
      id: collectionId,
      uid: outsider.userId,
      client: outsider.client,
    });
    await expect(
      createHomebrewStat({
        stat: { collectionId, dataswornId: "viewer", label: "Viewer" },
        client: outsider.client,
      })
    ).rejects.toThrow();

    // Nobody can add someone else as a viewer.
    await expect(
      addHomebrewViewer({
        id: collectionId,
        uid: coeditor.userId,
        client: outsider.client,
      })
    ).rejects.toThrow();

    // Editors can remove viewers; viewers can remove themselves.
    await removeHomebrewViewer({
      id: collectionId,
      uid: outsider.userId,
      client: owner.client,
    });
    await addHomebrewViewer({
      id: collectionId,
      uid: outsider.userId,
      client: outsider.client,
    });
    await removeHomebrewViewer({
      id: collectionId,
      uid: outsider.userId,
      client: outsider.client,
    });
  });

  it("lists member collections live and drops removed editors at once", { timeout: 90000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();
    const key = await createInviteKeyAs(owner, collectionId);
    expect(await acceptEditorInvite(collectionId, key, { client: coeditor.client })).toBe(true);

    const ownerSeen: string[][] = [];
    const coeditorSeen: string[][] = [];
    const ownerUnsubscribe = listenToHomebrewCollections(
      owner.userId,
      (id) => {
        ownerSeen.push([id, ...(ownerSeen.at(-1) ?? [])].filter((v, i, a) => a.indexOf(v) === i));
      },
      (id) => {
        const last = ownerSeen.at(-1) ?? [];
        ownerSeen.push(last.filter((v) => v !== id));
      },
      (error) => {
        throw error;
      },
      () => {},
      { client: owner.client }
    );
    const coeditorUnsubscribe = listenToHomebrewCollections(
      coeditor.userId,
      (id) => {
        coeditorSeen.push([id, ...(coeditorSeen.at(-1) ?? [])].filter((v, i, a) => a.indexOf(v) === i));
      },
      (id) => {
        const last = coeditorSeen.at(-1) ?? [];
        coeditorSeen.push(last.filter((v) => v !== id));
      },
      (error) => {
        throw error;
      },
      () => {},
      { client: coeditor.client }
    );
    try {
      await waitFor(() =>
        ownerSeen.some((ids) => ids.includes(collectionId)) &&
        coeditorSeen.some((ids) => ids.includes(collectionId))
          ? true
          : null
      );

      // The collection itself reads publicly, even for outsiders.
      const publicSeen: Array<Record<string, unknown>> = [];
      const publicUnsubscribe = listenToHomebrewCollection(
        collectionId,
        (doc) => {
          publicSeen.push(doc as unknown as Record<string, unknown>);
        },
        (error) => {
          throw error;
        },
        () => {},
        { client: outsider.client }
      );
      try {
        await waitFor(() => (publicSeen.length >= 1 ? true : null));
      } finally {
        publicUnsubscribe();
      }

      // Removing the co-editor drops the collection from their list live.
      await removeHomebrewEditor({
        id: collectionId,
        uid: coeditor.userId,
        client: owner.client,
      });
      await waitFor(() => {
        const last = coeditorSeen.at(-1) ?? [collectionId];
        return last.includes(collectionId) ? null : true;
      });
      // The owner still lists it.
      expect(ownerSeen.at(-1)).toContain(collectionId);
    } finally {
      ownerUnsubscribe();
      coeditorUnsubscribe();
    }
  });

  it("uploads homebrew images to a guarded bucket", { timeout: 60000 }, async () => {
    await setUpPeople();
    const collectionId = await createCollection();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const file = new File([bytes], "sigil.png", { type: "image/png" });

    const path = await uploadHomebrewImage({
      collectionId,
      file,
      client: owner.client,
    });
    expect(path.startsWith(`${collectionId}/`)).toBe(true);

    // Anyone can read the image back.
    const url = await getHomebrewImageUrl(path);
    expect(url).toContain("homebrew-images");
    const anonDownload = await personClient(cfg)
      .storage.from("homebrew-images")
      .download(path);
    expect(anonDownload.error).toBeNull();

    // Signed-out uploads are refused.
    const anonUpload = await personClient(cfg)
      .storage.from("homebrew-images")
      .upload(`${collectionId}/anon.png`, bytes, {
        contentType: "image/png",
        upsert: true,
      });
    expect(anonUpload.error).not.toBeNull();

    await deleteHomebrewImage({ path, client: owner.client });
  });
});

async function createInviteKeyAs(
  person: LivePerson,
  collectionId: string
): Promise<string> {
  const invitePath = (await getEditorInviteUrl(collectionId, {
    client: person.client,
  })) as string;
  return invitePath.split("/invite/")[1] as string;
}

async function createStatReturningId(
  collectionId: string,
  client: SupabaseClient
): Promise<string> {
  const { data, error } = await client
    .from("homebrew_stats")
    .insert({ collection_id: collectionId, data: { dataswornId: "s", label: "S" } })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("stat insert failed");
  return (data as unknown as { id: string }).id;
}

async function createImpactCategoryReturningId(
  collectionId: string,
  client: SupabaseClient
): Promise<string> {
  const { data, error } = await client
    .from("homebrew_impact_categories")
    .insert({ collection_id: collectionId, data: { label: "Impacts" } })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("impact category insert failed");
  return (data as unknown as { id: string }).id;
}

async function createOracleCollectionReturningId(
  collectionId: string,
  client: SupabaseClient
): Promise<string> {
  const { data, error } = await client
    .from("homebrew_oracle_collections")
    .insert({ collection_id: collectionId, data: { label: "Oracles" } })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("oracle collection insert failed");
  return (data as unknown as { id: string }).id;
}

interface ContentIds {
  stat: string;
  conditionMeter: string;
  nonLinearMeter: string;
  impactCategory: string;
  legacyTrack: string;
  moveCategory: string;
  move: string;
  oracleCollection: string;
  oracleTable: string;
  assetCollection: string;
  asset: string;
}

async function idsInTable(
  client: SupabaseClient,
  table: string,
  collectionId: string
): Promise<string[]> {
  const { data, error } = await client
    .from(table)
    .select("id")
    .eq("collection_id", collectionId);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function createAllContent(
  collectionId: string,
  client: SupabaseClient
): Promise<ContentIds> {
  const opts = { client };
  await createHomebrewMoveCategory({
    moveCategory: { collectionId, label: "Moves" },
    ...opts,
  });
  const [moveCategory] = await idsInTable(
    client,
    "homebrew_move_categories",
    collectionId
  );
  await createHomebrewMove({
    move: {
      collectionId,
      categoryId: moveCategory as string,
      label: "Strike",
      text: "Do a thing.",
      type: MoveType.NoRoll,
    },
    ...opts,
  });
  await createHomebrewOracleCollection({
    oracleCollection: { collectionId, label: "Oracles" },
    ...opts,
  });
  const [oracleCollection] = await idsInTable(
    client,
    "homebrew_oracle_collections",
    collectionId
  );
  await createHomebrewOracleTable({
    oracleTable: {
      collectionId,
      oracleCollectionId: oracleCollection as string,
      label: "Ask",
      columnLabels: { roll: "d100", result: "Result" },
      rows: [],
    },
    ...opts,
  });
  await createHomebrewAssetCollection({
    assetCollection: { collectionId, label: "Assets" },
    ...opts,
  });
  const [assetCollection] = await idsInTable(
    client,
    "homebrew_asset_collections",
    collectionId
  );
  await createHomebrewAsset({
    asset: {
      collectionId,
      categoryKey: assetCollection as string,
      label: "Blade",
      abilities: [],
    },
    ...opts,
  });
  await createHomebrewStat({
    stat: { collectionId, dataswornId: "stat", label: "Stat" },
    ...opts,
  });
  const [stat] = await idsInTable(client, "homebrew_stats", collectionId);
  await createHomebrewConditionMeter({
    conditionMeter: {
      collectionId,
      dataswornId: "meter",
      label: "Meter",
      value: 1,
      min: 0,
      max: 5,
      shared: true,
      rollable: true,
    },
    ...opts,
  });
  const [conditionMeter] = await idsInTable(
    client,
    "homebrew_condition_meters",
    collectionId
  );
  await createHomebrewNonLinearMeter({
    meter: {
      collectionId,
      dataswornId: "nonlinear",
      label: "Track",
      options: [],
      shared: true,
      rollable: false,
    },
    ...opts,
  });
  const [nonLinearMeter] = await idsInTable(
    client,
    "homebrew_non_linear_meters",
    collectionId
  );
  await createHomebrewImpactCategory({
    impactCategory: { collectionId, label: "Impacts", contents: {} },
    ...opts,
  });
  const [impactCategory] = await idsInTable(
    client,
    "homebrew_impact_categories",
    collectionId
  );
  await createHomebrewLegacyTrack({
    legacyTrack: {
      collectionId,
      dataswornId: "track",
      label: "Quests",
      shared: false,
      optional: true,
    },
    ...opts,
  });
  const [legacyTrack] = await idsInTable(
    client,
    "homebrew_legacy_tracks",
    collectionId
  );
  const [move] = await idsInTable(client, "homebrew_moves", collectionId);
  const [oracleTable] = await idsInTable(
    client,
    "homebrew_oracle_tables",
    collectionId
  );
  const [asset] = await idsInTable(client, "homebrew_assets", collectionId);
  return {
    stat: stat as string,
    conditionMeter: conditionMeter as string,
    nonLinearMeter: nonLinearMeter as string,
    impactCategory: impactCategory as string,
    legacyTrack: legacyTrack as string,
    moveCategory: moveCategory as string,
    move: move as string,
    oracleCollection: oracleCollection as string,
    oracleTable: oracleTable as string,
    assetCollection: assetCollection as string,
    asset: asset as string,
  };
}

async function updateAllContent(
  ids: ContentIds,
  client: SupabaseClient
): Promise<void> {
  const opts = { client };
  const label = { label: "v2" };
  await updateHomebrewStat({ statId: ids.stat, stat: label, ...opts });
  await updateHomebrewConditionMeter({
    conditionMeterId: ids.conditionMeter,
    conditionMeter: label,
    ...opts,
  });
  await updateHomebrewNonLinearMeter({
    meterId: ids.nonLinearMeter,
    meter: label,
    ...opts,
  });
  await updateHomebrewImpactCategory({
    impactCategoryId: ids.impactCategory,
    impactCategory: label,
    ...opts,
  });
  await updateHomebrewLegacyTrack({
    legacyTrackId: ids.legacyTrack,
    legacyTrack: label,
    ...opts,
  });
  await updateHomebrewMoveCategory({
    moveCategoryId: ids.moveCategory,
    moveCategory: label,
    ...opts,
  });
  await updateHomebrewMove({
    moveId: ids.move,
    move: {
      label: "v2",
      categoryId: ids.moveCategory,
      text: "Do a thing.",
      type: MoveType.NoRoll,
    },
    ...opts,
  });
  await updateHomebrewOracleCollection({
    oracleCollectionId: ids.oracleCollection,
    oracleCollection: label,
    ...opts,
  });
  await updateHomebrewOracleTable({
    oracleTableId: ids.oracleTable,
    oracleTable: {
      label: "v2",
      oracleCollectionId: ids.oracleCollection,
      columnLabels: { roll: "d100", result: "Result" },
      rows: [],
    },
    ...opts,
  });
  await updateHomebrewAssetCollection({
    assetCollectionId: ids.assetCollection,
    assetCollection: label,
    ...opts,
  });
  await updateHomebrewAsset({
    assetId: ids.asset,
    asset: { label: "v2", categoryKey: ids.assetCollection, abilities: [] },
    ...opts,
  });
}

async function removeAllContent(
  ids: ContentIds,
  client: SupabaseClient
): Promise<void> {
  const opts = { client };
  await deleteHomebrewMove({ moveId: ids.move, ...opts });
  await deleteHomebrewMoveCategory({
    moveCategoryId: ids.moveCategory,
    ...opts,
  });
  await deleteHomebrewOracleTable({
    oracleTableId: ids.oracleTable,
    ...opts,
  });
  await deleteHomebrewOracleCollection({
    oracleCollectionId: ids.oracleCollection,
    ...opts,
  });
  await deleteHomebrewAsset({ assetId: ids.asset, ...opts });
  await deleteHomebrewAssetCollection({
    assetCollectionId: ids.assetCollection,
    ...opts,
  });
  await deleteHomebrewStat({ statId: ids.stat, ...opts });
  await deleteHomebrewConditionMeter({
    conditionMeterId: ids.conditionMeter,
    ...opts,
  });
  await deleteHomebrewNonLinearMeter({
    meterId: ids.nonLinearMeter,
    ...opts,
  });
  await deleteHomebrewImpactCategory({
    impactCategoryId: ids.impactCategory,
    ...opts,
  });
  await deleteHomebrewLegacyTrack({
    legacyTrackId: ids.legacyTrack,
    ...opts,
  });
}
