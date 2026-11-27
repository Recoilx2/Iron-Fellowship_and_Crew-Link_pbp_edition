import { afterEach, describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminClient,
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

/**
 * Shadow-phase seam for spec #205/#206. No production listener subscribes
 * to these topics yet: the tests join them directly to prove that the RLS
 * policies and the SECURITY DEFINER triggers are in place before any client
 * is flipped. They skip without a stack, like every other *.live.test.ts.
 */

const config = liveStackConfig();

interface Joined {
  topic: string;
  client: SupabaseClient;
  channel: ReturnType<SupabaseClient["channel"]>;
  statuses: string[];
  messages: Array<{ event: string; payload: unknown }>;
  status: () => string | null;
}

function join(client: SupabaseClient, topic: string, event: string): Joined {
  const joined: Joined = {
    topic,
    client,
    channel: client.channel(topic, { config: { private: true } }),
    statuses: [],
    messages: [],
    status: () =>
      joined.statuses.find((value) =>
        ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(value)
      ) ?? null,
  };
  joined.channel.on("broadcast", { event }, (message) => {
    joined.messages.push(
      message as unknown as { event: string; payload: unknown }
    );
  });
  joined.channel.subscribe((status) => {
    joined.statuses.push(status);
  });
  return joined;
}

function payloadId(message: { payload: unknown }): string | null {
  const payload = message.payload as Record<string, unknown> | null;
  const id = payload && (payload.id ?? (payload.record as Record<string, unknown> | undefined)?.id);
  return typeof id === "string" ? id : null;
}

describe.skipIf(!config)("private broadcast topics against the local stack", () => {
  const cfg = config as LiveStackConfig;
  let campaignId = "";
  let people: LivePerson[] = [];
  let gm: LivePerson;
  let player: LivePerson;
  let outsider: LivePerson;
  const joined: Joined[] = [];

  const track = <T extends Joined>(value: T): T => {
    joined.push(value);
    return value;
  };

  const settle = async (value: Joined) => {
    const status = await waitFor(() => value.status(), 30000);
    return status;
  };

  afterEach(async () => {
    await Promise.all(
      joined.splice(0).map((value) => value.client.removeChannel(value.channel))
    );
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

  it("lets a GM join campaign-gm but refuses a player", { timeout: 90000 }, async () => {
    await setUpRoster();
    const topic = `campaign-gm:${campaignId}:notes`;
    const asGm = track(join(gm.client, topic, "DELETE"));
    const asPlayer = track(join(player.client, topic, "DELETE"));
    expect(await settle(asGm)).toBe("SUBSCRIBED");
    expect(await settle(asPlayer)).not.toBe("SUBSCRIBED");
  });

  it("lets members join campaign-shared but refuses an outsider", { timeout: 90000 }, async () => {
    await setUpRoster();
    const topic = `campaign-shared:${campaignId}:notes`;
    const asGm = track(join(gm.client, topic, "INSERT"));
    const asPlayer = track(join(player.client, topic, "INSERT"));
    const asOutsider = track(join(outsider.client, topic, "INSERT"));
    expect(await settle(asGm)).toBe("SUBSCRIBED");
    expect(await settle(asPlayer)).toBe("SUBSCRIBED");
    expect(await settle(asOutsider)).not.toBe("SUBSCRIBED");
  });

  it("checks channel-shared against the channel roster", { timeout: 90000 }, async () => {
    await setUpRoster();
    const channelId = randomCampaignId();
    const admin = adminClient(cfg);
    const created = await admin.from("chat_channels").insert({
      id: channelId,
      campaign_id: campaignId,
      name: "Side quest",
      kind: "IC",
      visibility: "private",
    });
    expect(created.error).toBeNull();
    const roster = await admin
      .from("chat_channel_members")
      .insert({ channel_id: channelId, user_id: player.userId });
    expect(roster.error).toBeNull();

    const topic = `channel-shared:${channelId}`;
    const asPlayer = track(join(player.client, topic, "INSERT"));
    const asOutsider = track(join(outsider.client, topic, "INSERT"));
    // A campaign GM may read a private channel without sitting on its roster.
    const asGm = track(join(gm.client, topic, "INSERT"));
    expect(await settle(asPlayer)).toBe("SUBSCRIBED");
    expect(await settle(asGm)).toBe("SUBSCRIBED");
    expect(await settle(asOutsider)).not.toBe("SUBSCRIBED");
  });

  it("refuses channel-shared when the campaign membership is gone but the roster row is stale", { timeout: 90000 }, async () => {
    await setUpRoster();
    const channelId = randomCampaignId();
    const admin = adminClient(cfg);
    const created = await admin.from("chat_channels").insert({
      id: channelId,
      campaign_id: campaignId,
      name: "Side quest",
      kind: "IC",
      visibility: "private",
    });
    expect(created.error).toBeNull();

    // Losing campaign membership clears channel roster rows through
    // chat_channel_members_clear_on_campaign_leave, so create the stale row
    // AFTER the revoke, with the service role (the table has no INSERT
    // policy and no FK to campaign_members). That isolates the real gate:
    // is_channel_member is true, but can_read_channel must still be false.
    const revoked = await admin
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", player.userId);
    expect(revoked.error).toBeNull();
    const gone = await admin
      .from("campaign_members")
      .select("user_id")
      .eq("campaign_id", campaignId)
      .eq("user_id", player.userId);
    expect(gone.data ?? []).toHaveLength(0);

    const roster = await admin
      .from("chat_channel_members")
      .insert({ channel_id: channelId, user_id: player.userId });
    expect(roster.error).toBeNull();
    const stale = await admin
      .from("chat_channel_members")
      .select("user_id")
      .eq("channel_id", channelId)
      .eq("user_id", player.userId);
    expect(stale.data ?? []).toHaveLength(1);

    const topic = `channel-shared:${channelId}`;
    const asFormerMember = track(join(player.client, topic, "INSERT"));
    const asGm = track(join(gm.client, topic, "INSERT"));
    expect(await settle(asGm)).toBe("SUBSCRIBED");
    expect(await settle(asFormerMember)).not.toBe("SUBSCRIBED");
  });

  it("keeps a GM-only DELETE on the GM topic", { timeout: 90000 }, async () => {
    await setUpRoster();
    const shared = track(
      join(player.client, `campaign-shared:${campaignId}:notes`, "DELETE")
    );
    const gmTopic = track(
      join(gm.client, `campaign-gm:${campaignId}:notes`, "DELETE")
    );
    expect(await settle(shared)).toBe("SUBSCRIBED");
    expect(await settle(gmTopic)).toBe("SUBSCRIBED");

    const noteId = randomCampaignId();
    const admin = adminClient(cfg);
    const inserted = await admin.from("campaign_notes").insert({
      id: noteId,
      campaign_id: campaignId,
      title: "Hidden",
      shared: false,
    });
    expect(inserted.error).toBeNull();
    const deleted = await admin
      .from("campaign_notes")
      .delete()
      .eq("id", noteId);
    expect(deleted.error).toBeNull();

    const seen = await waitFor(
      () => gmTopic.messages.find((message) => payloadId(message) === noteId) ?? null
    );
    expect(seen?.event).toBe("DELETE");
    expect(shared.messages.some((message) => payloadId(message) === noteId)).toBe(
      false
    );
  });

  it("signals refresh on every topic when access is revoked", { timeout: 90000 }, async () => {
    await setUpRoster();
    const topic = `campaign-shared:${campaignId}:notes`;
    const listener = track(join(player.client, topic, "refresh"));
    expect(await settle(listener)).toBe("SUBSCRIBED");

    const admin = adminClient(cfg);
    const revoked = await admin
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", player.userId);
    expect(revoked.error).toBeNull();

    const refresh = await waitFor(
      () => listener.messages.find((message) => message.event === "refresh") ?? null
    );
    expect(refresh).toBeTruthy();
    expect(
      (refresh.payload as Record<string, unknown>).kind ??
        (refresh.payload as { payload?: Record<string, unknown> }).payload?.kind
    ).toBe("refresh");
  });
});
