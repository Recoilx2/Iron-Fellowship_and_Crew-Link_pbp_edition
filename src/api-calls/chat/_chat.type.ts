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
