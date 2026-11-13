import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_CHANNEL_MEMBERS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";
import {
  listenToChannelPosts,
  type PostWithId,
} from "api-calls/chat/listenToChannelPosts";
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

function firstId(data: unknown): string {
  const value = (Array.isArray(data) ? data[0] : data) as unknown;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("expected a channel id back");
  }
  return value;
}

describe.skipIf(!config)("chat private channels and direct messages end to end", () => {
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

  async function setUpCampaign(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    other: LivePerson;
    bystander: LivePerson;
    outsider: LivePerson;
    campaignId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const other = await createPerson(cfg, "other");
    const bystander = await createPerson(cfg, "bystander");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, other, bystander, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Quiet quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    await signInAs(other);
    await joinCampaign({ campaignId });
    await signOut();
    await signInAs(bystander);
    await joinCampaign({ campaignId });
    await signOut();
    return { gm, player, other, bystander, outsider, campaignId };
  }

  async function createPrivateChannelAs(
    person: LivePerson,
    campaignId: string,
    memberIds: string[],
    name = "Side quest"
  ): Promise<string> {
    const { data, error } = await person.client.rpc("create_private_channel", {
      cid: campaignId,
      cname: name,
      ckind: "IC",
      member_ids: memberIds,
    });
    if (error) throw error;
    return firstId(data);
  }

  async function readChannelsAs(person: LivePerson, campaignId: string) {
    const { data, error } = await person.client
      .from(CHAT_CHANNELS_TABLE)
      .select("id, name, visibility")
      .eq("campaign_id", campaignId);
    expect(error).toBeNull();
    return (data ?? []) as Array<{
      id: string;
      name: string;
      visibility: string;
    }>;
  }

  async function readPostsAs(
    person: LivePerson,
    channelId: string
  ): Promise<PostRow[]> {
    const { data, error } = await person.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true });
    expect(error).toBeNull();
    return (data ?? []) as unknown as PostRow[];
  }

  async function readRosterAs(
    person: LivePerson,
    channelId: string
  ): Promise<Array<{ channel_id: string; user_id: string }>> {
    const { data, error } = await person.client
      .from(CHAT_CHANNEL_MEMBERS_TABLE)
      .select("channel_id, user_id")
      .eq("channel_id", channelId);
    expect(error).toBeNull();
    return (data ?? []) as Array<{ channel_id: string; user_id: string }>;
  }

  it("shows private posts to members and GMs only, live", { timeout: 180000 }, async () => {
    const { gm, player, bystander, outsider, campaignId } =
      await setUpCampaign();
    const channelId = await createPrivateChannelAs(gm, campaignId, [
      player.userId,
    ]);

    // Members and GMs read the channel; a member outside it reads nothing.
    expect(
      (await readChannelsAs(gm, campaignId)).find(
        (row) => row.id === channelId
      )
    ).toMatchObject({ visibility: "private" });
    expect(
      (await readChannelsAs(player, campaignId)).find(
        (row) => row.id === channelId
      )
    ).toMatchObject({ visibility: "private" });
    expect(await readChannelsAs(bystander, campaignId)).toHaveLength(2);
    expect(await readChannelsAs(outsider, campaignId)).toEqual([]);

    // Posts reach the member and the GM, live; the outsider-to-channel
    // never receives them, even past the reconcile re-fetch.
    await signInAs(player);
    const seen: PostWithId[][] = [];
    let loaded = false;
    const stopListening = listenToChannelPosts(
      channelId,
      30,
      {
        onPosts: (posts) => seen.push(posts),
        onHasOlder: () => {},
        onLoaded: () => {
          loaded = true;
        },
      },
      (error) => {
        throw error;
      }
    );
    unsubscribes.push(stopListening);
    await waitFor(() => (loaded && seen.length >= 1 ? seen : null));
    expect(seen.at(-1)).toEqual([]);

    const { error: postError } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: channelId,
        author_id: gm.userId,
        text: "Meet at the ruined chapel.",
      });
    expect(postError).toBeNull();
    await waitFor(() => (seen.at(-1)?.length === 1 ? seen : null));
    expect(seen.at(-1)?.[0]).toMatchObject({
      authorId: gm.userId,
      text: "Meet at the ruined chapel.",
    });

    // A member outside the channel reads nothing and writes nothing.
    // The live assertions are done: stop the subscription before the
    // identity switch below — switching the singleton with a channel open
    // closes it server-side (CLOSED → onError), which the throw-on-error
    // handler would surface as an uncaught failure.
    expect(await readPostsAs(bystander, channelId)).toEqual([]);
    stopListening();
    await signOut();
    await signInAs(bystander);
    const { error: refused } = await bystander.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: channelId,
        author_id: bystander.userId,
        text: "Let me in.",
      });
    expect(refused).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(await readPostsAs(player, channelId)).toHaveLength(1);
  });

  it("cuts a removed member off immediately, including open subscriptions", { timeout: 180000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    const channelId = await createPrivateChannelAs(gm, campaignId, [
      player.userId,
    ]);
    const { error: postError } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: channelId,
        author_id: gm.userId,
        text: "The plan, for your ears only.",
      });
    expect(postError).toBeNull();

    // The player watches the channel list and the feed with open
    // subscriptions while the GM acts through another client.
    await signInAs(player);
    const channelsSeen: string[][] = [];
    let channelsLoaded = false;
    unsubscribes.push(
      listenToCampaignChannels(
        campaignId,
        {
          onChannels: (channels) =>
            channelsSeen.push(channels.map((channel) => channel.id)),
          onLoaded: () => {
            channelsLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    const postsSeen: PostWithId[][] = [];
    let postsLoaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        channelId,
        30,
        {
          onPosts: (posts) => postsSeen.push(posts),
          onHasOlder: () => {},
          onLoaded: () => {
            postsLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      channelsLoaded && postsLoaded && channelsSeen.length >= 1 && postsSeen.length >= 1
        ? true
        : null
    );
    expect(channelsSeen.at(-1)).toContain(channelId);
    expect(postsSeen.at(-1)).toHaveLength(1);

    // The GM removes the player: the open list drops the channel and the
    // open feed empties without re-subscribing.
    const { error: removeError } = await gm.client.rpc("set_channel_members", {
      chid: channelId,
      member_ids: [],
    });
    expect(removeError).toBeNull();
    await waitFor(
      () =>
        channelsSeen.at(-1)?.includes(channelId) === false &&
        postsSeen.at(-1)?.length === 0
          ? true
          : null,
      60000
    );
    expect(await readChannelsAs(player, campaignId)).toHaveLength(2);
    expect(await readPostsAs(player, channelId)).toEqual([]);

    // New posts stop at the access rules: nothing arrives live either.
    const { error: laterError } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: channelId,
        author_id: gm.userId,
        text: "You will never read this.",
      });
    expect(laterError).toBeNull();
    const count = postsSeen.length;
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(postsSeen.length).toBe(count);
    expect(postsSeen.at(-1)).toEqual([]);
  });

  it("keeps a DM between its two people, blind even to GMs", { timeout: 180000 }, async () => {
    const { gm, player, other, bystander, outsider, campaignId } =
      await setUpCampaign();

    // Either member opens the DM; opening again returns the same channel.
    const { data: first, error: firstError } = await player.client.rpc(
      "get_or_create_dm_channel",
      { cid: campaignId, other_id: other.userId }
    );
    expect(firstError).toBeNull();
    const dmId = firstId(first);
    const { data: second, error: secondError } = await other.client.rpc(
      "get_or_create_dm_channel",
      { cid: campaignId, other_id: player.userId }
    );
    expect(secondError).toBeNull();
    expect(firstId(second)).toBe(dmId);

    // The pair reads it; a fellow member, an outsider and the GM read
    // nothing and cannot see that it exists.
    expect(
      (await readChannelsAs(player, campaignId)).find((row) => row.id === dmId)
    ).toMatchObject({ visibility: "dm" });
    expect(
      (await readChannelsAs(other, campaignId)).find((row) => row.id === dmId)
    ).toMatchObject({ visibility: "dm" });
    expect(
      (await readChannelsAs(bystander, campaignId)).find(
        (row) => row.id === dmId
      )
    ).toBeUndefined();
    expect(await readChannelsAs(outsider, campaignId)).toEqual([]);
    const gmChannels = await readChannelsAs(gm, campaignId);
    expect(gmChannels.find((row) => row.id === dmId)).toBeUndefined();
    expect(gmChannels).toHaveLength(2);

    // The GM's open channel list never learns the DM, even past reconcile.
    await signInAs(gm);
    const gmSeen: string[][] = [];
    let gmLoaded = false;
    unsubscribes.push(
      listenToCampaignChannels(
        campaignId,
        {
          onChannels: (channels) =>
            gmSeen.push(channels.map((channel) => channel.id)),
          onLoaded: () => {
            gmLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() => (gmLoaded && gmSeen.length >= 1 ? gmSeen : null));
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(gmSeen.every((window) => !window.includes(dmId))).toBe(true);

    // Posts travel between the two alone; the GM's write fails blind.
    const { error: dmPostError } = await player.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: dmId,
        author_id: player.userId,
        text: "Meet me after the moot.",
      });
    expect(dmPostError).toBeNull();
    expect(await readPostsAs(other, dmId)).toHaveLength(1);
    expect(await readPostsAs(bystander, dmId)).toEqual([]);
    expect(await readPostsAs(gm, dmId)).toEqual([]);
    const { error: gmPostError } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: dmId,
        author_id: gm.userId,
        text: "I see all.",
      });
    expect(gmPostError).not.toBeNull();
  });

  it("a removed campaign member reads no posts from a private channel or DM they were in", { timeout: 180000 }, async () => {
    const { gm, player, other, campaignId } = await setUpCampaign();
    const channelId = await createPrivateChannelAs(gm, campaignId, [
      player.userId,
    ]);
    const { data: dmData, error: dmError } = await player.client.rpc(
      "get_or_create_dm_channel",
      { cid: campaignId, other_id: other.userId }
    );
    expect(dmError).toBeNull();
    const dmId = firstId(dmData);

    const { error: privatePostError } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: channelId,
        author_id: gm.userId,
        text: "The plan, for your ears only.",
      });
    expect(privatePostError).toBeNull();
    const { error: dmPostError } = await other.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: dmId,
        author_id: other.userId,
        text: "Meet me after the moot.",
      });
    expect(dmPostError).toBeNull();
    expect(await readPostsAs(player, channelId)).toHaveLength(1);
    expect(await readPostsAs(player, dmId)).toHaveLength(1);

    // The player watches the channel list and the private feed with open
    // subscriptions while the GM acts through another client.
    await signInAs(player);
    const channelsSeen: string[][] = [];
    let channelsLoaded = false;
    unsubscribes.push(
      listenToCampaignChannels(
        campaignId,
        {
          onChannels: (channels) =>
            channelsSeen.push(channels.map((channel) => channel.id)),
          onLoaded: () => {
            channelsLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    const postsSeen: PostWithId[][] = [];
    let postsLoaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        channelId,
        30,
        {
          onPosts: (posts) => postsSeen.push(posts),
          onHasOlder: () => {},
          onLoaded: () => {
            postsLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      channelsLoaded && postsLoaded && channelsSeen.length >= 1 && postsSeen.length >= 1
        ? true
        : null
    );
    expect(channelsSeen.at(-1)).toContain(channelId);
    expect(postsSeen.at(-1)).toHaveLength(1);

    // The GM removes the player from the campaign: the open list drops
    // every channel and the open feed empties on the reconcile re-fetch,
    // because every read re-checks current membership.
    const { error: removeError } = await gm.client.rpc(
      "remove_campaign_member",
      { cid: campaignId, target_uid: player.userId }
    );
    expect(removeError).toBeNull();
    await waitFor(
      () =>
        channelsSeen.at(-1)?.length === 0 && postsSeen.at(-1)?.length === 0
          ? true
          : null,
      60000
    );
    expect(await readChannelsAs(player, campaignId)).toEqual([]);
    expect(await readPostsAs(player, channelId)).toEqual([]);
    expect(await readPostsAs(player, dmId)).toEqual([]);
    expect(
      (await readRosterAs(gm, channelId)).map((row) => row.user_id)
    ).not.toContain(player.userId);

    // New posts stop at the access rules: nothing arrives live either.
    const { error: laterPrivateError } = await gm.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: channelId,
        author_id: gm.userId,
        text: "You will never read this.",
      });
    expect(laterPrivateError).toBeNull();
    const { error: laterDmError } = await other.client
      .from(CHAT_POSTS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        channel_id: dmId,
        author_id: other.userId,
        text: "Nor this.",
      });
    expect(laterDmError).toBeNull();
    const count = postsSeen.length;
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(postsSeen.length).toBe(count);
    expect(postsSeen.at(-1)).toEqual([]);
    expect(await readPostsAs(player, channelId)).toEqual([]);
    expect(await readPostsAs(player, dmId)).toEqual([]);

    // No collateral: the other member still reads the DM and the GM still
    // reads the private channel.
    expect(await readPostsAs(other, dmId)).toHaveLength(2);
    expect(await readPostsAs(gm, channelId)).toHaveLength(2);
  });

  it("leaving the campaign clears the member's channel roster rows", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    const channelId = await createPrivateChannelAs(gm, campaignId, [
      player.userId,
    ]);
    expect(
      (await readRosterAs(gm, channelId)).map((row) => row.user_id)
    ).toContain(player.userId);

    // A member leaves by deleting their own roster row, outside the
    // remove_campaign_member function: the roster cleanup still fires.
    const { error: leaveError } = await player.client
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", player.userId);
    expect(leaveError).toBeNull();

    expect(
      (await readRosterAs(gm, channelId)).map((row) => row.user_id)
    ).not.toContain(player.userId);
    expect(await readPostsAs(player, channelId)).toEqual([]);
  });

  it("sends an outsider no membership-change events", { timeout: 120000 }, async () => {
    const { gm, player, other, outsider, campaignId } =
      await setUpCampaign();
    const channelId = await createPrivateChannelAs(gm, campaignId, [
      player.userId,
      other.userId,
    ]);

    // A raw postgres_changes probe on the roster table, as someone in no
    // campaign: before the fix, roster DELETEs skipped row-level security
    // and reached every subscriber; the probe fails loudly if it never
    // goes live so silence below is never a broken subscription.
    const received: unknown[] = [];
    const probe = outsider.client.channel(
      `campaign-channel-members:${campaignId}:probe-${Date.now()}`,
      { config: { private: true } }
    );
    probe.on(
      "postgres_changes",
      { event: "*", schema: "public", table: CHAT_CHANNEL_MEMBERS_TABLE },
      (payload) => {
        received.push(payload);
      }
    );
    const subscribed = await new Promise<boolean>((resolve) => {
      let done = false;
      probe.subscribe((status) => {
        if (!done && status === "SUBSCRIBED") {
          done = true;
          resolve(true);
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve(false);
        }
      }, 30000);
    });
    expect(subscribed).toBe(true);
    try {
      // Churn the roster twice: removing then re-adding a member.
      const { error: removeError } = await gm.client.rpc(
        "set_channel_members",
        { chid: channelId, member_ids: [player.userId] }
      );
      expect(removeError).toBeNull();
      const { error: addError } = await gm.client.rpc(
        "set_channel_members",
        { chid: channelId, member_ids: [player.userId, other.userId] }
      );
      expect(addError).toBeNull();
      // The churn provably committed: the roster reads back whole.
      expect(
        (await readRosterAs(gm, channelId)).map((row) => row.user_id).sort()
      ).toEqual([other.userId, player.userId].sort());

      await new Promise((resolve) => setTimeout(resolve, 12000));
      expect(received).toEqual([]);
    } finally {
      await outsider.client.removeChannel(probe);
    }
  });

  it("lets only GMs manage private channels but any member DM", { timeout: 120000 }, async () => {
    const { gm, player, other, bystander, outsider, campaignId } =
      await setUpCampaign();

    // A player creates no private channel and changes no roster.
    const forged = await player.client.rpc("create_private_channel", {
      cid: campaignId,
      cname: "Sneaky",
      ckind: "IC",
      member_ids: [player.userId],
    });
    expect(forged.error).not.toBeNull();
    const channelId = await createPrivateChannelAs(gm, campaignId, [
      player.userId,
    ]);
    const meddled = await other.client.rpc("set_channel_members", {
      chid: channelId,
      member_ids: [player.userId, other.userId],
    });
    expect(meddled.error).not.toBeNull();

    // A GM names no outsider to a private channel.
    const enlisted = await gm.client.rpc("set_channel_members", {
      chid: channelId,
      member_ids: [player.userId, outsider.userId],
    });
    expect(enlisted.error).not.toBeNull();

    // Any member DMs another member, but nobody DMs themselves,
    // outsiders, or strangers to the campaign.
    const { data, error } = await bystander.client.rpc(
      "get_or_create_dm_channel",
      { cid: campaignId, other_id: player.userId }
    );
    expect(error).toBeNull();
    expect(typeof firstId(data)).toBe("string");
    const self = await player.client.rpc("get_or_create_dm_channel", {
      cid: campaignId,
      other_id: player.userId,
    });
    expect(self.error).not.toBeNull();
    const stranger = await outsider.client.rpc("get_or_create_dm_channel", {
      cid: campaignId,
      other_id: player.userId,
    });
    expect(stranger.error).not.toBeNull();
    const outside = await player.client.rpc("get_or_create_dm_channel", {
      cid: campaignId,
      other_id: outsider.userId,
    });
    expect(outside.error).not.toBeNull();
  });
});
