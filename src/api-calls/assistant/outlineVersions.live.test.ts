import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import { decodeOutlineContent } from "api-calls/assistant/outlineText";
import { ASSISTANT_OUTLINE_VERSIONS_TABLE } from "api-calls/assistant/_getRef";
import {
  applyOutlineRevision,
  listOutlineVersions,
  undoOutlineRevision,
} from "api-calls/assistant/outlineVersions";
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

function yjsB64(text: string): string {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

async function outlineTextAs(
  person: LivePerson,
  outlineId: string
): Promise<string | null> {
  const { data, error } = await person.client
    .from("campaign_note_contents")
    .select("content")
    .eq("note_id", outlineId);
  if (error) return null;
  const content = (data?.[0] as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? decodeOutlineContent(content) : null;
}

describe.skipIf(!config)("assistant outline versions end to end (#133)", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];

  afterEach(async () => {
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUpCampaign(): Promise<{
    gm: LivePerson;
    coGm: LivePerson;
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
    outlineId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const coGm = await createPerson(cfg, "cogm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, coGm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Versioned quest",
      campaignType: CampaignType.Coop,
    });
    const outlineId = await getOrCreateCampaignOutline({ campaignId });
    await gm.client
      .from("campaign_note_contents")
      .upsert({ note_id: outlineId, content: yjsB64("Original plan.") });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    await signInAs(coGm);
    await joinCampaign({ campaignId });
    await signOut();
    const promoted = await gm.client
      .from("campaign_members")
      .update({ role: "gm" })
      .eq("campaign_id", campaignId)
      .eq("user_id", coGm.userId)
      .select();
    expect(promoted.error).toBeNull();
    return { gm, coGm, player, outsider, campaignId, outlineId };
  }

  it("applies a revision, keeps the version and undoes it", { timeout: 120000 }, async () => {
    const { gm, campaignId, outlineId } = await setUpCampaign();
    await signInAs(gm);

    const versionId = await applyOutlineRevision({
      campaignId,
      outlineId,
      currentText: "Original plan.",
      proposedText: "Revised plan.",
    });
    expect(typeof versionId).toBe("string");

    const versions = await listOutlineVersions({ campaignId });
    expect(versions.map((version) => version.content)).toEqual([
      "Original plan.",
    ]);
    expect(await outlineTextAs(gm, outlineId)).toBe("Revised plan.");

    const restored = await undoOutlineRevision({ campaignId, outlineId });
    expect(restored).toBe("Original plan.");
    expect(await outlineTextAs(gm, outlineId)).toBe("Original plan.");
    expect(await listOutlineVersions({ campaignId })).toEqual([]);
    await signOut();
  });

  it("shares versions between co-GMs", { timeout: 120000 }, async () => {
    const { gm, coGm, campaignId, outlineId } = await setUpCampaign();
    await signInAs(gm);
    await applyOutlineRevision({
      campaignId,
      outlineId,
      currentText: "Original plan.",
      proposedText: "GM one revises.",
    });
    await signOut();

    await signInAs(coGm);
    const versions = await listOutlineVersions({ campaignId });
    expect(versions.map((version) => version.content)).toEqual([
      "Original plan.",
    ]);
    // The co-GM undoes the other GM's apply: versions are shared, like
    // the outline itself.
    expect(await undoOutlineRevision({ campaignId, outlineId })).toBe(
      "Original plan."
    );
    await signOut();
  });

  it("keeps versions from players and outsiders everywhere", { timeout: 120000 }, async () => {
    const { gm, player, outsider, campaignId, outlineId } = await setUpCampaign();
    await signInAs(gm);
    await applyOutlineRevision({
      campaignId,
      outlineId,
      currentText: "Original plan.",
      proposedText: "Revised plan.",
    });
    await signOut();

    for (const person of [player, outsider]) {
      await signInAs(person);
      expect(await listOutlineVersions({ campaignId })).toEqual([]);
      await expect(
        applyOutlineRevision({
          campaignId,
          outlineId,
          currentText: "Hijack.",
          proposedText: "Hijacked plan.",
        })
      ).rejects.toBeTruthy();
      await expect(
        undoOutlineRevision({ campaignId, outlineId })
      ).rejects.toBeTruthy();
      const direct = await person.client
        .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
        .select("id");
      expect(direct.error).toBeNull();
      expect(direct.data ?? []).toEqual([]);
      const refused = await person.client
        .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
        .insert({
          id: crypto.randomUUID(),
          campaign_id: campaignId,
          created_by: person.userId,
          content: "Smuggled.",
        });
      expect(refused.error).not.toBeNull();
      await signOut();
    }

    // The outline itself is untouched by the refused writes.
    await signInAs(gm);
    expect(await outlineTextAs(gm, outlineId)).toBe("Revised plan.");
    await signOut();
  });
});
