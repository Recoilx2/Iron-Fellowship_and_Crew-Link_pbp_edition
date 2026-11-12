import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { addCharacterToCampaign } from "api-calls/campaign/addCharacterToCampaign";
import { leaveCampaign } from "api-calls/campaign/leaveCampaign";
import { createCharacter } from "api-calls/character/createCharacter";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { addProgressTrack } from "api-calls/tracks/addProgressTrack";
import { updateProgressTrack } from "api-calls/tracks/updateProgressTrack";
import { removeProgressTrack } from "api-calls/tracks/removeProgressTrack";
import { deleteAllProgressTracks } from "api-calls/tracks/deleteAllProgressTracks";
import { listenToProgressTracks } from "api-calls/tracks/listenToProgressTracks";
import { addAsset } from "api-calls/assets/addAsset";
import { updateAsset } from "api-calls/assets/updateAsset";
import { updateAssetCheckbox } from "api-calls/assets/updateAssetCheckbox";
import { removeAsset } from "api-calls/assets/removeAsset";
import { deleteAllAssets } from "api-calls/assets/deleteAllAssets";
import { listenToAssets } from "api-calls/assets/listenToAssets";
import { updateSettings } from "api-calls/character-campaign-settings/updateSettings";
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
      campaignType: CampaignType.Guided,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    return { gm, player, outsider, campaignId };
  }

  it("shares tracks live with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, outsider, campaignId } = await setUpTable();

    // The player follows campaign tracks live.
    const seen: Array<Record<string, { label: string }>> = [];
    const gone: string[] = [];
    unsubscribes.push(
      listenToProgressTracks(
        campaignId,
        undefined,
        TrackStatus.Active,
        (tracks) => seen.push(tracks as Record<string, { label: string }>),
        (trackId) => gone.push(trackId),
        () => {}
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

    // The GM renames it; the player follows.
    await signOut();
    await signInAs(gm);
    await updateProgressTrack({
      campaignId,
      trackId,
      track: { label: "Vow renewed" } as never,
    });
    await waitFor(() =>
      seen.some((tracks) => tracks[trackId]?.label === "Vow renewed")
        ? seen
        : null
    );

    // An outsider reads nothing and writes nothing.
    const outsiderTracks = await outsider.client
      .from("campaign_tracks")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(outsiderTracks.error).toBeNull();
    expect(outsiderTracks.data ?? []).toEqual([]);
    await signOut();
    await signInAs(outsider);
    await expect(
      addProgressTrack({
        campaignId,
        track: { label: "Sneak", type: "vow" } as never,
      })
    ).rejects.toBeTruthy();

    // The GM removes it; the player sees it go.
    await signOut();
    await signInAs(gm);
    await removeProgressTrack({ campaignId, id: trackId });
    await waitFor(() => (gone.includes(trackId) ? gone : null));
    await deleteAllProgressTracks({ campaignId });
  });

  it("shares assets live with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, outsider, campaignId } = await setUpTable();

    const seen: Array<Record<string, AssetDocument>> = [];
    unsubscribes.push(
      listenToAssets(
        undefined,
        campaignId,
        (assets) => seen.push(assets),
        () => {}
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
    await signOut();
    await signInAs(outsider);
    await expect(
      addAsset({
        campaignId,
        asset: { id: "x", enabledAbilities: {}, order: 0 },
      })
    ).rejects.toBeTruthy();

    await signOut();
    await signInAs(gm);
    await updateAsset({
      campaignId,
      assetId,
      asset: { order: 2 } as never,
    });
    await removeAsset({ campaignId, assetId });
    await waitFor(() =>
      seen.length > 0 && !seen.at(-1)?.[assetId] ? seen : null
    );
    await deleteAllAssets({ campaignId });
  });

  it("shares settings with members, and nobody else", { timeout: 120000 }, async () => {
    const { gm, outsider, campaignId } = await setUpTable();

    const seen: SettingsDocument[] = [];
    unsubscribes.push(
      listenToSettings(undefined, campaignId, (settings) =>
        seen.push(settings)
      , () => {})
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
    await signOut();
    await signInAs(outsider);
    await expect(
      updateSettings({ campaignId, settings: { customStats: ["sneak"] } })
    ).rejects.toBeTruthy();
    await signOut();
    await signInAs(gm);
    await updateSettings({ campaignId, settings: { customStats: [] } });
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
