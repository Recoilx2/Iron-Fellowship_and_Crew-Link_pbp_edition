import type { Roll } from "types/DieRolls.type";

export type ChannelKind = "IC" | "OOC";

/**
 * Who a channel belongs to: every campaign member (public, including the
 * two starting channels), its roster plus the campaign's GMs (private),
 * or its two members alone (dm, blind even to GMs who are not in it).
 */
export type ChannelVisibility = "public" | "private" | "dm";

export interface ChannelDocument {
  name: string;
  kind: ChannelKind;
  visibility: ChannelVisibility;
  isStarting: boolean;
  archived: boolean;
}

/**
 * A post in a channel: text, a roll, or both. The speaker is one of the
 * author's characters in the campaign (in character), one of the campaign
 * world's NPCs (a GM voice), or nobody (posting as themselves, the GM
 * included). One voice per post: never both a character and an NPC. Images
 * ride along as storage paths in the chat-images bucket beside the text
 * (#28). Threads and whispers extend this shape in later tickets; nothing
 * here may change its meaning. Edits stamp editedAt and show the new text
 * with an edited marker; a soft delete clears the text and stamps
 * deletedAt, keeping the row so the feed shows a "post deleted" marker.
 * Rows are never hard-deleted: under postgres_changes a SQL DELETE
 * bypasses row-level security, so deletes stay UPDATEs the access rules
 * can filter per reader.
 */
export interface PostDocument {
  channelId: string;
  authorId: string;
  /** The speaking character, or null when posting as self or as an NPC. */
  speakerCharacterId: string | null;
  /** The speaking NPC from the campaign's world, or null otherwise. */
  speakerNpcId: string | null;
  text: string;
  /** Storage paths of the post's image attachments, oldest-first. */
  imagePaths: string[];
  /**
   * The attached roll in the app's existing roll shape (dice immutable),
   * or null for a text-only post. A roll-only post carries empty text.
   */
  roll: Roll | null;
  /** GM-only roll posts reach GMs alone; text-only posts stay open. */
  gmsOnly: boolean;
  createdAt: string;
  /** When the author changed the text after posting, or null. */
  editedAt: string | null;
  /** When the post was soft-deleted (its text cleared), or null. */
  deletedAt: string | null;
}
