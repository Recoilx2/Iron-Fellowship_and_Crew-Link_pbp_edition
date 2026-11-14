import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CAMPAIGNS_TABLE } from "api-calls/campaign/_getRef";
import { CAMPAIGN_NOTES_TABLE } from "api-calls/notes/_getRef";
import { WORLD_LORE_TABLE } from "api-calls/world/lore/_getRef";
import { WORLD_NPCS_TABLE } from "api-calls/world/npcs/_getRef";
import { WORLD_LOCATIONS_TABLE } from "api-calls/world/locations/_getRef";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";

export interface AssistantContextEntryOption {
  id: string;
  name: string;
}

export interface AssistantContextNoteOption {
  id: string;
  title: string;
}

export interface AssistantContextChannelOption {
  id: string;
  name: string;
  visibility: string;
}

export interface AssistantContextOptions {
  worldId: string | null;
  /** Whether the campaign already has an outline row to include. */
  outlineAvailable: boolean;
  lore: AssistantContextEntryOption[];
  npcs: AssistantContextEntryOption[];
  locations: AssistantContextEntryOption[];
  /** Notes the GM can read, without the outline (it has its own row). */
  notes: AssistantContextNoteOption[];
  /** Channels the GM can read, direct messages included when visible. */
  channels: AssistantContextChannelOption[];
}

async function selectWhere(
  table: string,
  columns: string,
  column: string,
  value: string
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await getSupabaseClient()
    .from(table)
    .select(columns)
    .eq(column, value);
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

function entryName(row: Record<string, unknown>): string {
  return typeof row.name === "string" && row.name.trim()
    ? row.name
    : "Untitled";
}

function noteTitle(row: Record<string, unknown>): string {
  return typeof row.title === "string" && row.title.trim()
    ? row.title
    : "Untitled";
}

function byLabel(
  a: { name?: string; title?: string },
  b: { name?: string; title?: string }
): number {
  return (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "");
}

/**
 * Lists everything the Context tab can offer for a campaign: the
 * campaign's world, whether its outline exists yet, and every world
 * entry, note and channel the signed-in GM can read. The database's
 * access rules filter every list, including direct messages the GM is
 * not in; the client only shapes the rows. World entries always carry a
 * GM-only note row (created with the item), so each one gets an eye
 * toggle for its GM-only part.
 */
export const fetchAssistantContextOptions = createApiFunction<
  { campaignId: string },
  AssistantContextOptions
>(async (params) => {
  const { campaignId } = params;
  if (!campaignId || campaignId.trim().length === 0) {
    throw new Error("A campaign is required to list context options.");
  }

  const [campaignRows, noteRows, channelRows] = await Promise.all([
    selectWhere(CAMPAIGNS_TABLE, "world_id", "id", campaignId),
    selectWhere(CAMPAIGN_NOTES_TABLE, "id,title,kind", "campaign_id", campaignId),
    selectWhere(CHAT_CHANNELS_TABLE, "id,name,visibility", "campaign_id", campaignId),
  ]);
  const worldId = campaignRows[0]?.world_id;
  const resolvedWorldId =
    typeof worldId === "string" && worldId.length > 0 ? worldId : null;

  const [loreRows, npcRows, locationRows] = resolvedWorldId
    ? await Promise.all([
        selectWhere(WORLD_LORE_TABLE, "id,name", "world_id", resolvedWorldId),
        selectWhere(WORLD_NPCS_TABLE, "id,name", "world_id", resolvedWorldId),
        selectWhere(WORLD_LOCATIONS_TABLE, "id,name", "world_id", resolvedWorldId),
      ])
    : [[], [], []];

  return {
    worldId: resolvedWorldId,
    outlineAvailable: noteRows.some((row) => row.kind === "outline"),
    lore: loreRows
      .filter((row) => typeof row.id === "string")
      .map((row) => ({ id: row.id as string, name: entryName(row) }))
      .sort(byLabel),
    npcs: npcRows
      .filter((row) => typeof row.id === "string")
      .map((row) => ({ id: row.id as string, name: entryName(row) }))
      .sort(byLabel),
    locations: locationRows
      .filter((row) => typeof row.id === "string")
      .map((row) => ({ id: row.id as string, name: entryName(row) }))
      .sort(byLabel),
    notes: noteRows
      .filter((row) => typeof row.id === "string" && row.kind !== "outline")
      .map((row) => ({ id: row.id as string, title: noteTitle(row) }))
      .sort(byLabel),
    channels: channelRows
      .filter((row) => typeof row.id === "string")
      .map((row) => ({
        id: row.id as string,
        name: entryName(row),
        visibility:
          typeof row.visibility === "string" ? row.visibility : "public",
      }))
      .sort(byLabel),
  };
}, "Failed to list assistant context options.");
