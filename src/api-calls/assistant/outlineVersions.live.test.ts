import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import {
  decodeOutlineContent,
  readOutlineFromDoc,
  replaceOutlineInDoc,
} from "api-calls/assistant/outlineText";
import { getCampaignNoteDocumentName } from "config/hocuspocus.config";
import { ASSISTANT_OUTLINE_VERSIONS_TABLE } from "api-calls/assistant/_getRef";
import {
  applyOutlineRevision,
  listOutlineVersions,
  OutlineVersionGoneError,
  undoOutlineRevision,
} from "api-calls/assistant/outlineVersions";
import { createConversation } from "api-calls/assistant/createConversation";
import { addAssistantMessage } from "api-calls/assistant/addAssistantMessage";
import { saveProposalState } from "api-calls/assistant/saveProposalState";
import { ASSISTANT_MESSAGES_TABLE } from "api-calls/assistant/_getRef";
import {
  createPerson,
  deletePerson,
  hocuspocusUrl,
  liveStackConfig,
  personToken,
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

/** Waits until the stored outline reads as `expected` (the server persists on a debounce). */
async function storedOutlineBecomes(
  person: LivePerson,
  outlineId: string,
  expected: string
): Promise<string> {
  return waitFor(async () => {
    const text = await outlineTextAs(person, outlineId);
    return text === expected ? text : null;
  }, 30000);
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
    await storedOutlineBecomes(gm, outlineId, "Revised plan.");

    const restored = await undoOutlineRevision({
      campaignId,
      outlineId,
      versionId: versionId as string,
    });
    expect(restored).toBe("Original plan.");
    await storedOutlineBecomes(gm, outlineId, "Original plan.");
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
    expect(
      await undoOutlineRevision({
        campaignId,
        outlineId,
        versionId: versions[0].id,
      })
    ).toBe("Original plan.");
    await signOut();
  });

  it("keeps versions from players and outsiders everywhere", { timeout: 120000 }, async () => {
    const { gm, player, outsider, campaignId, outlineId } = await setUpCampaign();
    await signInAs(gm);
    const keptId = (await applyOutlineRevision({
      campaignId,
      outlineId,
      currentText: "Original plan.",
      proposedText: "Revised plan.",
    })) as string;
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
        undoOutlineRevision({ campaignId, outlineId, versionId: keptId })
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
    await storedOutlineBecomes(gm, outlineId, "Revised plan.");
    await signOut();
  });

  /**
   * Regression for #147: a co-GM holds the outline open through the note
   * server while the other GM applies from the Chat tab. The note server
   * keeps the open document in memory; an Apply that bypasses it is
   * written back over. Through the server, the open client receives the
   * Apply, and it survives the open client's later edits and a reconnect.
   */
  it(
    "an apply reaches an open editor and is not reverted",
    { timeout: 180000 },
    async () => {
      const { gm, coGm, campaignId, outlineId } = await setUpCampaign();
      const documentName = getCampaignNoteDocumentName(outlineId);

      // The co-GM holds the outline open.
      const open = new Y.Doc();
      let openSynced = false;
      const openProvider = new HocuspocusProvider({
        url: hocuspocusUrl(cfg),
        name: documentName,
        document: open,
        token: await personToken(coGm),
        onSynced: () => {
          openSynced = true;
        },
      });
      try {
        await waitFor(() => (openSynced ? true : null), 30000);
        expect(readOutlineFromDoc(open)).toBe("Original plan.");

        // A live edit the stored row has not caught up with (the server
        // persists on a 2 s debounce).
        replaceOutlineInDoc(open, "Original plan. Live edit.");
        // Wait until the server has acknowledged the edit.
        await waitFor(
          () => (openProvider.hasUnsyncedChanges ? null : true),
          30000
        );

        await signInAs(gm);
        // currentText is stale, as the UI's would be; the saved version
        // must come from the live server content instead.
        await applyOutlineRevision({
          campaignId,
          outlineId,
          currentText: "Original plan.",
          proposedText: "Revised plan.",
        });

        // The saved previous version is what the GM saw at Apply time.
        const versions = await listOutlineVersions({ campaignId });
        expect(versions.map((version) => version.content)).toEqual([
          "Original plan. Live edit.",
        ]);

        // The open editor shows the Apply.
        await waitFor(
          () => (readOutlineFromDoc(open) === "Revised plan." ? true : null),
          30000
        );

        // Past the server's debounce, with the open client still editing,
        // the stored outline keeps the Apply (plus the later edit).
        await new Promise((resolve) => setTimeout(resolve, 4000));
        replaceOutlineInDoc(open, "Revised plan. And more.");
        await storedOutlineBecomes(gm, outlineId, "Revised plan. And more.");
      } finally {
        openProvider.destroy();
      }

      // A fresh connection (reconnect) reads the same.
      const again = new Y.Doc();
      let againSynced = false;
      const againProvider = new HocuspocusProvider({
        url: hocuspocusUrl(cfg),
        name: documentName,
        document: again,
        token: await personToken(coGm),
        onSynced: () => {
          againSynced = true;
        },
      });
      try {
        await waitFor(() => (againSynced ? true : null), 30000);
        expect(readOutlineFromDoc(again)).toBe("Revised plan. And more.");
      } finally {
        againProvider.destroy();
      }
      await signOut();
    }
  );

  it(
    "an undo reaches an open editor too",
    { timeout: 180000 },
    async () => {
      const { gm, coGm, campaignId, outlineId } = await setUpCampaign();
      await signInAs(gm);
      const keptId = (await applyOutlineRevision({
        campaignId,
        outlineId,
        proposedText: "Revised plan.",
      })) as string;
      await storedOutlineBecomes(gm, outlineId, "Revised plan.");

      const open = new Y.Doc();
      let synced = false;
      const provider = new HocuspocusProvider({
        url: hocuspocusUrl(cfg),
        name: getCampaignNoteDocumentName(outlineId),
        document: open,
        token: await personToken(coGm),
        onSynced: () => {
          synced = true;
        },
      });
      try {
        await waitFor(() => (synced ? true : null), 30000);
        await undoOutlineRevision({
          campaignId,
          outlineId,
          versionId: keptId,
        });
        await waitFor(
          () => (readOutlineFromDoc(open) === "Original plan." ? true : null),
          30000
        );
        await new Promise((resolve) => setTimeout(resolve, 4000));
        await storedOutlineBecomes(gm, outlineId, "Original plan.");
      } finally {
        provider.destroy();
      }
      await signOut();
    }
  );

  // Ticket #148: Undo names its version. Two Applies kept two versions; the
  // older reply's Undo restores what its own Apply replaced and leaves the
  // later version alone, and undoing the same version twice changes nothing.
  it(
    "undoes the named version when two applies happened",
    { timeout: 180000 },
    async () => {
      const { gm, coGm, campaignId, outlineId } = await setUpCampaign();
      await signInAs(gm);
      const first = (await applyOutlineRevision({
        campaignId,
        outlineId,
        proposedText: "Plan B.",
      })) as string;
      await storedOutlineBecomes(gm, outlineId, "Plan B.");
      await signOut();

      // A co-GM applies later, keeping "Plan B." as the newest version.
      await signInAs(coGm);
      const second = (await applyOutlineRevision({
        campaignId,
        outlineId,
        proposedText: "Plan C.",
      })) as string;
      await storedOutlineBecomes(coGm, outlineId, "Plan C.");
      await signOut();

      await signInAs(gm);
      const restored = await undoOutlineRevision({
        campaignId,
        outlineId,
        versionId: first,
      });
      expect(restored).toBe("Original plan.");
      await storedOutlineBecomes(gm, outlineId, "Original plan.");
      const left = await listOutlineVersions({ campaignId });
      expect(left.map((version) => version.id)).toEqual([second]);
      expect(left[0].content).toBe("Plan B.");

      // The same version again: gone, and nothing changes.
      await expect(
        undoOutlineRevision({ campaignId, outlineId, versionId: first })
      ).rejects.toBeInstanceOf(OutlineVersionGoneError);
      await storedOutlineBecomes(gm, outlineId, "Original plan.");
      expect(
        (await listOutlineVersions({ campaignId })).map((version) => version.id)
      ).toEqual([second]);
      await signOut();
    }
  );

  // Ticket #148: the reply's saved state clears its version when that
  // version row goes away, so a reload never offers an Undo that can't work.
  it(
    "clears a reply's applied version when its version is undone",
    { timeout: 180000 },
    async () => {
      const { gm, campaignId, outlineId } = await setUpCampaign();
      await signInAs(gm);
      const conversationId = await createConversation({ campaignId });
      const messageId = await addAssistantMessage({
        conversationId,
        role: "assistant",
        content: "Here is a plan.",
      });
      const versionId = (await applyOutlineRevision({
        campaignId,
        outlineId,
        proposedText: "Plan B.",
      })) as string;
      await saveProposalState({
        messageId,
        state: "applied",
        appliedVersionId: versionId,
      });
      const read = async () => {
        const { data, error } = await gm.client
          .from(ASSISTANT_MESSAGES_TABLE)
          .select("proposal_state,applied_version_id")
          .eq("id", messageId);
        expect(error).toBeNull();
        return data?.[0];
      };
      expect(await read()).toEqual({
        proposal_state: "applied",
        applied_version_id: versionId,
      });

      await undoOutlineRevision({ campaignId, outlineId, versionId });

      expect(await read()).toEqual({
        proposal_state: "applied",
        applied_version_id: null,
      });
      await signOut();
    }
  );

  // Ticket #148: the FK's ON DELETE SET NULL is a referential action, so it
  // crosses RLS: a co-GM's Undo clears the owning GM's reply.
  it(
    "clears the owning GM's reply when a co-GM undoes the version",
    { timeout: 180000 },
    async () => {
      const { gm, coGm, campaignId, outlineId } = await setUpCampaign();
      await signInAs(gm);
      const conversationId = await createConversation({ campaignId });
      const messageId = await addAssistantMessage({
        conversationId,
        role: "assistant",
        content: "Here is a plan.",
      });
      const versionId = (await applyOutlineRevision({
        campaignId,
        outlineId,
        proposedText: "Plan B.",
      })) as string;
      await saveProposalState({
        messageId,
        state: "applied",
        appliedVersionId: versionId,
      });
      await signOut();

      await signInAs(coGm);
      await undoOutlineRevision({ campaignId, outlineId, versionId });
      await signOut();

      const { data, error } = await gm.client
        .from(ASSISTANT_MESSAGES_TABLE)
        .select("proposal_state,applied_version_id")
        .eq("id", messageId);
      expect(error).toBeNull();
      expect(data?.[0]).toEqual({
        proposal_state: "applied",
        applied_version_id: null,
      });
    }
  );
});
