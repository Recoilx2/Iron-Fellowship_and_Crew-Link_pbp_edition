export type ChannelKind = "IC" | "OOC";

export interface ChannelDocument {
  name: string;
  kind: ChannelKind;
  isStarting: boolean;
  archived: boolean;
}

/**
 * A text post in a channel. The speaker is one of the author's characters
 * in the campaign (in character), one of the campaign world's NPCs (a GM
 * voice), or nobody (posting as themselves, the GM included). One voice per
 * post: never both a character and an NPC. Rolls, images, threads and
 * whispers extend this shape in later tickets; nothing here may change its
 * meaning. Edits stamp editedAt and show the new text with an edited
 * marker; a soft delete clears the text and stamps deletedAt, keeping the
 * row so the feed shows a "post deleted" marker. Rows are never
 * hard-deleted: under postgres_changes a SQL DELETE bypasses row-level
 * security, so deletes stay UPDATEs the access rules can filter per reader.
 */
export interface PostDocument {
  channelId: string;
  authorId: string;
  /** The speaking character, or null when posting as self or as an NPC. */
  speakerCharacterId: string | null;
  /** The speaking NPC from the campaign's world, or null otherwise. */
  speakerNpcId: string | null;
  text: string;
  createdAt: string;
  /** When the author changed the text after posting, or null. */
  editedAt: string | null;
  /** When the post was soft-deleted (its text cleared), or null. */
  deletedAt: string | null;
}
