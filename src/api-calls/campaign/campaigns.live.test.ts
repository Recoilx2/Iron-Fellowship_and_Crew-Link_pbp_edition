import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { getCampaign } from "api-calls/campaign/getCampaign";
import { updateCampaign } from "api-calls/campaign/updateCampaign";
import { deleteCampaign } from "api-calls/campaign/deleteCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { previewCampaign } from "api-calls/campaign/previewCampaign";
import { leaveCampaign } from "api-calls/campaign/leaveCampaign";
import { updateCampaignGM } from "api-calls/campaign/updateCampaignGM";
import { addCharacterToCampaign } from "api-calls/campaign/addCharacterToCampaign";
import { removeCharacterFromCampaign } from "api-calls/campaign/removeCharacterFromCampaign";
import { listenToUsersCampaigns } from "api-calls/campaign/listenToUsersCampaigns";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { createCharacter } from "api-calls/character/createCharacter";
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

describe.skipIf(!config)("campaigns end to end", () => {
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

  async function setUpTrio() {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);
    return { gm, player, outsider };
  }

  it("creates a co-op campaign with the founder as GM, hidden from outsiders", { timeout: 90000 }, async () => {
    const { gm, outsider } = await setUpTrio();
    await signInAs(gm);

    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Co-op quest",
      campaignType: CampaignType.Coop,
    });

    const campaign = await getCampaign(campaignId);
    expect(campaign.name).toBe("Co-op quest");
    expect(campaign.users).toContain(gm.userId);
    expect(campaign.gmIds).toContain(gm.userId);

    // An outsider sees nothing: no rows, no reads, no writes.
    const outsiderRows = await outsider.client
      .from("campaigns")
      .select("id")
      .eq("id", campaignId);
    expect(outsiderRows.error).toBeNull();
    expect(outsiderRows.data ?? []).toEqual([]);
    await signOut();
    await signInAs(outsider);
    await expect(getCampaign(campaignId)).rejects.toBeTruthy();
    await expect(
      updateCampaign({ campaignId, campaign: { name: "Hijacked" } })
    ).rejects.toBeTruthy();
    await expect(deleteCampaign({ campaignId })).rejects.toBeTruthy();
  });

  it("starts solo and guided founders as players, who still manage their campaign", { timeout: 90000 }, async () => {
    const { gm } = await setUpTrio();
    await signInAs(gm);

    const guidedId = await createCampaign({
      uid: gm.userId,
      campaignName: "Guided tale",
      campaignType: CampaignType.Guided,
    });
    const membership = await gm.client
      .from("campaign_members")
      .select("role")
      .eq("campaign_id", guidedId)
      .eq("user_id", gm.userId)
      .single();
    expect(membership.error).toBeNull();
    expect(membership.data?.role).toBe("player");

    // The founding player renames and deletes their own campaign.
    await updateCampaign({ campaignId: guidedId, campaign: { name: "Retitled" } });
    expect((await getCampaign(guidedId)).name).toBe("Retitled");
    await deleteCampaign({ campaignId: guidedId });
    await expect(getCampaign(guidedId)).rejects.toBeTruthy();
  });

  it("runs the invite-link join flow: preview, join, rejoin", { timeout: 90000 }, async () => {
    const { gm, player, outsider } = await setUpTrio();
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Open table",
      campaignType: CampaignType.Guided,
    });

    // Before joining, the invitee sees only the preview name -- never the
    // campaign row or its roster.
    const preview = await player.client.rpc("preview_campaign", {
      cid: campaignId,
    });
    expect(preview.error).toBeNull();
    const before = await player.client
      .from("campaigns")
      .select("id")
      .eq("id", campaignId);
    expect(before.error).toBeNull();
    expect(before.data ?? []).toEqual([]);

    await signOut();
    await signInAs(player);
    const joined = await joinCampaign({ campaignId });
    expect(joined.name).toBe("Open table");

    // Joining again is a no-op, and the roster shows the newcomer as player.
    await joinCampaign({ campaignId });
    const campaign = await getCampaign(campaignId);
    expect(campaign.users).toEqual(
      expect.arrayContaining([gm.userId, player.userId])
    );

    // Joining a campaign that does not exist fails.
    await signOut();
    await signInAs(outsider);
    await expect(
      joinCampaign({ campaignId: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toBeTruthy();
    await expect(
      previewCampaign({ campaignId: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toBeTruthy();
  });

  it("lets a player join with a character, and unlink it again", { timeout: 90000 }, async () => {
    const { gm, player, outsider } = await setUpTrio();
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Fellowship",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    const characterId = await createCharacter({
      uid: player.userId,
      name: "Pip",
      stats: {},
      assets: [],
    });
    await addCharacterToCampaign({
      uid: player.userId,
      characterId,
      campaignId,
    });

    const campaign = await getCampaign(campaignId);
    expect(campaign.characters).toContainEqual({
      uid: player.userId,
      characterId,
    });

    // An outsider cannot attach their character to the campaign.
    await signOut();
    await signInAs(outsider);
    const outsiderCharacter = await createCharacter({
      uid: outsider.userId,
      name: "Sneak",
      stats: {},
      assets: [],
    });
    await expect(
      addCharacterToCampaign({
        uid: outsider.userId,
        characterId: outsiderCharacter,
        campaignId,
      })
    ).rejects.toBeTruthy();

    // Unlinking keeps the character but drops the campaign link.
    await signOut();
    await signInAs(player);
    await removeCharacterFromCampaign({
      uid: player.userId,
      campaignId,
      characterId,
    });
    expect(await getCampaign(campaignId)).toMatchObject({ characters: [] });
    const character = await player.client
      .from("characters")
      .select("id, campaign_id")
      .eq("id", characterId)
      .single();
    expect(character.error).toBeNull();
    expect(character.data?.campaign_id).toBeNull();
  });

  it("lets GMs manage co-GMs and members, and cuts removed members off", { timeout: 120000 }, async () => {
    const { gm, player, outsider } = await setUpTrio();
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Managed table",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });

    // A player cannot promote themselves; the GM promotes them to co-GM.
    await expect(
      updateCampaignGM({ campaignId, gmId: player.userId })
    ).rejects.toBeTruthy();
    await signOut();
    await signInAs(gm);
    await updateCampaignGM({ campaignId, gmId: player.userId });
    expect((await getCampaign(campaignId)).gmIds).toEqual(
      expect.arrayContaining([player.userId])
    );
    await updateCampaignGM({
      campaignId,
      gmId: player.userId,
      shouldRemove: true,
    });
    expect((await getCampaign(campaignId)).gmIds ?? []).not.toContain(
      player.userId
    );

    // The player follows their campaigns live. The player keeps their
    // session from here on; the GM acts through their own client.
    await signOut();
    await signInAs(player);
    const seen: string[] = [];
    const removed: string[] = [];
    let loaded = false;
    unsubscribes.push(
      listenToUsersCampaigns(
        player.userId,
        {
          onDocChange: (id) => seen.push(id),
          onDocRemove: (id) => removed.push(id),
          onLoaded: () => {
            loaded = true;
          },
        },
        () => {}
      )
    );
    await waitFor(() => (loaded && seen.includes(campaignId) ? seen : null));

    // The GM removes the player: the roster row vanishes and every
    // campaign table goes blind for them immediately.
    const kicked = await gm.client.rpc("remove_campaign_member", {
      cid: campaignId,
      target_uid: player.userId,
    });
    expect(kicked.error).toBeNull();
    await waitFor(() => (removed.includes(campaignId) ? removed : null));
    for (const table of [
      "campaigns",
      "campaign_members",
      "campaign_tracks",
      "campaign_assets",
      "campaign_settings",
    ]) {
      const reread = await player.client.from(table).select("*").limit(1);
      expect(reread.error).toBeNull();
      expect(reread.data ?? []).toEqual([]);
    }

    // An outsider cannot remove anyone.
    await signOut();
    await signInAs(outsider);
    await expect(
      leaveCampaign({ uid: gm.userId, campaignId })
    ).rejects.toBeTruthy();
  });

  it("lets members leave by themselves and unlinks their characters", { timeout: 90000 }, async () => {
    const { gm, player } = await setUpTrio();
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Leaving",
      campaignType: CampaignType.Guided,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    const characterId = await createCharacter({
      uid: player.userId,
      name: "Merry",
      stats: {},
      assets: [],
    });
    await addCharacterToCampaign({ uid: player.userId, characterId, campaignId });

    await leaveCampaign({ uid: player.userId, campaignId });
    await expect(getCampaign(campaignId)).rejects.toBeTruthy();
    const character = await player.client
      .from("characters")
      .select("id, campaign_id")
      .eq("id", characterId)
      .single();
    expect(character.error).toBeNull();
    expect(character.data?.campaign_id).toBeNull();
    expect(character.data?.id).toBe(characterId);
  });

  it("deletes the campaign with every shared row, and unlinks characters", { timeout: 90000 }, async () => {
    const { gm, player } = await setUpTrio();
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Doomed",
      campaignType: CampaignType.Coop,
    });
    await gm.client.from("campaign_tracks").insert({
      campaign_id: campaignId,
      label: "Vow",
      type: "vow",
      status: "active",
      value: 1,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    const characterId = await createCharacter({
      uid: player.userId,
      name: "Sam",
      stats: {},
      assets: [],
    });
    await addCharacterToCampaign({ uid: player.userId, characterId, campaignId });

    // A player cannot delete the campaign; the GM can.
    await expect(deleteCampaign({ campaignId })).rejects.toBeTruthy();
    await signOut();
    await signInAs(gm);
    await deleteCampaign({ campaignId });

    for (const table of [
      "campaigns",
      "campaign_members",
      "campaign_tracks",
      "campaign_assets",
      "campaign_settings",
    ]) {
      const reread = await gm.client
        .from(table)
        .select("*")
        .eq(table === "campaigns" ? "id" : "campaign_id", campaignId);
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
