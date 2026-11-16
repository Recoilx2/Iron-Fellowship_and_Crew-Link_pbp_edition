/**
 * Building the assistant context text server-side (spec #10, tickets
 * #132, #149): the GM's saved references are turned into the text the
 * model receives, every read through PostgREST with the caller's JWT so
 * the row-level security rules stay the only gate. A reference that reads
 * back nothing is skipped and reported, never leaked; a GM-only part is
 * read only when its toggle is on. Split out of `handler.ts` (ticket
 * #151); the same code sizes `/context-size` and builds the chat
 * context, so the two cannot drift.
 */
import {
  approximateTokensForChars,
  emptyAssistantContextChoice,
  type AssistantChannelReference,
  type AssistantContextChoice,
  type AssistantItemReference,
} from "./protocol.ts";
import type { UpstreamFetch } from "./env.ts";
import type { GmAssistantEnv } from "./env.ts";
import { errorName } from "./http.ts";
import { mintReference, UUID_PATTERN } from "./security.ts";
import { postgrest } from "./postgrest.ts";
import { yjsBase64ToPlainText } from "./yjsText.ts";

export interface AssistantContextItem {
  key: string;
  label: string;
  chars: number;
  tokens: number;
}

export interface AssistantUnavailableReference {
  key: string;
  reason: string;
}

export interface BuiltAssistantContext {
  /** Sections in checklist order, joined with blank lines for the model. */
  text: string;
  items: AssistantContextItem[];
  totalChars: number;
  totalTokens: number;
  unavailable: AssistantUnavailableReference[];
}

function normalizeItemReference(entry: unknown): AssistantItemReference | null {
  if (!entry || typeof entry !== "object") return null;
  const { id, includeGmParts } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  return { id, includeGmParts: includeGmParts === true };
}

function normalizeChannelReference(entry: unknown): AssistantChannelReference | null {
  if (!entry || typeof entry !== "object") return null;
  const { id, postCount } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  const count = typeof postCount === "number" && Number.isFinite(postCount)
    ? Math.trunc(postCount)
    : 5;
  return { id, postCount: Math.min(50, Math.max(1, count)) };
}

export function normalizeContextChoice(raw: unknown): AssistantContextChoice {
  const empty = emptyAssistantContextChoice();
  if (!raw || typeof raw !== "object") return empty;
  const record = raw as Record<string, unknown>;
  const listOf = (value: unknown, normalize: (entry: unknown) => { id: string } | null) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: Array<{ id: string }> = [];
    for (const entry of value.slice(0, 100)) {
      const normalized = normalize(entry);
      if (normalized && !seen.has(normalized.id)) {
        seen.add(normalized.id);
        out.push(normalized as { id: string });
      }
    }
    return out;
  };
  return {
    includeOutline: record.includeOutline === true,
    lore: listOf(record.lore, normalizeItemReference) as AssistantItemReference[],
    npcs: listOf(record.npcs, normalizeItemReference) as AssistantItemReference[],
    locations: listOf(record.locations, normalizeItemReference) as AssistantItemReference[],
    notes: (Array.isArray(record.notes) ? record.notes : [])
      .filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 100),
    channels: listOf(record.channels, normalizeChannelReference) as AssistantChannelReference[],
  };
}

export async function readSavedContext(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<AssistantContextChoice> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_settings?campaign_id=eq.${encodeURIComponent(campaignId)}&gm_id=eq.${encodeURIComponent(userId)}&select=context`,
    fetchImpl,
  );
  if (status !== 200 || rows.length === 0) {
    return normalizeContextChoice(null);
  }
  return normalizeContextChoice((rows[0] as { context?: unknown }).context);
}

function pushSection(
  sections: Array<{ key: string; label: string; text: string }>,
  key: string,
  label: string,
  lines: Array<string | null | undefined>,
): void {
  const text = lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0).join("\n").trim();
  if (!text) return;
  sections.push({ key, label, text: `${label}\n${text}` });
}

function gmDetailLines(details: Record<string, unknown>, fields: Array<{ column: string; label: string }>): string[] {
  const lines: string[] = [];
  for (const { column, label } of fields) {
    const value = details[column];
    if (typeof value === "string" && value.trim()) {
      lines.push(`${label}: ${value.trim()}`);
    } else if (value && typeof value === "object" && Object.keys(value).length > 0) {
      lines.push(`${label}: ${JSON.stringify(value)}`);
    }
  }
  return lines;
}

/**
 * Builds the assistant context text from the GM's saved references, every
 * read through PostgREST with the caller's JWT so the access rules decide.
 * A reference that reads back nothing (deleted, or a direct message the
 * caller is not in) is skipped and reported in `unavailable`, never
 * leaked; a GM-only part is read only when its toggle is on. World entries
 * must belong to the campaign's own world (a campaign with no world has
 * none, so world references are ignored) and channels to the campaign,
 * otherwise they read as unavailable too.
 */
export async function buildAssistantContext(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  choice: AssistantContextChoice,
  fetchImpl: UpstreamFetch,
): Promise<BuiltAssistantContext> {
  void userId;
  const sections: Array<{ key: string; label: string; text: string }> = [];
  const unavailable: AssistantUnavailableReference[] = [];

  const readRows = async (path: string): Promise<Array<Record<string, unknown>>> => {
    const { status, rows } = await postgrest(env, callerToken, path, fetchImpl);
    return status === 200 ? rows : [];
  };

  const readNoteText = async (contentsTable: string, noteId: string): Promise<string> => {
    const rows = await readRows(
      `${contentsTable}?note_id=eq.${encodeURIComponent(noteId)}&select=content`,
    );
    const content = (rows[0] as { content?: unknown } | undefined)?.content;
    return yjsBase64ToPlainText(typeof content === "string" ? content : null);
  };

  // A failed campaign read is treated as "no world" (fail closed: no world
  // item can be resolved), but it is not silent: the log line carries a
  // reference, so an operator can find why world references went missing.
  const campaignRead = await postgrest(
    env,
    callerToken,
    `campaigns?id=eq.${encodeURIComponent(campaignId)}&select=world_id`,
    fetchImpl,
  );
  if (campaignRead.status !== 200) {
    console.error(
      `[gm-assistant] ref=${mintReference()} code=WORLD_READ_FAILED status=${campaignRead.status} campaigns read failed; world references are skipped`,
    );
  }
  const worldId = (campaignRead.rows[0] as { world_id?: unknown } | undefined)?.world_id;
  const campaignWorldId = typeof worldId === "string" && UUID_PATTERN.test(worldId) ? worldId : null;

  /**
   * The one place a world item is looked up, so chat and `/context-size`
   * (both built here) cannot drift. A campaign with no world has no world
   * items: nothing is queried. Otherwise the read is filtered to the
   * campaign's own world and the row is checked again.
   */
  const readWorldItem = async (
    table: "world_lore" | "world_npcs" | "world_locations",
    id: string,
    columns: string,
  ): Promise<Record<string, unknown> | null> => {
    if (!campaignWorldId) return null;
    const rows = await readRows(
      `${table}?id=eq.${encodeURIComponent(id)}&world_id=eq.${encodeURIComponent(campaignWorldId)}&select=id,${columns},world_id`,
    );
    const row = rows[0];
    if (!row || typeof row.id !== "string" || row.world_id !== campaignWorldId) return null;
    return row;
  };

  if (choice.includeOutline) {
    const outlineRows = await readRows(
      `campaign_notes?campaign_id=eq.${encodeURIComponent(campaignId)}&kind=eq.outline&select=id,title`,
    );
    const outline = outlineRows[0] as { id?: unknown; title?: unknown } | undefined;
    if (outline && typeof outline.id === "string") {
      const text = await readNoteText("campaign_note_contents", outline.id);
      pushSection(sections, "outline", "Campaign outline", [text || null]);
      if (sections.at(-1)?.key !== "outline") {
        unavailable.push({ key: "outline", reason: "empty" });
      }
    } else {
      unavailable.push({ key: "outline", reason: "not found" });
    }
  }

  const readWorldItemNotes = async (
    kind: "lore" | "npc" | "location",
    itemId: string,
    includeGmParts: boolean,
  ): Promise<{ publicText: string; gmText: string }> => {
    const column = kind === "lore" ? "lore_id" : kind === "npc" ? "npc_id" : "location_id";
    const noteRows = await readRows(
      `world_notes?${column}=eq.${encodeURIComponent(itemId)}&select=id,gm_only`,
    );
    let publicText = "";
    let gmText = "";
    for (const note of noteRows) {
      if (typeof note.id !== "string") continue;
      const text = await readNoteText("world_note_contents", note.id);
      if (!text) continue;
      if (note.gm_only === true) {
        if (includeGmParts) gmText += (gmText ? "\n" : "") + text;
      } else {
        publicText += (publicText ? "\n" : "") + text;
      }
    }
    return { publicText, gmText };
  };

  const idsOf = (rows: Array<Record<string, unknown>>, column: string): string[] => [
    ...new Set(
      rows
        .map((row) => row[column])
        .filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)),
    ),
  ];
  const namesById = async (
    table: string,
    nameColumn: string,
    ids: string[],
    worldId?: string | null,
  ): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const worldFilter = worldId ? `&world_id=eq.${encodeURIComponent(worldId)}` : "";
    const rows = await readRows(
      `${table}?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,${nameColumn}${worldFilter}`,
    );
    for (const row of rows) {
      const name = row[nameColumn];
      if (typeof row.id === "string" && typeof name === "string" && name.trim()) {
        map.set(row.id, name.trim());
      }
    }
    return map;
  };
  let roster: { gmIds: Set<string>; playerNumber: Map<string, number> } | null = null;
  /**
   * Who spoke each recent post: the NPC or character voice. Otherwise a
   * neutral label for the member: "GM", or "Player N" numbered by the
   * campaign's stable member order. Account display names may be real
   * names, so they are never sent to the model endpoint. A GM speaking as
   * an NPC or character carries a "(GM)" suffix, judged by the current GM
   * roster. A member who cannot be found reads as "Someone".
   *
   * Both neutral labels are approximations and say so on purpose: "Player
   * N" is the member's position in the roster at request time, so it can
   * shift when members join or leave; every GM reads as "GM" with no
   * distinction between them. Names are re-read for each request, so a
   * changed roster only renumbers future context.
   */
  const readSpeakerNames = async (posts: Array<Record<string, unknown>>) => {
    if (roster === null) {
      const members = await readRows(
        `campaign_members?campaign_id=eq.${encodeURIComponent(campaignId)}&select=user_id,role&order=created_at.asc,user_id.asc`,
      );
      const gmIds = new Set<string>();
      const playerNumber = new Map<string, number>();
      for (const member of members) {
        if (typeof member.user_id !== "string") continue;
        if (member.role === "gm") gmIds.add(member.user_id);
        else if (!playerNumber.has(member.user_id)) playerNumber.set(member.user_id, playerNumber.size + 1);
      }
      roster = { gmIds, playerNumber };
    }
    const [characters, npcs] = await Promise.all([
      namesById("characters", "name", idsOf(posts, "speaker_character_id")),
      // An NPC voice is only used while it belongs to the campaign's
      // current world: after the world changes, older posts keep a
      // speaker_npc_id from the former world, and that name must not
      // reach the model. When there is no world, or the NPC is from
      // another one, the name reads as nothing and the speaker falls
      // back to the neutral labels below.
      campaignWorldId
        ? namesById("world_npcs", "name", idsOf(posts, "speaker_npc_id"), campaignWorldId)
        : Promise.resolve(new Map<string, string>()),
    ]);
    const { gmIds, playerNumber } = roster;
    return {
      speakerOf: (post: Record<string, unknown>): string => {
        const author = typeof post.author_id === "string" ? post.author_id : "";
        const isGm = gmIds.has(author);
        const voice =
          (typeof post.speaker_npc_id === "string" ? npcs.get(post.speaker_npc_id) : undefined) ??
          (typeof post.speaker_character_id === "string"
            ? characters.get(post.speaker_character_id)
            : undefined);
        if (voice) return isGm ? `${voice} (GM)` : voice;
        if (isGm) return "GM";
        const number = playerNumber.get(author);
        return number ? `Player ${number}` : "Someone";
      },
    };
  };

  for (const ref of choice.lore) {
    const row = (await readWorldItem("world_lore", ref.id, "name,tags")) as { name?: unknown; tags?: unknown } | null;
    if (!row) {
      unavailable.push({ key: `lore:${ref.id}`, reason: "not found" });
      continue;
    }
    const { publicText, gmText } = await readWorldItemNotes("lore", ref.id, ref.includeGmParts);
    const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [];
    pushSection(sections, `lore:${ref.id}`, `Lore: ${typeof row.name === "string" ? row.name : "Untitled"}`, [
      tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
      publicText || null,
      gmText ? `GM-only:\n${gmText}` : null,
    ]);
    if (sections.at(-1)?.key !== `lore:${ref.id}`) {
      unavailable.push({ key: `lore:${ref.id}`, reason: "empty" });
    }
  }

  for (const ref of choice.npcs) {
    const row = (await readWorldItem("world_npcs", ref.id, "name")) as { name?: unknown } | null;
    if (!row) {
      unavailable.push({ key: `npc:${ref.id}`, reason: "not found" });
      continue;
    }
    const details = ref.includeGmParts
      ? ((await readRows(`world_npc_gm_details?npc_id=eq.${encodeURIComponent(ref.id)}&select=goal,role,descriptor,disposition,activity,first_look,revealed_aspect`))[0] as Record<string, unknown> | undefined)
      : undefined;
    const { publicText, gmText } = await readWorldItemNotes("npc", ref.id, ref.includeGmParts);
    pushSection(sections, `npc:${ref.id}`, `NPC: ${typeof row.name === "string" ? row.name : "Untitled"}`, [
      ...(details
        ? gmDetailLines(details, [
            { column: "role", label: "Role" },
            { column: "descriptor", label: "Descriptor" },
            { column: "goal", label: "Goal" },
            { column: "disposition", label: "Disposition" },
            { column: "activity", label: "Activity" },
            { column: "first_look", label: "First look" },
            { column: "revealed_aspect", label: "Revealed aspect" },
          ])
        : []),
      publicText || null,
      gmText ? `GM-only notes:\n${gmText}` : null,
    ]);
    if (sections.at(-1)?.key !== `npc:${ref.id}`) {
      unavailable.push({ key: `npc:${ref.id}`, reason: "empty" });
    }
  }

  for (const ref of choice.locations) {
    const row = (await readWorldItem("world_locations", ref.id, "name")) as { name?: unknown } | null;
    if (!row) {
      unavailable.push({ key: `location:${ref.id}`, reason: "not found" });
      continue;
    }
    const details = ref.includeGmParts
      ? ((await readRows(`world_location_gm_details?location_id=eq.${encodeURIComponent(ref.id)}&select=fields,descriptor,trouble,location_features`))[0] as Record<string, unknown> | undefined)
      : undefined;
    const { publicText, gmText } = await readWorldItemNotes("location", ref.id, ref.includeGmParts);
    pushSection(sections, `location:${ref.id}`, `Location: ${typeof row.name === "string" ? row.name : "Untitled"}`, [
      ...(details
        ? gmDetailLines(details, [
            { column: "descriptor", label: "Descriptor" },
            { column: "trouble", label: "Trouble" },
            { column: "location_features", label: "Features" },
            { column: "fields", label: "Details" },
          ])
        : []),
      publicText || null,
      gmText ? `GM-only notes:\n${gmText}` : null,
    ]);
    if (sections.at(-1)?.key !== `location:${ref.id}`) {
      unavailable.push({ key: `location:${ref.id}`, reason: "empty" });
    }
  }

  for (const noteId of choice.notes) {
    const rows = await readRows(
      `campaign_notes?id=eq.${encodeURIComponent(noteId)}&campaign_id=eq.${encodeURIComponent(campaignId)}&select=id,title`,
    );
    const row = rows[0] as { id?: unknown; title?: unknown } | undefined;
    if (!row || typeof row.id !== "string") {
      unavailable.push({ key: `note:${noteId}`, reason: "not found" });
      continue;
    }
    const text = await readNoteText("campaign_note_contents", noteId);
    pushSection(sections, `note:${noteId}`, `Note: ${typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Untitled"}`, [
      text || null,
    ]);
    if (sections.at(-1)?.key !== `note:${noteId}`) {
      unavailable.push({ key: `note:${noteId}`, reason: "empty" });
    }
  }

  for (const ref of choice.channels) {
    const rows = await readRows(
      `chat_channels?id=eq.${encodeURIComponent(ref.id)}&select=id,name,campaign_id`,
    );
    const row = rows[0] as { id?: unknown; name?: unknown; campaign_id?: unknown } | undefined;
    if (!row || typeof row.id !== "string" || row.campaign_id !== campaignId) {
      unavailable.push({ key: `channel:${ref.id}`, reason: "not found" });
      continue;
    }
    const posts = await readRows(
      `chat_posts?channel_id=eq.${encodeURIComponent(ref.id)}&select=text,created_at,author_id,speaker_character_id,speaker_npc_id&order=created_at.desc&limit=${ref.postCount}`,
    );
    const readable = posts.filter(
      (post) => typeof post.text === "string" && (post.text as string).trim().length > 0,
    );
    const names = await readSpeakerNames(readable);
    const lines = readable
      .map((post) => `${names.speakerOf(post)}: ${(post.text as string).trim()}`)
      .reverse();
    if (lines.length === 0) {
      unavailable.push({ key: `channel:${ref.id}`, reason: "empty" });
      continue;
    }
    pushSection(
      sections,
      `channel:${ref.id}`,
      `Channel: ${typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled"} (last ${lines.length})`,
      lines,
    );
  }

  const items: AssistantContextItem[] = sections.map((section) => ({
    key: section.key,
    label: section.label.split("\n")[0],
    chars: section.text.length,
    tokens: approximateTokensForChars(section.text.length),
  }));
  const totalChars = items.reduce((sum, item) => sum + item.chars, 0);
  return {
    text: sections.map((section) => section.text).join("\n\n"),
    items,
    totalChars,
    totalTokens: approximateTokensForChars(totalChars),
    unavailable,
  };
}
