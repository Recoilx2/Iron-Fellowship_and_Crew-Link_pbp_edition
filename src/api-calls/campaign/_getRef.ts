import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";
import {
  CampaignDocument,
  CampaignType,
} from "api-calls/campaign/_campaign.type";
import { DocumentUpdate } from "api-calls/helpers.type";
import type { CharacterRow } from "api-calls/character/_getRef";

/**
 * Identifiers and row mapping for campaigns and their roster. The data layer
 * is the only place that names backend tables, live-update channels and
 * invite RPCs; stores, pages and components stay backend-free.
 *
 * One campaign row holds what used to be the campaign document; the roster
 * (users/gmIds) assembles from campaign_members and the character list from
 * characters, so the document shape stores and pages read never drifts.
 */

export const CAMPAIGNS_TABLE = "campaigns";
export const CAMPAIGN_MEMBERS_TABLE = "campaign_members";

export interface CampaignRow {
  id: string;
  name: string;
  world_id: string | null;
  type: string;
  theme: string | null;
  custom_tracks: Record<string, unknown>;
  condition_meters: Record<string, unknown>;
  special_tracks: Record<string, unknown>;
  expansion_ids: string[];
  hidden_asset_ids: string[];
  hidden_oracle_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignMemberRow {
  campaign_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export type CampaignCharacterLink = Pick<
  CharacterRow,
  "id" | "owner_id" | "campaign_id"
>;

export function constructUserCampaignsChannelName(uid: string): string {
  return `user-campaigns:${uid}`;
}

export function constructUserCampaignMembersChannelName(uid: string): string {
  return `user-campaign-members:${uid}`;
}

export function constructUserCampaignCharactersChannelName(
  uid: string
): string {
  return `user-campaign-characters:${uid}`;
}

function sorted<T>(values: T[]): T[] {
  return [...values].sort();
}

/**
 * Assembles the campaign documents one person sees from the campaign rows,
 * the roster rows and the character links they may read. Users, guides and
 * characters sort so repeated assemblies compare equal.
 */
export function assembleCampaignDocuments(
  campaigns: CampaignRow[],
  members: CampaignMemberRow[],
  characters: CampaignCharacterLink[],
  uid: string
): Array<{ id: string; doc: CampaignDocument }> {
  const mine = new Set(
    members.filter((row) => row.user_id === uid).map((row) => row.campaign_id)
  );
  const membersByCampaign = new Map<string, CampaignMemberRow[]>();
  for (const row of members) {
    const list = membersByCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    membersByCampaign.set(row.campaign_id, list);
  }
  const charactersByCampaign = new Map<string, CampaignCharacterLink[]>();
  for (const row of characters) {
    if (!row.campaign_id) continue;
    const list = charactersByCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    charactersByCampaign.set(row.campaign_id, list);
  }
  return campaigns
    .filter((row) => mine.has(row.id))
    .map((row) => {
      const roster = membersByCampaign.get(row.id) ?? [];
      const links = charactersByCampaign.get(row.id) ?? [];
      const doc: CampaignDocument = {
        name: row.name,
        users: sorted(roster.map((entry) => entry.user_id)),
        characters: sorted(
          links.map((entry) => `${entry.owner_id}:${entry.id}`)
        ).map((key) => {
          const separator = key.indexOf(":");
          return {
            uid: key.slice(0, separator),
            characterId: key.slice(separator + 1),
          };
        }),
        gmIds: sorted(
          roster
            .filter((entry) => entry.role === "gm")
            .map((entry) => entry.user_id)
        ),
      };
      if (row.world_id) {
        doc.worldId = row.world_id;
      }
      if (row.type) {
        doc.type = row.type as CampaignType;
      }
      if (row.theme) {
        doc.theme = row.theme as CampaignDocument["theme"];
      }
      if (row.expansion_ids && row.expansion_ids.length > 0) {
        doc.expansionIds = row.expansion_ids;
      }
      if (row.hidden_asset_ids && row.hidden_asset_ids.length > 0) {
        doc.hiddenAssetIds = row.hidden_asset_ids;
      }
      if (row.hidden_oracle_ids && row.hidden_oracle_ids.length > 0) {
        doc.hiddenOracleIds = row.hidden_oracle_ids;
      }
      if (row.custom_tracks && Object.keys(row.custom_tracks).length > 0) {
        doc.customTracks = row.custom_tracks as CampaignDocument["customTracks"];
      }
      if (
        row.condition_meters &&
        Object.keys(row.condition_meters).length > 0
      ) {
        doc.conditionMeters =
          row.condition_meters as CampaignDocument["conditionMeters"];
      }
      if (row.special_tracks && Object.keys(row.special_tracks).length > 0) {
        doc.specialTracks =
          row.special_tracks as CampaignDocument["specialTracks"];
      }
      return { id: row.id, doc };
    });
}

const campaignFieldToColumn: Record<string, string> = {
  name: "name",
  worldId: "world_id",
  type: "type",
  theme: "theme",
  customTracks: "custom_tracks",
  conditionMeters: "condition_meters",
  specialTracks: "special_tracks",
  expansionIds: "expansion_ids",
  hiddenAssetIds: "hidden_asset_ids",
  hiddenOracleIds: "hidden_oracle_ids",
};

/**
 * Converts an app-level campaign update into row columns, merging dotted
 * field paths over the current row so no sibling data is lost. Roster
 * fields (users, gmIds, characters) belong to the roster functions and are
 * ignored here.
 */
export function campaignUpdateToColumns(
  row: CampaignRow,
  campaign: DocumentUpdate<CampaignDocument>
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: row.name,
    worldId: row.world_id,
    type: row.type,
    theme: row.theme,
    customTracks: row.custom_tracks,
    conditionMeters: row.condition_meters,
    specialTracks: row.special_tracks,
    expansionIds: row.expansion_ids,
    hiddenAssetIds: row.hidden_asset_ids,
    hiddenOracleIds: row.hidden_oracle_ids,
  };
  const update = { ...(campaign as Record<string, unknown>) };
  delete update.users;
  delete update.gmIds;
  delete update.characters;
  const merged = applyDocumentUpdate(base, update);
  const touched = new Set(
    Object.keys(update).map((path) => path.split(".")[0])
  );
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(campaignFieldToColumn)) {
    if (touched.has(field)) {
      columns[column] = merged[field] ?? null;
    }
  }
  return columns;
}

export function campaignPayloadToChange(
  payload: PostgresChangePayload<CampaignRow>
): RowChange<CampaignRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CampaignRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<CampaignRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as CampaignRow }
    : null;
}

export function campaignMemberKey(row: CampaignMemberRow): string {
  return `${row.campaign_id}:${row.user_id}`;
}

export function campaignMemberPayloadToChange(
  payload: PostgresChangePayload<CampaignMemberRow>
): RowChange<CampaignMemberRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CampaignMemberRow>;
    return typeof old.campaign_id === "string" &&
      typeof old.user_id === "string"
      ? {
          kind: "remove",
          key: `${old.campaign_id}:${old.user_id}`,
        }
      : null;
  }
  const row = payload.new as Partial<CampaignMemberRow>;
  return row &&
    typeof row.campaign_id === "string" &&
    typeof row.user_id === "string"
    ? { kind: "upsert", row: row as CampaignMemberRow }
    : null;
}
