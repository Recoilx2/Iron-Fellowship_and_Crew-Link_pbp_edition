import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCharacter } from "api-calls/character/createCharacter";
import { updateCharacter } from "api-calls/character/updateCharacter";
import { updateCharacterPortrait } from "api-calls/character/updateCharacterPortrait";
import { removeCharacterPortrait } from "api-calls/character/removeCharacterPortrait";
import { getCharacterPortraitUrl } from "api-calls/character/getCharacterPortrait";
import { getCharacterForExport } from "api-calls/character/getCharacterForExport";
import {
  portraitFilePath,
  PORTRAITS_BUCKET,
} from "api-calls/character/portraitStorage";
import {
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

// A tiny valid PNG; node has no image decoders, so the browser shrink falls
// back to the original file on the way up.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tinyPortrait(name: string): File {
  const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
}

describe.skipIf(!config)("character portraits end to end", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];

  afterEach(async () => {
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  it("uploads, serves and removes a portrait", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    await signInAs(owner);
    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Portrait",
      stats: {},
      assets: [],
    });

    await updateCharacterPortrait({
      uid: owner.userId,
      characterId,
      portrait: tinyPortrait("portrait.png"),
      scale: 1,
      position: { x: 0, y: 0 },
    });

    const stored = await waitFor(async () => {
      const exported = await getCharacterForExport(characterId);
      return exported?.data.profileImage?.filename === "portrait.png"
        ? exported
        : null;
    });
    expect(stored?.data.profileImage).toMatchObject({
      filename: "portrait.png",
      scale: 1,
    });

    const url = await getCharacterPortraitUrl({
      uid: owner.userId,
      characterId,
      filename: "portrait.png",
    });
    expect(url).toMatch(/^https?:/);
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    await response.arrayBuffer();

    await removeCharacterPortrait({
      uid: owner.userId,
      characterId,
      oldPortraitFilename: "portrait.png",
    });
    const cleared = await waitFor(async () => {
      const exported = await getCharacterForExport(characterId);
      return exported && !exported.data.profileImage ? exported : null;
    });
    expect(cleared?.data.profileImage).toBeUndefined();

    const reread = await owner.client.storage
      .from(PORTRAITS_BUCKET)
      .download(portraitFilePath(owner.userId, characterId, "portrait.png"));
    expect(reread.error).not.toBeNull();
  });

  it("opens portraits to campaign members and nobody else", { timeout: 90000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const member = await createPerson(cfg, "member");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, member, outsider);
    const campaignId = randomCampaignId();
    await ensureCampaign(cfg, campaignId);
    await grantMembership(cfg, campaignId, member.userId, "player");

    await signInAs(owner);
    const characterId = await createCharacter({
      uid: owner.userId,
      name: "Shared portrait",
      stats: {},
      assets: [],
    });
    await updateCharacter({ characterId, character: { campaignId } });
    await updateCharacterPortrait({
      uid: owner.userId,
      characterId,
      portrait: tinyPortrait("shared.png"),
      scale: 1,
      position: { x: 0, y: 0 },
    });
    const path = portraitFilePath(owner.userId, characterId, "shared.png");

    const memberDownload = await member.client.storage
      .from(PORTRAITS_BUCKET)
      .download(path);
    expect(memberDownload.error).toBeNull();

    const outsiderDownload = await outsider.client.storage
      .from(PORTRAITS_BUCKET)
      .download(path);
    expect(outsiderDownload.error).not.toBeNull();

    // An outsider cannot overwrite the owner's portrait or read it by URL.
    await signOut();
    await signInAs(outsider);
    await expect(
      updateCharacterPortrait({
        uid: owner.userId,
        characterId,
        oldPortraitFilename: "shared.png",
        portrait: tinyPortrait("shared.png"),
        scale: 1,
        position: { x: 0, y: 0 },
      })
    ).rejects.toBeTruthy();
    await expect(
      getCharacterPortraitUrl({
        uid: owner.userId,
        characterId,
        filename: "shared.png",
      })
    ).rejects.toBeTruthy();
  });
});
