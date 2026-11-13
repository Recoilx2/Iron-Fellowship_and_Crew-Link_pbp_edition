import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { addCharacterToCampaign } from "api-calls/campaign/addCharacterToCampaign";
import { leaveCampaign } from "api-calls/campaign/leaveCampaign";
import { createCharacter } from "api-calls/character/createCharacter";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { addProgressTrack } from "api-calls/tracks/addProgressTrack";
import { deleteAllProgressTracks } from "api-calls/tracks/deleteAllProgressTracks";
import { campaignTrackToColumns } from "api-calls/tracks/_getRef";
import { listenToProgressTracks } from "api-calls/tracks/listenToProgressTracks";
import { addAsset } from "api-calls/assets/addAsset";
import { updateAssetCheckbox } from "api-calls/assets/updateAssetCheckbox";
import { deleteAllAssets } from "api-calls/assets/deleteAllAssets";
import { campaignAssetDocumentToColumns } from "api-calls/assets/_getRef";
import { listenToAssets } from "api-calls/assets/listenToAssets";
import { updateSettings } from "api-calls/character-campaign-settings/updateSettings";
import { campaignSettingsToColumns } from "api-calls/character-campaign-settings/_getRef";
import { showOrHideCustomMove } from "api-calls/character-campaign-settings/showOrHideCustomMove";
import { listenToSettings } from "api-calls/character-campaign-settings/listenToSettings";
import type { SettingsDocument } from "api-calls/character-campaign-settings/_character-campaign-settings.type";
import type { AssetDocument } from "api-calls/assets/_asset.type";
import { TrackStatus } from "types/Track.type";
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

describe.skipIf(!config)("campaign shared tables end to end", () => {
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

  async function setUpTable(): Promise<{
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
      campaignName: "Shared table",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    return { gm, player, outsider, campaignId };
  }

  it("shares tracks live with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, outsider, campaignId } = await setUpTable();

    // The player follows campaign tracks live. The singleton keeps the
    // player's session for the whole test: everyone else acts through
    // their own client, so the subscription never rides a mid-stream
    // identity switch (which stalls the channel or closes it).
    const seen: Array<Record<string, { label: string }>> = [];
    const gone: string[] = [];
    const errors: unknown[] = [];
    unsubscribes.push(
      listenToProgressTracks(
        campaignId,
        undefined,
        TrackStatus.Active,
        (tracks) => seen.push(tracks as Record<string, { label: string }>),
        (trackId) => gone.push(trackId),
        (error) => errors.push(error)
      )!
    );
    await addProgressTrack({
      campaignId,
      track: {
        label: "Swear an Iron Vow",
        type: "vow",
        value: 1,
        status: TrackStatus.Active,
        createdDate: new Date(),
      } as never,
    });
    const arrived = await waitFor(() =>
      Object.keys(seen.at(-1) ?? {}).length > 0 ? seen : null
    );
    const trackId = Object.keys(arrived.at(-1) ?? {})[0];
    expect(arrived.at(-1)?.[trackId].label).toBe("Swear an Iron Vow");

    // The GM renames it through their own client; the player follows.
    // The update touches only the label, exactly what updateProgressTrack
    // would send for this change.
    const renamed = await gm.client
      .from("campaign_tracks")
      .update({ label: "Vow renewed" })
      .eq("id", trackId)
      .select("id");
    expect(renamed.error).toBeNull();
    expect(renamed.data ?? []).not.toEqual([]);
    await waitFor(() =>
      seen.some((tracks) => tracks[trackId]?.label === "Vow renewed")
        ? seen
        : null
    );

    // An outsider reads nothing and writes nothing. The outsider writes
    // through their own client, so the singleton never leaves the player.
    const outsiderTracks = await outsider.client
      .from("campaign_tracks")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(outsiderTracks.error).toBeNull();
    expect(outsiderTracks.data ?? []).toEqual([]);
    const deniedTrack = await outsider.client
      .from("campaign_tracks")
      .insert(
        campaignTrackToColumns(campaignId, {
          label: "Sneak",
          type: "vow",
          value: 1,
          status: TrackStatus.Active,
          createdDate: new Date(),
        } as never)
      );
    expect(deniedTrack.error).not.toBeNull();

    // The GM removes it through their own client; the player sees it go.
    const removed = await gm.client
      .from("campaign_tracks")
      .delete()
      .eq("id", trackId)
      .select("id");
    expect(removed.error).toBeNull();
    expect(removed.data ?? []).not.toEqual([]);
    await waitFor(() => (gone.includes(trackId) ? gone : null));
    await deleteAllProgressTracks({ campaignId });
    expect(errors).toEqual([]);
  });

  it("shares assets live with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, outsider, campaignId } = await setUpTable();

    // The singleton keeps the player's session for the whole test; the GM
    // and the outsider act through their own clients, so the subscription
    // never rides a mid-stream identity switch.
    const seen: Array<Record<string, AssetDocument>> = [];
    const errors: unknown[] = [];
    unsubscribes.push(
      listenToAssets(
        undefined,
        campaignId,
        (assets) => seen.push(assets),
        (error) => errors.push(error)
      )
    );
    await addAsset({
      campaignId,
      asset: { id: "ironsworn/assets/companion", enabledAbilities: {}, order: 0 },
    });
    const arrived = await waitFor(() =>
      Object.keys(seen.at(-1) ?? {}).length > 0 ? seen : null
    );
    const assetId = Object.keys(arrived.at(-1) ?? {})[0];
    expect(arrived.at(-1)?.[assetId].id).toBe(
      "ironsworn/assets/companion"
    );

    await updateAssetCheckbox({
      campaignId,
      assetId,
      abilityIndex: 0,
      checked: true,
    });
    await waitFor(() =>
      (seen.at(-1)?.[assetId].enabledAbilities as Record<string, boolean>)?.["0"]
        ? seen
        : null
    );

    const outsiderAssets = await outsider.client
      .from("campaign_assets")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(outsiderAssets.error).toBeNull();
    expect(outsiderAssets.data ?? []).toEqual([]);
    // The outsider writes through their own client, so the singleton never
    // leaves the player.
    const deniedAsset = await outsider.client
      .from("campaign_assets")
      .insert(
        campaignAssetDocumentToColumns(campaignId, {
          id: "x",
          enabledAbilities: {},
          order: 0,
        })
      );
    expect(deniedAsset.error).not.toBeNull();

    // The GM reorders and removes the asset through their own client. The
    // update touches only the order, exactly what updateAsset would send.
    const reordered = await gm.client
      .from("campaign_assets")
      .update({ sort_order: 2 })
      .eq("id", assetId)
      .select("id");
    expect(reordered.error).toBeNull();
    expect(reordered.data ?? []).not.toEqual([]);
    const removedAsset = await gm.client
      .from("campaign_assets")
      .delete()
      .eq("id", assetId)
      .select("id");
    expect(removedAsset.error).toBeNull();
    expect(removedAsset.data ?? []).not.toEqual([]);
    await waitFor(() =>
      seen.length > 0 && !seen.at(-1)?.[assetId] ? seen : null
    );
    await deleteAllAssets({ campaignId });
    expect(errors).toEqual([]);
  });

  it("shares settings with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, outsider, campaignId } = await setUpTable();

    // The singleton keeps the player's session for the whole test; the
    // outsider and the GM act through their own clients, so the
    // subscription never rides a mid-stream identity switch (which is what
    // used to surface `realtime subscribe CLOSED` here).
    const seen: SettingsDocument[] = [];
    const errors: unknown[] = [];
    // Campaign scope comes first, as in the settings store: the swapped
    // order subscribed to character settings for a campaign id and could
    // never see the campaign writes below.
    unsubscribes.push(
      listenToSettings(campaignId, undefined, (settings) =>
        seen.push(settings)
      , (error) => errors.push(error))
    );
    await updateSettings({
      campaignId,
      settings: { customStats: ["wits"] },
    });
    await waitFor(() =>
      seen.some((settings) => settings.customStats.includes("wits"))
        ? seen
        : null
    );

    await showOrHideCustomMove({ campaignId, moveId: "move-1", hidden: true });
    await waitFor(() =>
      seen.some((settings) =>
        settings.hiddenCustomMoveIds.includes("move-1")
      )
        ? seen
        : null
    );

    const outsiderSettings = await outsider.client
      .from("campaign_settings")
      .select("campaign_id")
      .eq("campaign_id", campaignId);
    expect(outsiderSettings.error).toBeNull();
    expect(outsiderSettings.data ?? []).toEqual([]);
    // The outsider writes through their own client — byte-identical to
    // updateSettings — so the singleton never leaves the player.
    const deniedSettings = await outsider.client
      .from("campaign_settings")
      .upsert(campaignSettingsToColumns(campaignId, { customStats: ["sneak"] }), {
        onConflict: "campaign_id",
      });
    expect(deniedSettings.error).not.toBeNull();
    // The GM resets through their own client.
    const reset = await gm.client.from("campaign_settings").upsert(
      campaignSettingsToColumns(campaignId, { customStats: [] }),
      { onConflict: "campaign_id" }
    );
    expect(reset.error).toBeNull();
    expect(errors).toEqual([]);
  });

  it("cuts a removed member off the shared tables at once", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpTable();

    // The player adds their character, then follows the shared tracks.
    const characterId = await createCharacter({
      uid: player.userId,
      name: "Kit",
      stats: {},
      assets: [],
    });
    await addCharacterToCampaign({
      uid: player.userId,
      characterId,
      campaignId,
    });
    await addProgressTrack({
      campaignId,
      track: {
        label: "Shared vow",
        type: "vow",
        value: 2,
        status: TrackStatus.Active,
        createdDate: new Date(),
      } as never,
    });

    // The GM removes the player: the character unlinks and every shared
    // table goes blind for them immediately.
    await signOut();
    await signInAs(gm);
    await leaveCampaign({ uid: player.userId, campaignId });
    for (const table of [
      "campaign_tracks",
      "campaign_assets",
      "campaign_settings",
      "campaign_rolls",
    ]) {
      const reread = await player.client.from(table).select("*").limit(1);
      expect(reread.error).toBeNull();
      expect(reread.data ?? []).toEqual([]);
    }
    const character = await player.client
      .from("characters")
      .select("id, campaign_id")
      .eq("id", characterId)
      .single();
    expect(character.error).toBeNull();
    expect(character.data?.campaign_id).toBeNull();
  });
});
