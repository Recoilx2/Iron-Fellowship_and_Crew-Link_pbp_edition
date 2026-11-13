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

  async function setUpMembers(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    other: LivePerson;
    bystander: LivePerson;
    outsider: LivePerson;
    campaignId: string;
    icChannelId: string;
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
      campaignName: "Lantern quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    for (const member of [player, other, bystander]) {
      await signInAs(member);
      await joinCampaign({ campaignId });
      await signOut();
    }
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
      bystander,
      outsider,
      campaignId,
      icChannelId: (data as { id: string }).id,
    };
  }

  async function postImageAs(
    person: LivePerson,
    campaignId: string,
    channelId: string,
    text = "A lantern for the road."
  ): Promise<string> {
    await signInAs(person);
    const postId = crypto.randomUUID();
    const path = await uploadChatImage(campaignId, postId, png());
    await createPost({
      channelId,
      postId,
      text,
      imagePaths: [path],
    });
    await signOut();
    return path;
  }

  it("hides private-channel images from members outside the channel", { timeout: 180000 }, async () => {
    const { gm, player, bystander, campaignId } = await setUpMembers();
    const { data, error } = await gm.client.rpc("create_private_channel", {
      cid: campaignId,
      cname: "Side quest",
      ckind: "IC",
      member_ids: [player.userId],
    });
    expect(error).toBeNull();
    const channelId = (Array.isArray(data) ? data[0] : data) as string;
    const path = await postImageAs(player, campaignId, channelId);

    // A member outside the channel reads neither the bytes nor a signed URL.
    const { error: downloadError } = await bystander.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(downloadError).not.toBeNull();
    await signInAs(bystander);
    await expect(getChatImageUrl(path)).rejects.toBeTruthy();
    await signOut();

    // The channel member who posted it still reads it back.
    await signInAs(player);
    await expect(getChatImageUrl(path)).resolves.toMatch(/^https?:/);
    await signOut();
  });

  it("hides direct-message images from everyone outside the pair", { timeout: 180000 }, async () => {
    const { gm, player, other, bystander, campaignId } = await setUpMembers();
    const { data, error } = await player.client.rpc("get_or_create_dm_channel", {
      cid: campaignId,
      other_id: other.userId,
    });
    expect(error).toBeNull();
    const channelId = data as string;
    const path = await postImageAs(player, campaignId, channelId);

    // A fellow member outside the DM, and a GM who is not in it, read nothing.
    for (const stranger of [bystander, gm]) {
      const { error: downloadError } = await stranger.client.storage
        .from(CHAT_IMAGES_BUCKET)
        .download(path);
      expect(downloadError).not.toBeNull();
    }
    await signInAs(bystander);
    await expect(getChatImageUrl(path)).rejects.toBeTruthy();
    await signOut();

    // The other side of the DM reads the image.
    const { error: pairError } = await other.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(pairError).toBeNull();
  });

  it("keeps GM-only roll images from players", { timeout: 180000 }, async () => {
    const { gm, player, campaignId, icChannelId } = await setUpMembers();

    await signInAs(gm);
    const postId = crypto.randomUUID();
    const path = await uploadChatImage(campaignId, postId, png());
    await createPost({
      channelId: icChannelId,
      postId,
      text: "A secret roll.",
      imagePaths: [path],
      gmsOnly: true,
    });
    await signOut();

    // A player reads neither the bytes nor a signed URL ...
    const { error: downloadError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(downloadError).not.toBeNull();
    await signInAs(player);
    await expect(getChatImageUrl(path)).rejects.toBeTruthy();
    await signOut();

    // ... while a GM reads them back.
    const { error: gmError } = await gm.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(gmError).toBeNull();
  });

  it("lets nobody overwrite another person's image", { timeout: 120000 }, async () => {
    const { player, other, campaignId } = await setUpMembers();

    await signInAs(player);
    const path = await uploadChatImage(campaignId, crypto.randomUUID(), png());
    await signOut();

    // Another member cannot replace the file, even with upsert.
    const { error: overwriteError } = await other.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(path, png("intruder.png"), { upsert: true });
    expect(overwriteError).not.toBeNull();

    // The uploader can still replace their own file before posting.
    await signInAs(player);
    const { error: ownError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(path, png("lantern.png"), { upsert: true });
    expect(ownError).toBeNull();
    await signOut();
  });

  it("refuses non-image uploads on the server", { timeout: 120000 }, async () => {
    const { player, campaignId } = await setUpMembers();

    const evil = new File(["not an image"], "evil.pdf", {
      type: "application/pdf",
    });
    const { error } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(chatImageFilePath(campaignId, crypto.randomUUID(), "evil.pdf"), evil);
    expect(error).not.toBeNull();
  });

  it("keeps an unsent upload readable only by its uploader", { timeout: 120000 }, async () => {
    const { player, other, campaignId } = await setUpMembers();

    // The file lands before its post exists.
    await signInAs(player);
    const path = await uploadChatImage(campaignId, crypto.randomUUID(), png());
    await signOut();

    // Another member reads neither the bytes nor a signed URL ...
    const { error: downloadError } = await other.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(downloadError).not.toBeNull();
    await signInAs(other);
    await expect(getChatImageUrl(path)).rejects.toBeTruthy();
    await signOut();

    // ... while the uploader reads it back.
    const { error: ownError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(ownError).toBeNull();
  });

  it("lets a post's author or GM remove its files, but nobody else", { timeout: 180000 }, async () => {
    const { gm, player, bystander, campaignId, icChannelId } =
      await setUpMembers();
    const path = await postImageAs(player, campaignId, icChannelId);

    // A fellow member who posted nothing cannot discard the file. Storage
    // answers a policy-blocked remove with an empty file list and no error,
    // so "nothing removed" plus "the author still reads it" is the denial.
    const { data: strangerRemoved, error: strangerError } =
      await bystander.client.storage.from(CHAT_IMAGES_BUCKET).remove([path]);
    expect(strangerError).toBeNull();
    expect(strangerRemoved ?? []).toEqual([]);
    const { error: stillThereError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(stillThereError).toBeNull();

    // ... while a GM clearing the post can, and then the file is gone.
    const { error: gmError } = await gm.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .remove([path]);
    expect(gmError).toBeNull();
    const { error: goneError } = await player.client.storage
      .from(CHAT_IMAGES_BUCKET)
      .download(path);
    expect(goneError).not.toBeNull();
  });
});
