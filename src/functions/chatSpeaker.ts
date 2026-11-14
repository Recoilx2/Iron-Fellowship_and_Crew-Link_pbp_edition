import type { ChannelKind } from "api-calls/chat/_chat.type";

export interface ChatSpeaker {
  /** The speaking character, or null when posting as self or as an NPC. */
  characterId: string | null;
  /** The speaking NPC from the campaign's world (GMs alone), or null. */
  npcId: string | null;
}

/**
 * Who the composer posts as before anyone picks a voice. Players have no
 * picker (one character per campaign): in an IC channel they post as their
 * campaign character, in an OOC channel as themselves. GMs start as
 * themselves, labelled GM, and pick an NPC voice from the campaign world's
 * NPC list in the composer.
 */
export function defaultChatSpeaker(
  channelKind: ChannelKind,
  myCharacterId: string | undefined
): ChatSpeaker {
  if (channelKind === "IC" && myCharacterId) {
    return { characterId: myCharacterId, npcId: null };
  }
  return { characterId: null, npcId: null };
}
