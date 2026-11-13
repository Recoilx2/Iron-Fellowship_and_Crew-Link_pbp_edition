import type { ChannelKind } from "api-calls/chat/_chat.type";

export interface ChatSpeaker {
  /** The speaking character, or null when posting as self. */
  characterId: string | null;
}

/**
 * Who the composer posts as. Players have no picker (one character per
 * campaign): in an IC channel they post as their campaign character, in an
 * OOC channel as themselves. GMs always post as themselves, labelled GM.
 * NPC voices arrive in a later ticket.
 */
export function defaultChatSpeaker(
  channelKind: ChannelKind,
  myCharacterId: string | undefined
): ChatSpeaker {
  if (channelKind === "IC" && myCharacterId) {
    return { characterId: myCharacterId };
  }
  return { characterId: null };
}
