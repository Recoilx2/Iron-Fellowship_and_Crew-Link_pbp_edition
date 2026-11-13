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
 * included). Rolls, images, threads, whispers, edits and soft deletes all
 * extend this shape in later tickets; nothing here may change its meaning.
 */
export interface PostDocument {
  channelId: string;
  authorId: string;
  /** The speaking character, or null when posting as self. */
  speakerCharacterId: string | null;
  text: string;
  createdAt: string;
}
