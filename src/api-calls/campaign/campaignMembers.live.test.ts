import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { listenToNotes } from "api-calls/notes/listenToNotes";
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

async function rosterAs(person: LivePerson, campaignId: string) {
  return person.client
    .from("campaign_members")
    .select("campaign_id, user_id, role")
    .eq("campaign_id", campaignId);
}

describe.skipIf(!config)("campaign membership access rules", () => {
  const cfg = config as LiveStackConfig;
  let campaignId = "";
  let people: LivePerson[] = [];
  let gm: LivePerson;
  let player: LivePerson;
  let outsider: LivePerson;

  afterEach(async () => {
    await getSupabaseClient().auth.signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUpRoster() {
    campaignId = randomCampaignId();
    gm = await createPerson(cfg, "gm");
    player = await createPerson(cfg, "player");
    outsider = await createPerson(cfg, "outsider");
    people = [gm, player, outsider];
    await ensureCampaign(cfg, campaignId);
    await grantMembership(cfg, campaignId, gm.userId, "gm");
    await grantMembership(cfg, campaignId, player.userId, "player");
  }

  it("lets the GM and the player see the roster, and nobody else", { timeout: 60000 }, async () => {
    await setUpRoster();

    const asGm = await rosterAs(gm, campaignId);
    expect(asGm.error).toBeNull();
    expect(asGm.data?.map((row) => row.user_id).sort()).toEqual(
      [gm.userId, player.userId].sort()
    );

    const asPlayer = await rosterAs(player, campaignId);
    expect(asPlayer.error).toBeNull();
    expect(asPlayer.data).toHaveLength(2);

    const asOutsider = await rosterAs(outsider, campaignId);
    expect(asOutsider.error).toBeNull();
    expect(asOutsider.data).toEqual([]);

    const asAnon = await rosterAs(
      { client: personClient(cfg) } as LivePerson,
      campaignId
    );
    // Signed out: either an empty roster or a refusal, but never rows.
    expect(asAnon.error ? [] : (asAnon.data ?? [])).toEqual([]);
  });

  it("lets only the GM change the roster", { timeout: 60000 }, async () => {
    await setUpRoster();
    const newcomer = await createPerson(cfg, "newcomer");
    people.push(newcomer);

    // The GM adds the newcomer as a player.
    const added = await gm.client.from("campaign_members").insert({
      campaign_id: campaignId,
      user_id: newcomer.userId,
      role: "player",
    });
    expect(added.error).toBeNull();

    // A player cannot add anyone.
    const byPlayer = await player.client.from("campaign_members").insert({
      campaign_id: campaignId,
      user_id: outsider.userId,
      role: "player",
    });
    expect(byPlayer.error).not.toBeNull();

    // An outsider cannot add themselves.
    const byOutsider = await outsider.client
      .from("campaign_members")
      .insert({
        campaign_id: campaignId,
        user_id: outsider.userId,
        role: "player",
      });
    expect(byOutsider.error).not.toBeNull();

    // A player cannot promote themselves or remove anyone. RLS filters
    // denied UPDATE/DELETE rows instead of raising, so the denial surfaces
    // as zero matched rows (same as the homebrew outsider-writes pattern).
    const promoted = await player.client
      .from("campaign_members")
      .update({ role: "gm" })
      .eq("campaign_id", campaignId)
      .eq("user_id", player.userId)
      .select();
    expect(promoted.error).toBeNull();
    expect(promoted.data ?? []).toEqual([]);

    const removedByPlayer = await player.client
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", newcomer.userId)
      .select();
    expect(removedByPlayer.error).toBeNull();
    expect(removedByPlayer.data ?? []).toEqual([]);

    // The GM removes the newcomer again.
    const removed = await gm.client
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", newcomer.userId);
    expect(removed.error).toBeNull();
  });

  it("empties a player's open notes listener within seconds of roster removal", { timeout: 90000 }, async () => {
    await setUpRoster();
    const noteId = randomCampaignId();
    const note = await gm.client.from("campaign_notes").insert({
      id: noteId,
      campaign_id: campaignId,
      title: "Visible to members",
      shared: true,
    });
    expect(note.error).toBeNull();

    await signInAs(player);
    const seen: Array<string[]> = [];
    const stop = listenToNotes(
      campaignId,
      undefined,
      (_source, notes) => seen.push(notes.map((item) => item.noteId)),
      () => {}
    );
    try {
      await waitFor(() => (seen.at(-1)?.includes(noteId) ? seen : null));
      const started = Date.now();
      const removed = await gm.client
        .from("campaign_members")
        .delete()
        .eq("campaign_id", campaignId)
        .eq("user_id", player.userId);
      expect(removed.error).toBeNull();

      // The membership-delete trigger publishes refresh on the campaign
      // topic, so the listener re-fetches (and RLS empties it) in seconds.
      await waitFor(() => (seen.at(-1)?.length === 0 ? seen : null), 6000);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      stop();
    }
  });
});
