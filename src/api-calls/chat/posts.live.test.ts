import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { createChannel } from "api-calls/chat/createChannel";
import { archiveChannel } from "api-calls/chat/archiveChannel";
import { createPost } from "api-calls/chat/createPost";
import {
  CHAT_POST_PAGE_SIZE,
  listenToChannelPosts,
  type PostWithId,
} from "api-calls/chat/listenToChannelPosts";
import { fetchOlderChannelPosts } from "api-calls/chat/fetchOlderChannelPosts";
import { createWorld } from "api-calls/world/createWorld";
import { updateCampaignWorld } from "api-calls/campaign/updateCampaignWorld";
import { createNPC } from "api-calls/world/npcs/createNPC";
import { ROLL_RESULT, ROLL_TYPE, type Roll } from "types/DieRolls.type";
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

describe.skipIf(!config)("chat text posts end to end", () => {
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
    campaignId: string;
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
      campaignName: "Posting quest",
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
      campaignId,
      icChannelId: (data as { id: string }).id,
    };
  }

  async function createCharacterAs(
    person: LivePerson,
    campaignId: string,
    name: string
  ): Promise<string> {
    // The id is generated here so the insert needs no RETURNING clause: the
    // characters SELECT policy re-queries its own table, which cannot see a
    // just-inserted row in the same statement, so insert-then-select always
    // fails RLS (#69). The plain INSERT policy compares owner_id directly
    // and accepts the row.
    const id = crypto.randomUUID();
    const { error } = await person.client.from("characters").insert({
      id,
      owner_id: person.userId,
      name,
      campaign_id: campaignId,
    });
    expect(error).toBeNull();
    return id;
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

  it("posts text as the author's campaign character or as self", { timeout: 90000 }, async () => {
    const { player, other, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");
    await createCharacterAs(other, campaignId, "Brannoc");

    // The player posts in character as their own campaign character.
    await signInAs(player);
    const postId = await createPost({
      channelId: icChannelId,
      text: "  We push on through the bog.  ",
      speakerCharacterId: kira,
    });
    const posts = await readPostsAs(player, icChannelId);
    expect(posts.find((row) => row.id === postId)).toMatchObject({
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "We push on through the bog.",
    });

    // Posting as self (out of character) names no speaker.
    const oocId = await createPost({
      channelId: icChannelId,
      text: "brb, kettle",
    });
    const reread = await readPostsAs(player, icChannelId);
    expect(reread.find((row) => row.id === oocId)).toMatchObject({
      author_id: player.userId,
      speaker_character_id: null,
      text: "brb, kettle",
    });

    // Empty text never posts, client-side or direct.
    await expect(
      createPost({ channelId: icChannelId, text: "   " })
    ).rejects.toBeTruthy();
    const empty = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      text: "   ",
    });
    expect(empty.error).not.toBeNull();
  });

  it("refuses speakers outside the author's campaign", { timeout: 90000 }, async () => {
    const { gm, player, other, campaignId, icChannelId } =
      await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");
    const brannoc = await createCharacterAs(other, campaignId, "Brannoc");

    // The player's own character posts; anyone else's is refused.
    await signInAs(player);
    await createPost({
      channelId: icChannelId,
      text: "Kira reporting in.",
      speakerCharacterId: kira,
    });
    await expect(
      createPost({
        channelId: icChannelId,
        text: "Speaking as Brannoc",
        speakerCharacterId: brannoc,
      })
    ).rejects.toBeTruthy();
    const forged = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: brannoc,
      text: "Speaking as Brannoc",
    });
    expect(forged.error).not.toBeNull();

    // A character from another campaign is no speaker either.
    await signOut();
    await signInAs(gm);
    const elsewhereId = await createCampaign({
      uid: gm.userId,
      campaignName: "Elsewhere",
      campaignType: CampaignType.Coop,
    });
    const stray = await createCharacterAs(gm, elsewhereId, "Drifter");
    const strayPost = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: stray,
      text: "Speaking as a drifter",
    });
    expect(strayPost.error).not.toBeNull();
    expect(await readPostsAs(player, icChannelId)).toHaveLength(1);
  });

  it("refuses in-character posts as an inactive character but keeps their history", { timeout: 120000 }, async () => {
    const { player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // The player posts in character while Kira is active.
    await signInAs(player);
    const postId = await createPost({
      channelId: icChannelId,
      text: "Kira reporting in.",
      speakerCharacterId: kira,
    });

    // Retiring Kira closes the in-character voice: posting as her is
    // refused through the call and direct, while posting as self stays
    // open for out-of-character play.
    const { error: retireError } = await player.client.rpc(
      "set_campaign_character_active",
      { char_id: kira, make_active: false }
    );
    expect(retireError).toBeNull();
    await expect(
      createPost({
        channelId: icChannelId,
        text: "Kira from the sidelines",
        speakerCharacterId: kira,
      })
    ).rejects.toMatchObject({ code: "42501" });
    const forged = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "Kira from the sidelines",
    });
    expect(forged.error?.code, "forged inactive speaker").toBe("42501");
    const oocId = await createPost({
      channelId: icChannelId,
      text: "Kira is benched, brb",
    });
    expect(oocId).toBeTruthy();

    // The earlier post keeps Kira as its speaker with her name and
    // portrait beside it: retiring changes no history.
    const posts = await readPostsAs(player, icChannelId);
    expect(posts.find((row) => row.id === postId)).toMatchObject({
      speaker_character_id: kira,
      text: "Kira reporting in.",
    });

    // Reactivating Kira reopens the voice.
    const { error: reactivateError } = await player.client.rpc(
      "set_campaign_character_active",
      { char_id: kira, make_active: true }
    );
    expect(reactivateError).toBeNull();
    await createPost({
      channelId: icChannelId,
      text: "Kira is back.",
      speakerCharacterId: kira,
    });
    expect(await readPostsAs(player, icChannelId)).toHaveLength(3);
  });

  it("refuses rolls posted as an inactive character", { timeout: 120000 }, async () => {
    const { player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    const roll: Roll = {
      type: ROLL_TYPE.STAT,
      rollLabel: "Edge",
      moveName: "Face Danger",
      action: 2,
      challenge1: 3,
      challenge2: 8,
      result: ROLL_RESULT.MISS,
      timestamp: new Date(),
      characterId: kira,
      uid: player.userId,
      gmsOnly: false,
    };

    // While Kira is active, her roll posts fine.
    await signInAs(player);
    await createPost({
      channelId: icChannelId,
      text: "Kira strikes.",
      speakerCharacterId: kira,
      roll,
    });

    // Retiring Kira closes the roll voice too: the speaker check binds
    // new posts and rolls to the active character, so both the call and
    // a direct insert are refused with a privilege error.
    const { error: retireError } = await player.client.rpc(
      "set_campaign_character_active",
      { char_id: kira, make_active: false }
    );
    expect(retireError).toBeNull();
    await expect(
      createPost({
        channelId: icChannelId,
        text: "Kira from the sidelines.",
        speakerCharacterId: kira,
        roll,
      })
    ).rejects.toMatchObject({ code: "42501" });
    const forged = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "Kira from the sidelines.",
      roll: roll as unknown as Record<string, unknown>,
    });
    expect(forged.error?.code, "forged inactive roll").toBe("42501");
    await signOut();
  });

  it("refuses a burn carried by a new post as an inactive character", { timeout: 120000 }, async () => {
    const { player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // A composer send stamps the burn onto the roll before posting: 5
    // beats 3 but not 8, so a miss becomes a weak hit.
    const burned: Roll = {
      type: ROLL_TYPE.STAT,
      rollLabel: "Edge",
      moveName: "Face Danger",
      action: 2,
      challenge1: 3,
      challenge2: 8,
      result: ROLL_RESULT.WEAK_HIT,
      momentumBurned: 5,
      timestamp: new Date(),
      characterId: kira,
      uid: player.userId,
      gmsOnly: false,
    };

    // Retiring Kira first: the insert burn check fires before the row
    // lands, so the send is refused as a retired character's burn.
    const { error: retireError } = await player.client.rpc(
      "set_campaign_character_active",
      { char_id: kira, make_active: false }
    );
    expect(retireError).toBeNull();
    await signInAs(player);
    await expect(
      createPost({
        channelId: icChannelId,
        text: "Kira strikes.",
        speakerCharacterId: kira,
        roll: burned,
      })
    ).rejects.toThrow(/active character/);
    await signOut();
  });

  it("keeps outsiders from reading or posting", { timeout: 90000 }, async () => {
    const { player, outsider, campaignId, icChannelId } =
      await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    await signInAs(player);
    await createPost({
      channelId: icChannelId,
      text: "The lantern is still lit.",
      speakerCharacterId: kira,
    });

    // An outsider reads nothing and writes nothing.
    expect(await readPostsAs(outsider, icChannelId)).toEqual([]);
    await signOut();
    await signInAs(outsider);
    await expect(
      createPost({ channelId: icChannelId, text: "Sneaky post" })
    ).rejects.toBeTruthy();
    const direct = await outsider.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: outsider.userId,
      text: "Sneaky post",
    });
    expect(direct.error).not.toBeNull();
  });

  it("streams new posts live to members but never to outsiders", { timeout: 180000 }, async () => {
    const { gm, player, outsider, campaignId, icChannelId } =
      await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");
    void outsider;

    // The singleton client stays signed in as the GM while members act
    // through their own clients, so the live subscription never re-auths.
    await signInAs(gm);
    const seen: PostWithId[][] = [];
    let loaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        icChannelId,
        CHAT_POST_PAGE_SIZE,
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
    expect(seen.at(-1)).toEqual([]);

    // A post the player writes arrives with its speaker, oldest-first.
    const { error } = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "Kira answers before anyone can stop her.",
    });
    expect(error).toBeNull();
    await waitFor(() => (seen.at(-1)?.length === 1 ? seen : null));
    expect(seen.at(-1)?.[0]).toMatchObject({
      channelId: icChannelId,
      authorId: player.userId,
      speakerCharacterId: kira,
      text: "Kira answers before anyone can stop her.",
    });
  });

  it("withholds live posts from outsiders past the reconcile tick", { timeout: 180000 }, async () => {
    const { player, outsider, campaignId, icChannelId } =
      await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // The outsider subscribes and loads nothing. The channel-shared join
    // is denied by policy; collect that expected error instead of throwing
    // inside the callback (which surfaces as an unhandled rejection).
    await signInAs(outsider);
    const seen: PostWithId[][] = [];
    const denied: unknown[] = [];
    let loaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        icChannelId,
        CHAT_POST_PAGE_SIZE,
        {
          onPosts: (posts) => seen.push(posts),
          onHasOlder: () => {},
          onLoaded: () => {
            loaded = true;
          },
        },
        (error) => {
          denied.push(error);
        }
      )
    );
    await waitFor(() => (loaded && seen.length >= 1 ? seen : null));
    expect(seen.at(-1)).toEqual([]);

    // A member posts; the outsider's listener stays empty past the
    // reconcile re-fetch that would heal a dropped event.
    const { error } = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_character_id: kira,
      text: "You will never read this.",
    });
    expect(error).toBeNull();
    await waitFor(
      async () =>
        (await readPostsAs(player, icChannelId)).length === 1
          ? true
          : null,
      30000
    );
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(seen.every((window) => window.length === 0)).toBe(true);
    expect(denied.length).toBeGreaterThan(0);
  });

  it("pages older posts in on scroll", { timeout: 120000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // A long channel: forty posts a minute apart, so the order is fixed.
    const base = Date.now() - 40 * 60_000;
    const texts = Array.from(
      { length: 40 },
      (_, i) => `post-${String(i).padStart(2, "0")}`
    );
    const { error } = await player.client.from(CHAT_POSTS_TABLE).insert(
      texts.map((text, i) => ({
        id: crypto.randomUUID(),
        channel_id: icChannelId,
        author_id: player.userId,
        speaker_character_id: kira,
        text,
        created_at: new Date(base + i * 60_000).toISOString(),
      }))
    );
    expect(error).toBeNull();

    await signInAs(gm);

    // The latest page loads first, oldest-first within the window.
    const first: PostWithId[][] = [];
    const olderFlags: boolean[] = [];
    let firstLoaded = false;
    const stopFirst = listenToChannelPosts(
      icChannelId,
      10,
      {
        onPosts: (posts) => first.push(posts),
        onHasOlder: (hasOlder) => olderFlags.push(hasOlder),
        onLoaded: () => {
          firstLoaded = true;
        },
      },
      (error) => {
        throw error;
      }
    );
    await waitFor(() => (firstLoaded && first.length >= 1 ? first : null));
    expect(first.at(-1)?.map((post) => post.text)).toEqual(texts.slice(30));
    expect(olderFlags.at(-1)).toBe(true);
    stopFirst();

    // Paging back grows the window to the whole channel.
    const full: PostWithId[][] = [];
    const fullOlder: boolean[] = [];
    let fullLoaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        icChannelId,
        40,
        {
          onPosts: (posts) => full.push(posts),
          onHasOlder: (hasOlder) => fullOlder.push(hasOlder),
          onLoaded: () => {
            fullLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      fullLoaded && (full.at(-1)?.length ?? 0) >= 40 ? full : null
    );
    expect(full.at(-1)?.map((post) => post.text)).toEqual(texts);
    expect(fullOlder.at(-1)).toBe(false);
  });

  it("pages older posts back to the channel's first post", { timeout: 120000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // A long channel: forty posts a minute apart, so the order is fixed.
    const base = Date.now() - 40 * 60_000;
    const texts = Array.from(
      { length: 40 },
      (_, i) => `page-${String(i).padStart(2, "0")}`
    );
    const { error } = await player.client.from(CHAT_POSTS_TABLE).insert(
      texts.map((text, i) => ({
        id: crypto.randomUUID(),
        channel_id: icChannelId,
        author_id: player.userId,
        speaker_character_id: kira,
        text,
        created_at: new Date(base + i * 60_000).toISOString(),
      }))
    );
    expect(error).toBeNull();

    await signInAs(gm);

    // The live subscription stays on its latest page while the one-off
    // pages walk back past it, one window at a time.
    const first: PostWithId[][] = [];
    let firstLoaded = false;
    unsubscribes.push(
      listenToChannelPosts(
        icChannelId,
        10,
        {
          onPosts: (posts) => first.push(posts),
          onHasOlder: () => {},
          onLoaded: () => {
            firstLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() => (firstLoaded && first.length >= 1 ? first : null));
    const live = first.at(-1) ?? [];
    expect(live.map((post) => post.text)).toEqual(texts.slice(30));

    const older: PostWithId[] = [...live];
    let hasOlder = true;
    while (hasOlder) {
      const oldest = older[0];
      const page = await fetchOlderChannelPosts(
        icChannelId,
        { createdAt: oldest.createdAt, id: oldest.id },
        10
      );
      older.unshift(...page.posts);
      hasOlder = page.hasOlder;
    }
    expect(older.map((post) => post.text)).toEqual(texts);
  });

  it("lets a campaign GM post as an NPC of the campaign's world", { timeout: 90000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    await signInAs(gm);
    const worldId = await createWorld({ name: "Bog realm" });
    await updateCampaignWorld({ campaignId, gmIds: [], worldId });
    const elderId = await createNPC({ worldId, npc: { name: "Elder Moss" } });

    // The GM speaks as the NPC: no character voice beside it.
    const postId = await createPost({
      channelId: icChannelId,
      text: "The bog remembers.",
      speakerNpcId: elderId,
    });
    expect(await readPostsAs(gm, icChannelId)).toContainEqual(
      expect.objectContaining({
        id: postId,
        channel_id: icChannelId,
        author_id: gm.userId,
        speaker_character_id: null,
        speaker_npc_id: elderId,
        text: "The bog remembers.",
      })
    );

    // The GM's NPC voice reaches every member of the campaign.
    expect(await readPostsAs(player, icChannelId)).toHaveLength(1);
  });

  it("refuses NPC voices to players and to NPCs outside the campaign's world", { timeout: 90000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    await signInAs(gm);
    const worldId = await createWorld({ name: "Bog realm" });
    const elderId = await createNPC({ worldId, npc: { name: "Elder Moss" } });

    // With no world on the campaign, even the GM has no NPC voice.
    await expect(
      createPost({
        channelId: icChannelId,
        text: "The bog remembers.",
        speakerNpcId: elderId,
      })
    ).rejects.toBeTruthy();

    await updateCampaignWorld({ campaignId, gmIds: [], worldId });
    await signOut();

    // A player never speaks as an NPC, through the call or direct.
    await signInAs(player);
    await expect(
      createPost({
        channelId: icChannelId,
        text: "I am the elder",
        speakerNpcId: elderId,
      })
    ).rejects.toBeTruthy();
    const forged = await player.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: player.userId,
      speaker_npc_id: elderId,
      text: "I am the elder",
    });
    expect(forged.error).not.toBeNull();
    await signOut();

    // A GM never speaks as an NPC from another world.
    await signInAs(gm);
    const elsewhereId = await createWorld({ name: "Elsewhere" });
    const strayId = await createNPC({
      worldId: elsewhereId,
      npc: { name: "Drifter" },
    });
    await expect(
      createPost({
        channelId: icChannelId,
        text: "A drifter speaks",
        speakerNpcId: strayId,
      })
    ).rejects.toBeTruthy();

    // One voice per post: never a character and an NPC together.
    const kira = await createCharacterAs(gm, campaignId, "Kira Vey");
    const dual = await gm.client.from(CHAT_POSTS_TABLE).insert({
      id: crypto.randomUUID(),
      channel_id: icChannelId,
      author_id: gm.userId,
      speaker_character_id: kira,
      speaker_npc_id: elderId,
      text: "Two voices at once",
    });
    expect(dual.error).not.toBeNull();

    expect(await readPostsAs(player, icChannelId)).toEqual([]);
  });

  it("refuses posts into archived channels", { timeout: 90000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpCampaign();
    void icChannelId;
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    await signInAs(gm);
    const sideId = await createChannel({
      campaignId,
      name: "Side scene",
      kind: "IC",
    });
    await archiveChannel({ channelId: sideId, archived: true });

    await signOut();
    await signInAs(player);
    await expect(
      createPost({
        channelId: sideId,
        text: "Posting into the archive",
        speakerCharacterId: kira,
      })
    ).rejects.toBeTruthy();
    expect(await readPostsAs(player, sideId)).toEqual([]);
  });

  it("never streams a GM-only post or its delete id to a player", { timeout: 180000 }, async () => {
    const { gm, player, icChannelId } = await setUpCampaign();
    const gmSeen: PostWithId[][] = [];
    const playerSeen: PostWithId[][] = [];
    const watch = (seen: PostWithId[][], client: typeof gm.client, isGM: boolean) =>
      listenToChannelPosts(
        icChannelId,
        CHAT_POST_PAGE_SIZE,
        {
          onPosts: (posts) => seen.push(posts),
          onHasOlder: () => {},
          onLoaded: () => {},
        },
        (error) => {
          throw error;
        },
        { client, isGM }
      );

    // Both listeners stay open at once: they use their own signed-in
    // clients, so neither has to share the singleton session.
    unsubscribes.push(
      watch(gmSeen, gm.client, true),
      watch(playerSeen, player.client, false)
    );
    await waitFor(() =>
      gmSeen.length > 0 && playerSeen.length > 0 ? true : null
    );

    const secretId = crypto.randomUUID();
    const inserted = await gm.client.from(CHAT_POSTS_TABLE).insert({
      id: secretId,
      channel_id: icChannelId,
      author_id: gm.userId,
      gms_only: true,
      text: "GM-only war room note",
    });
    expect(inserted.error).toBeNull();
    await waitFor(() =>
      gmSeen.at(-1)?.some((post) => post.id === secretId) ? gmSeen : null
    );

    // The player is on the same channel-shared topic, so the trigger's
    // broadcast reaches the socket; only the client filter keeps the row
    // out of the feed. Wait past the reconcile tick as well.
    await new Promise((resolve) => setTimeout(resolve, 12000));
    expect(
      playerSeen.some((window) => window.some((post) => post.id === secretId))
    ).toBe(false);

    // chat_posts has no hard DELETE policy: posts are soft-deleted by
    // clearing their text and stamping deleted_at.
    const deletedAt = new Date().toISOString();
    const softDeleted = await gm.client
      .from(CHAT_POSTS_TABLE)
      .update({ text: "", deleted_at: deletedAt })
      .eq("id", secretId);
    expect(softDeleted.error).toBeNull();
    await waitFor(() =>
      gmSeen.at(-1)?.some(
        (post) => post.id === secretId && post.deletedAt != null
      )
        ? gmSeen
        : null
    );
    expect(
      playerSeen.some((window) => window.some((post) => post.id === secretId))
    ).toBe(false);
  });
});
