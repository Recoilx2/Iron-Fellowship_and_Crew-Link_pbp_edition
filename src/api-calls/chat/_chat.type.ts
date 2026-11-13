export type ChannelKind = "IC" | "OOC";

export interface ChannelDocument {
  name: string;
  kind: ChannelKind;
  isStarting: boolean;
  archived: boolean;
}

/**
 * A text post in a channel. The speaker is one of the author's characters
 * in the campaign (in character) or nobody (posting as themselves, the GM
 * included). Rolls, threads, whispers, edits and soft deletes extend this
 * shape in later tickets; images arrived here, as storage paths in the
 * chat-images bucket beside the text (#28).
 */
export interface PostDocument {
  channelId: string;
  authorId: string;
  /** The speaking character, or null when posting as self. */
  speakerCharacterId: string | null;
  text: string;
  /** Storage paths of the post's image attachments, oldest-first. */
  imagePaths: string[];
  createdAt: string;
}
