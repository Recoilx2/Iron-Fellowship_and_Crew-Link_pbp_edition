import type { Roll } from "types/DieRolls.type";

export type ChannelKind = "IC" | "OOC";

export interface ChannelDocument {
  name: string;
  kind: ChannelKind;
  isStarting: boolean;
  archived: boolean;
}

/**
 * A post in a channel: text, a roll, or both. The speaker is one of the
 * author's characters in the campaign (in character) or nobody (posting as
 * themselves, the GM included). Images, threads, whispers, edits and soft
 * deletes all extend this shape in later tickets; nothing here may change
 * its meaning.
 */
export interface PostDocument {
  channelId: string;
  authorId: string;
  /** The speaking character, or null when posting as self. */
  speakerCharacterId: string | null;
  text: string;
  /**
   * The attached roll in the app's existing roll shape (dice immutable),
   * or null for a text-only post. A roll-only post carries empty text.
   */
  roll: Roll | null;
  /** GM-only roll posts reach GMs alone; text-only posts stay open. */
  gmsOnly: boolean;
  createdAt: string;
}
