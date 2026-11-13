import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { createPost } from "api-calls/chat/createPost";
import { editPost } from "api-calls/chat/editPost";
import { deletePost } from "api-calls/chat/deletePost";
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

describe.skipIf(!config)("chat post edits and soft deletes", () => {
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
    outsider: LivePerson;
    icChannelId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const other = await createPerson(cfg, "other");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, other, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Editing quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    await signInAs(other);
    await joinCampaign({ campaignId });
    await signOut();
    const { data, error } = await gm.client
      .from(CHAT_CHANNELS_TABLE)
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "IC")
      .eq("is_starting", true)
      .single();
    expect(error).toBeNull();
    return {
      gm,
      player,
      other,
      outsider,
      icChannelId: (data as { id: string }).id,
    };
  }

  async function postAs(
    person: LivePerson,
    channelId: string,
    text: string
  ): Promise<string> {
    await signInAs(person);
    try {
      return await createPost({ channelId, text });
    } finally {
      await signOut();
    }
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

  it(
    "lets the author edit text and streams the edit live",
    { timeout: 180000 },
    async () => {
      const { gm, player, icChannelId } = await setUpCampaign();
      const postId = await postAs(player, icChannelId, "We push on.");

      // The author fixes a typo through the wrapper; the row is stamped.
      await signInAs(player);
      await editPost({ postId, text: "We push on through the bog." });
      const edited = await readPostsAs(player, icChannelId);
      expect(edited.find((row) => row.id === postId)).toMatchObject({
        text: "We push on through the bog.",
        deleted_at: null,
      });
      expect(
        edited.find((row) => row.id === postId)?.edited_at
      ).not.toBeNull();

      // Empty text never edits, client-side or direct, and unknown posts
      // read as not found.
      await expect(editPost({ postId, text: "   " })).rejects.toBeTruthy();
      await expect(
        editPost({ postId: "00000000-0000-0000-0000-000000000000", text: "x" })
      ).rejects.toBeTruthy();
      await signOut();

      // The GM watches the channel through the shared listener and sees
      // the edited post with its marker.
      await signInAs(gm);
      const seen: PostWithId[][] = [];
      let loaded = false;
      unsubscribes.push(
        listenToChannelPosts(
          icChannelId,
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
        )
      );
      await waitFor(() => (loaded && seen.length >= 1 ? seen : null));
      expect(seen.at(-1)?.[0]).toMatchObject({
        id: postId,
        text: "We push on through the bog.",
        deletedAt: null,
      });
      expect(seen.at(-1)?.[0]?.editedAt).not.toBeNull();

      // A second fix arrives live as an UPDATE, unstamping nothing.
      const { error } = await player.client
        .from(CHAT_POSTS_TABLE)
        .update({ text: "We push on through the bog, quietly." })
        .eq("id", postId);
      expect(error).toBeNull();
      await waitFor(() =>
        seen.at(-1)?.[0]?.text === "We push on through the bog, quietly."
          ? seen
          : null
      );
      expect(seen.at(-1)?.[0]?.editedAt).not.toBeNull();
      expect(seen.at(-1)?.[0]?.deletedAt).toBeNull();
    }
  );

  it("refuses edits from anyone but the author", { timeout: 120000 }, async () => {
    const { gm, player, other, outsider, icChannelId } = await setUpCampaign();
    const postId = await postAs(player, icChannelId, "The lantern is lit.");

    // A fellow player reaches the row but changes nothing: the UPDATE
    // matches no policy row or the trigger refuses it.
    const hijack = await other.client
      .from(CHAT_POSTS_TABLE)
      .update({ text: "Hijacked." })
      .eq("id", postId)
      .select("id");
    if (!hijack.error) {
      expect(hijack.data ?? []).toEqual([]);
    }
    await signInAs(other);
    await expect(
      editPost({ postId, text: "Hijacked." })
    ).rejects.toBeTruthy();
    await signOut();

    // An outsider reaches nothing at all.
    const sneak = await outsider.client
      .from(CHAT_POSTS_TABLE)
      .update({ text: "Sneaky edit." })
      .eq("id", postId)
      .select("id");
    if (!sneak.error) {
      expect(sneak.data ?? []).toEqual([]);
    }

    // Even the GM may not rewrite another member's text: their UPDATE
    // policy reaches the row, and the trigger refuses the edit.
    const gmRewrite = await gm.client
      .from(CHAT_POSTS_TABLE)
      .update({ text: "GM rewrite." })
      .eq("id", postId)
      .select("id");
    expect(gmRewrite.error).not.toBeNull();

    // The post stands exactly as the author wrote it, unstamped.
    const reread = await readPostsAs(player, icChannelId);
    expect(reread.find((row) => row.id === postId)).toMatchObject({
      text: "The lantern is lit.",
      edited_at: null,
      deleted_at: null,
    });
  });

  it(
    "soft-deletes with a marker and streams the delete live",
    { timeout: 180000 },
    async () => {
      const { gm, player, other, outsider, icChannelId } =
        await setUpCampaign();
      const postId = await postAs(
        player,
        icChannelId,
        "Take that back immediately."
      );

      await signInAs(gm);
      const seen: PostWithId[][] = [];
      let loaded = false;
      unsubscribes.push(
        listenToChannelPosts(
          icChannelId,
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
        )
      );
      await waitFor(() => (loaded && seen.length >= 1 ? seen : null));
      expect(seen.at(-1)).toHaveLength(1);

      // The author takes it back: the row stays with cleared content and a
      // marker, and the delete arrives live as an UPDATE.
      const cleared = await player.client
        .from(CHAT_POSTS_TABLE)
        .update({ text: "", deleted_at: new Date().toISOString() })
        .eq("id", postId)
        .select("id");
      expect(cleared.error).toBeNull();
      await waitFor(() =>
        seen.at(-1)?.[0]?.deletedAt != null ? seen : null
      );
      expect(seen.at(-1)?.[0]).toMatchObject({ id: postId, text: "" });
      expect(seen.at(-1)?.[0]?.deletedAt).not.toBeNull();
      const reread = await readPostsAs(player, icChannelId);
      expect(reread).toHaveLength(1);
      expect(reread[0]).toMatchObject({ id: postId, text: "" });
      expect(reread[0]?.deleted_at).not.toBeNull();

      // A deleted post is final: no edits, no undeletes.
      const resurrect = await player.client
        .from(CHAT_POSTS_TABLE)
        .update({ text: "It lives again." })
        .eq("id", postId)
        .select("id");
      expect(resurrect.error).not.toBeNull();

      // Nobody hard-deletes: SQL DELETE fails closed for the author, a
      // fellow player, the GM and outsiders alike.
      for (const person of [player, other, gm, outsider]) {
        const hard = await person.client
          .from(CHAT_POSTS_TABLE)
          .delete()
          .eq("id", postId);
        expect(hard.error).not.toBeNull();
      }
      expect(await readPostsAs(player, icChannelId)).toHaveLength(1);
    }
  );

  it("lets the author or a GM delete, and nobody else", { timeout: 120000 }, async () => {
    const { gm, player, other, outsider, icChannelId } =
      await setUpCampaign();
    const ownId = await postAs(player, icChannelId, "Mine to take back.");

    // A fellow player and an outsider delete nothing.
    await signInAs(other);
    await expect(deletePost({ postId: ownId })).rejects.toBeTruthy();
    await signOut();
    await signInAs(outsider);
    await expect(deletePost({ postId: ownId })).rejects.toBeTruthy();
    await signOut();
    expect(await readPostsAs(player, icChannelId)).toHaveLength(1);

    // The author deletes their own post through the wrapper.
    await signInAs(player);
    await deletePost({ postId: ownId });
    await signOut();
    const reread = await readPostsAs(player, icChannelId);
    expect(reread.find((row) => row.id === ownId)).toMatchObject({ text: "" });
    expect(
      reread.find((row) => row.id === ownId)?.deleted_at
    ).not.toBeNull();

    // A GM deletes any post in their campaign, including another
    // member's, and the row stays as a marker.
    const theirsId = await postAs(player, icChannelId, "Needs moderation.");
    await signInAs(gm);
    await deletePost({ postId: theirsId });
    await signOut();
    const moderated = await readPostsAs(player, icChannelId);
    expect(
      moderated.find((row) => row.id === theirsId)?.deleted_at
    ).not.toBeNull();
    expect(
      moderated.find((row) => row.id === theirsId)
    ).toMatchObject({ text: "" });
  });
});
