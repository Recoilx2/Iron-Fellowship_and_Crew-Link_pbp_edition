import type { ChannelKind, ChannelVisibility } from "api-calls/chat/_chat.type";

export interface ChatNameLine {
  /** The bold lead of the name line: the speaker, or the author. */
  title: string;
  /** The smaller name beside the lead, when there is one. */
  subtitle?: string;
  /** Whether the GM tag follows the names. */
  showGM: boolean;
}

/**
 * The feed's name line for one post (spec #9, prototype variant D). An NPC
 * voice leads with the NPC, then the GM behind it, in any channel.
 * Otherwise in-character posts lead with the speaking character, then the
 * player. Out-of-character posts and direct messages lead with the author's
 * display name, then their campaign character beside it: posting as self
 * names no speaker, so the character is looked up by author, and authors
 * with no campaign character show no second name. GMs carry the GM tag.
 */
export function resolveChatNameLine(params: {
  channel: { kind: ChannelKind; visibility: ChannelVisibility };
  post: {
    authorId: string;
    speakerCharacterId: string | null;
    speakerNpcId: string | null;
  };
  characterMap: Record<string, { uid: string; name: string }>;
  /** The speaking NPC's name, when the post voices one. */
  npcName?: string;
  authorName: string;
  isGM: boolean;
}): ChatNameLine {
  const { channel, post, characterMap, npcName, authorName, isGM } = params;
  if (npcName) {
    return { title: npcName, subtitle: authorName, showGM: isGM };
  }
  if (channel.kind === "IC" && channel.visibility !== "dm") {
    const character =
      post.speakerCharacterId != null
        ? characterMap[post.speakerCharacterId]
        : undefined;
    return {
      title: character?.name ?? authorName,
      subtitle: character ? authorName : undefined,
      showGM: isGM,
    };
  }
  const authorCharacter = Object.values(characterMap).find(
    (character) => character.uid === post.authorId
  );
  return {
    title: authorName,
    subtitle: authorCharacter?.name,
    showGM: isGM,
  };
}
