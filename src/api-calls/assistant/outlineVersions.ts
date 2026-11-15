import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CAMPAIGN_NOTE_CONTENTS_TABLE } from "api-calls/notes/_getRef";
import { decodeNoteContent } from "api-calls/notes/noteContent";
import {
  ASSISTANT_OUTLINE_VERSIONS_TABLE,
  outlineVersionRowToDocument,
  type AssistantOutlineVersion,
  type AssistantOutlineVersionRow,
} from "./_getRef";
import { openOutlineSession } from "./outlineSession";

/**
 * The outline version history behind Apply and Undo (ticket #133): every
 * Apply keeps the replaced outline text as a GM-only row, so the GM can
 * undo from the reply or the Outline tab. Versions belong to the campaign
 * and are shared by its GMs, exactly like the outline; only GMs of the
 * campaign read or write them. The assistant itself never writes here:
 * only the GM's Apply (and Undo) do.
 */

const LIST_LIMIT = 25;

/**
 * How many replaced outline texts to keep per campaign. Every Apply keeps
 * one version and every Undo drops one, so without a cap a long session
 * grows the table without bound; the spec only needs the previous version
 * to stay available. Keeping the last 20 still offers ample Undo while
 * bounding growth. Pruning is best-effort and never fails an Apply.
 */
export const MAX_KEPT_OUTLINE_VERSIONS = 20;

async function signedInGmId(): Promise<string> {
  const { data: sessionData, error: sessionError } =
    await getSupabaseClient().auth.getSession();
  const gmId = sessionData.session?.user.id;
  if (sessionError || !gmId) {
    throw sessionError ?? new Error("You must be logged in to revise the outline.");
  }
  return gmId;
}

type ContentsClient = Pick<
  ReturnType<typeof getSupabaseClient>,
  "from"
>;

/**
 * Reads the outline's raw note-server bytes, or null when no row is
 * stored yet. The Outline tab uses it for a fresh "current" text at
 * revision-request time, instead of trusting the live subscription's
 * timing.
 */
export async function fetchOutlineContentBytes(
  outlineId: string
): Promise<Uint8Array | null> {
  const { data, error } = await getSupabaseClient()
    .from(CAMPAIGN_NOTE_CONTENTS_TABLE)
    .select("content")
    .eq("note_id", outlineId);
  if (error) {
    throw error;
  }
  const stored = (data?.[0] as { content?: unknown } | undefined)?.content;
  if (typeof stored !== "string" || !stored) {
    return null;
  }
  return decodeNoteContent(stored);
}

/**
 * Lists the campaign's kept outline versions, newest first. Empty until
 * the first Apply; players and outsiders see none (the access rules hide
 * every row).
 */
export const listOutlineVersions = createApiFunction<
  { campaignId: string },
  AssistantOutlineVersion[]
>(async (params) => {
  const { campaignId } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to read outline versions.");
  }
  const { data, error } = await getSupabaseClient()
    .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as AssistantOutlineVersionRow[]).map(
    outlineVersionRowToDocument
  );
}, "Failed to read outline versions.");

/**
 * Drops kept versions past the retention cap, oldest first. Best-effort:
 * pruning never fails an Apply; Undo still works because the newest rows
 * (including the one just kept) are always retained.
 */
async function pruneOldOutlineVersions(
  client: ContentsClient,
  campaignId: string
): Promise<void> {
  try {
    const { data, error } = await client
      .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
      .select("id,created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(MAX_KEPT_OUTLINE_VERSIONS + 10);
    if (error || !data) {
      return;
    }
    const rows = data as unknown as Array<{ id: string }>;
    if (rows.length <= MAX_KEPT_OUTLINE_VERSIONS) {
      return;
    }
    const extra = rows.slice(MAX_KEPT_OUTLINE_VERSIONS);
    for (const old of extra) {
      if (!old || typeof old.id !== "string") {
        continue;
      }
      try {
        await client
          .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
          .delete()
          .eq("id", old.id)
          .eq("campaign_id", campaignId)
          .select("id");
      } catch {
        // One prune delete failing must not fail the Apply.
      }
    }
  } catch {
    // Pruning is best-effort; the Apply already succeeded.
  }
}

/**
 * Applies a proposed outline revision: keeps the text the note server
 * holds as a version (unless the outline is currently blank, when there is
 * nothing worth keeping), then replaces the outline through the note
 * server with the proposed text, waiting until the server has it.
 * Returns the kept version's id, or null when nothing was kept. When the
 * replace fails the kept version is dropped again; when the outline was
 * changed by someone else meanwhile the Apply throws but keeps the
 * version. The proposal must be non-blank; a blank outline and a blank proposal
 * both refuse before anything is written. Kept versions are capped to
 * the last MAX_KEPT_OUTLINE_VERSIONS per campaign (best-effort prune),
 * so Undo stays available without unbounded growth.
 */
export const applyOutlineRevision = createApiFunction<
  {
    campaignId: string;
    outlineId: string;
    /** Ignored: the kept version is read from the note server. */
    currentText?: string;
    proposedText: string;
  },
  string | null
>(async (params) => {
  const { campaignId, outlineId, proposedText } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to apply an outline revision.");
  }
  if (!outlineId || outlineId.trim().length === 0) {
    throw new Error("An outline is required to apply a revision.");
  }
  if (!proposedText || proposedText.trim().length === 0) {
    throw new Error("An outline revision needs non-blank text.");
  }
  const gmId = await signedInGmId();
  const client = getSupabaseClient();

  // The outline is edited through the note server, never over REST: the
  // server keeps open documents in memory and would write a REST change
  // back over. What the server holds is also the truth for the kept
  // version, so it includes edits made in the last seconds.
  const session = await openOutlineSession(outlineId);
  try {
    const previous = session.text().trim();
    let versionId: string | null = null;
    if (previous.length > 0) {
      versionId = crypto.randomUUID();
      const { error: versionError } = await client
        .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
        .insert({
          id: versionId,
          campaign_id: campaignId,
          created_by: gmId,
          content: previous,
        });
      if (versionError) {
        throw versionError;
      }
    }

    const proposed = proposedText.trim();
    try {
      await session.replace(proposed);
    } catch (error) {
      // The replace did not land (timeout or refusal): drop the version
      // kept just before it, so no orphan row offers a bogus Undo.
      if (versionId !== null) {
        try {
          await client
            .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
            .delete()
            .eq("id", versionId)
            .eq("campaign_id", campaignId)
            .select("id");
        } catch (cleanupError) {
          console.error("Could not drop the unused outline version", cleanupError);
        }
      }
      throw error;
    }
    if (session.text().trim() !== proposed) {
      // The replace landed (the version stays for Undo), but someone
      // else changed the outline in the meantime.
      throw new Error(
        "The outline changed while the revision was applied. Check the outline."
      );
    }
    if (versionId !== null) {
      await pruneOldOutlineVersions(client, campaignId);
    }
    return versionId;
  } finally {
    session.close();
  }
}, "Failed to apply the outline revision.");

/**
 * Thrown by Undo when the named version no longer exists: it was already
 * undone or pruned past the retention cap. Nothing is changed; callers show
 * a generic message with a reference.
 */
export class OutlineVersionGoneError extends Error {
  constructor() {
    super("That outline version is gone.");
    this.name = "OutlineVersionGoneError";
  }
}

/**
 * Undoes one Apply: restores the named version's text to the outline
 * through the note server, then drops that version row. Undo is by id, so
 * an older reply's Undo restores what its own Apply replaced and never
 * reverts a later Apply by a co-GM. Throws OutlineVersionGoneError, without
 * changing anything, when the version was already undone or pruned. When
 * someone else changed the outline during the restore it throws and keeps
 * the version.
 */
export const undoOutlineRevision = createApiFunction<
  { campaignId: string; outlineId: string; versionId: string },
  string
>(async (params) => {
  const { campaignId, outlineId, versionId } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to undo an outline revision.");
  }
  if (!outlineId || outlineId.trim().length === 0) {
    throw new Error("An outline is required to undo a revision.");
  }
  if (!versionId || versionId.trim().length === 0) {
    throw new Error("An outline version is required to undo a revision.");
  }
  await signedInGmId();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
    .select("*")
    .eq("id", versionId)
    .eq("campaign_id", campaignId);
  if (error) {
    throw error;
  }
  const version = (data ?? [])[0] as unknown as
    | AssistantOutlineVersionRow
    | undefined;
  if (!version) {
    throw new OutlineVersionGoneError();
  }

  const session = await openOutlineSession(outlineId);
  try {
    await session.replace(version.content);
    if (session.text().trim() !== version.content.trim()) {
      throw new Error(
        "The outline changed while the revision was undone. Check the outline."
      );
    }
  } finally {
    session.close();
  }

  const { data: deleted, error: deleteError } = await client
    .from(ASSISTANT_OUTLINE_VERSIONS_TABLE)
    .delete()
    .eq("id", version.id)
    .eq("campaign_id", campaignId)
    .select("id");
  if (deleteError || !deleted || deleted.length === 0) {
    throw deleteError ?? new OutlineVersionGoneError();
  }
  return version.content;
}, "Failed to undo the outline revision.");
