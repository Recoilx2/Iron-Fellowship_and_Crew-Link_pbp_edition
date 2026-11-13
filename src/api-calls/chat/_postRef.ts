import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type { PostDocument } from "api-calls/chat/_chat.type";
import type { Roll } from "types/DieRolls.type";

/**
 * Identifiers and row mapping for chat posts. The data layer is the only
 * place that names the posts table, the live-update channel and the
 * channel filter; stores, tabs and components stay backend-free.
 */

export const CHAT_POSTS_TABLE = "chat_posts";

export interface PostRow {
  id: string;
  channel_id: string;
  author_id: string;
  speaker_character_id: string | null;
  speaker_npc_id: string | null;
  text: string;
  image_paths: string[];
  /** The roll in its existing shape with an ISO timestamp, or null. */
  roll: Record<string, unknown> | null;
  gms_only: boolean;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export function constructChannelPostsChannelName(channelId: string): string {
  return `channel-posts:${channelId}`;
}

export function constructChannelPostsFilter(channelId: string): string {
  return `channel_id=eq.${channelId}`;
}

export function postRowToDocument(row: PostRow): PostDocument {
  return {
    channelId: row.channel_id,
    authorId: row.author_id,
    speakerCharacterId: row.speaker_character_id,
    speakerNpcId: row.speaker_npc_id,
    text: row.text,
    imagePaths: row.image_paths ?? [],
    roll: postRowToRoll(row.roll),
    gmsOnly: row.gms_only,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

/**
 * Reads a stored roll back into the app's existing roll shape: the same
 * dice and outcome, its timestamp a Date again for the roll card. A post
 * with no roll reads back null.
 */
export function postRowToRoll(
  stored: PostRow["roll"]
): PostDocument["roll"] {
  if (!stored) {
    return null;
  }
  const { timestamp, ...rest } = stored;
  return {
    ...(rest as unknown as Omit<Roll, "timestamp">),
    timestamp:
      typeof timestamp === "string" ? new Date(timestamp) : new Date(),
  } as Roll;
}

/**
 * Columns for inserting a post: text and image paths alongside the roll in
 * its existing shape with an ISO timestamp inside, exactly as the campaign
 * roll log stores it, plus the GM-only flag. Text-only posts store no roll.
 */
export function postDocumentToColumns(params: {
  text: string;
  imagePaths?: string[];
  roll?: Roll | null;
  gmsOnly?: boolean;
}): {
  text: string;
  image_paths: string[];
  roll: Record<string, unknown> | null;
  gms_only: boolean;
} {
  const { text, imagePaths, roll, gmsOnly } = params;
  return {
    text,
    image_paths: imagePaths ?? [],
    roll: roll
      ? { ...roll, timestamp: roll.timestamp.toISOString() }
      : null,
    gms_only: gmsOnly ?? false,
  };
}

export function postPayloadToChange(
  payload: PostgresChangePayload<PostRow>
): RowChange<PostRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<PostRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<PostRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as PostRow }
    : null;
}
