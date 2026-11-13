import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { CHAT_POSTS_TABLE, type PostRow } from "api-calls/chat/_postRef";
import { createPost } from "api-calls/chat/createPost";
import {
  CHAT_IMAGES_BUCKET,
  chatImageFilePath,
  getChatImageUrl,
  removeChatImage,
  uploadChatImage,
} from "api-calls/chat/chatImages";
import { validateChatImageFile } from "api-calls/chat/chatImageLimits";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
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

function png(name = "lantern.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, {
    type: "image/png",
  });
}

describe.skipIf(!config)("chat images end to end", () => {
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
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
    icChannelId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Image quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
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
      player,
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

  it("attaches an image to a post members can read back", { timeout: 120000 }, async () => {
    const { player, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    // The upload lands under the pending post id before the post exists.
    await signInAs(player);
    const postId = crypto.randomUUID();
    const path = await uploadChatImage(campaignId, postId, png());
    expect(path).toBe(chatImageFilePath(campaignId, postId, "lantern.png"));

    // Image-only posts carry no text, only attachments.
    await createPost({
      channelId: icChannelId,
      postId,
      text: "   ",
      speakerCharacterId: kira,
      imagePaths: [path],
    });
    const { data: rows, error: readError } = await player.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("channel_id", icChannelId);
    expect(readError).toBeNull();
    expect((rows as unknown as PostRow[]).find((row) => row.id === postId))
      .toMatchObject({ image_paths: [path] });

    // Members load the bytes and mint signed URLs for the feed.
    const { data: bytes, error: downloadError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(downloadError).toBeNull();
    expect(bytes).not.toBeNull();
    await expect(getChatImageUrl(path)).resolves.toMatch(/^https?:/);

    // Removing the attachment discards its upload.
    await removeChatImage(path);
    const reread = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(reread.error).not.toBeNull();
  });

  it("keeps outsiders from reading a campaign's chat images", { timeout: 120000 }, async () => {
    const { player, outsider, campaignId, icChannelId } = await setUpCampaign();
    const kira = await createCharacterAs(player, campaignId, "Kira Vey");

    await signInAs(player);
    const postId = crypto.randomUUID();
    const path = await uploadChatImage(campaignId, postId, png());
    await createPost({
      channelId: icChannelId,
      postId,
      text: "A map for the road.",
      speakerCharacterId: kira,
      imagePaths: [path],
    });

    // An outsider reads neither the post rows nor the stored bytes.
    const { data: rows, error: readError } = await outsider.client
      .from(CHAT_POSTS_TABLE)
      .select("*")
      .eq("channel_id", icChannelId);
    expect(readError).toBeNull();
    expect(rows).toEqual([]);
    const { error: downloadError } = await outsider.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(downloadError).not.toBeNull();

    // ... and cannot mint signed URLs either.
    await signOut();
    await signInAs(outsider);
    await expect(getChatImageUrl(path)).rejects.toBeTruthy();

    // ... nor upload into the campaign's folder.
    const { error: uploadError } = await outsider.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(chatImageFilePath(campaignId, crypto.randomUUID(), "sneaky.png"), png("sneaky.png"));
    expect(uploadError).not.toBeNull();
  });

  it("fails closed on malformed paths and oversized picks", { timeout: 60000 }, async () => {
    const { player } = await setUpCampaign();

    // Paths outside any campaign folder read as nothing, even for members.
    await signInAs(player);
    const { error: malformedError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download("no-campaign-here/post-1/lantern.png");
    expect(malformedError).not.toBeNull();

    // Oversized picks are refused before any upload starts.
    const big = png("huge.png");
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    expect(validateChatImageFile(big)).toMatch(/10 MB/);
    await expect(
      uploadChatImage(crypto.randomUUID(), crypto.randomUUID(), big)
    ).rejects.toThrow(/10 MB/);
  });
});
