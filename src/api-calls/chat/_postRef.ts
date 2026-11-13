import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import type { PostDocument } from "api-calls/chat/_chat.type";

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
  text: string;
  image_paths: string[];
  created_at: string;
  updated_at: string;
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
    text: row.text,
    imagePaths: row.image_paths ?? [],
    createdAt: row.created_at,
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
