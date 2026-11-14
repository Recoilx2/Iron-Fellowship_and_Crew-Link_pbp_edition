import { getSupabaseClient } from "config/supabase.config";
import { createApiFunction } from "api-calls/createApiFunction";
import { CHAT_POSTS_TABLE } from "./_postRef";
import { ROLL_TYPE } from "types/DieRolls.type";
import {
  burnMomentumResult,
  isMomentumBurnUseful,
} from "functions/momentumBurn";

/**
 * Burns momentum on the author's own posted action roll (spec #9, ticket
 * #125). The dice stay unchangeable: the database's roll lock gains one
 * narrow exception for this call -- the author records a single momentum
 * burn together with the recalculated outcome and nothing else -- and
 * refuses every other roll change, a second burn, burns by anyone else,
 * burns on deleted posts and burns on NPC or GM-self voices. The
 * character's momentum resets the same way as a burn from the sheet, and
 * the burned result arrives live as a post update, GM-only staying
 * GM-only.
 */
export const burnPostMomentum = createApiFunction<{ postId: string }, void>(
  async (params) => {
    const { postId } = params;
    if (!postId) {
      throw new Error("A post is required to burn momentum.");
    }
    const client = getSupabaseClient();
    const { data: sessionData, error: sessionError } =
      await client.auth.getSession();
    const authorId = sessionData.session?.user.id;
    if (sessionError || !authorId) {
      throw sessionError ?? new Error("You must be logged in to burn momentum.");
    }

    const { data: postRow, error: postError } = await client
      .from(CHAT_POSTS_TABLE)
      .select(
        "id,author_id,speaker_character_id,speaker_npc_id,deleted_at,roll,gms_only"
      )
      .eq("id", postId)
      .single();
    if (postError || !postRow) {
      throw postError ?? new Error("Post not found.");
    }
    const post = postRow as unknown as {
      author_id: string;
      speaker_character_id: string | null;
      speaker_npc_id: string | null;
      deleted_at: string | null;
      roll: Record<string, unknown> | null;
      gms_only: boolean;
    };
    if (post.deleted_at != null) {
      throw new Error("Deleted posts stay deleted.");
    }
    if (post.author_id !== authorId) {
      throw new Error("Only the author may burn momentum on a roll.");
    }
    if (post.speaker_character_id == null || post.speaker_npc_id != null) {
      throw new Error("Momentum burns only on your own character's roll.");
    }
    const stored = post.roll as unknown as {
      type?: number;
      result?: number;
      challenge1?: number;
      challenge2?: number;
      momentumBurned?: number;
      characterId?: string | null;
      uid?: string;
    } | null;
    if (!stored || stored.type !== ROLL_TYPE.STAT) {
      throw new Error("Only action rolls can burn momentum.");
    }
    if (stored.momentumBurned !== undefined) {
      throw new Error("Momentum is already burned on this roll.");
    }

    const { data: charRow, error: charError } = await client
      .from("characters")
      .select("id,owner_id,momentum,debilities")
      .eq("id", post.speaker_character_id)
      .single();
    if (charError || !charRow) {
      throw charError ?? new Error("Character not found.");
    }
    const character = charRow as unknown as {
      owner_id: string;
      momentum: number;
      debilities?: Record<string, boolean> | null;
    };
    if (character.owner_id !== authorId) {
      throw new Error("Only the author may burn momentum on a roll.");
    }
    const momentum = character.momentum ?? 0;

    // Reuse the sheet's burn rule: the same dice burn the same way
    // everywhere, and a burn that would change nothing is refused.
    const rollForCheck = {
      ...stored,
      type: ROLL_TYPE.STAT,
      momentumBurned: undefined,
    } as never;
    if (!isMomentumBurnUseful(rollForCheck, momentum)) {
      throw new Error("Burning momentum would not change this roll.");
    }
    const newResult = burnMomentumResult(
      { ...stored, type: ROLL_TYPE.STAT } as never,
      momentum
    );

    const debilities = character.debilities ?? {};
    const active = Object.values(debilities).filter(Boolean).length;
    const resetValue = active >= 2 ? 0 : active === 1 ? 1 : 2;

    const burnedRoll = {
      ...stored,
      momentumBurned: momentum,
      result: newResult,
    };

    const { data: updated, error: updateError } = await client
      .from(CHAT_POSTS_TABLE)
      .update({ roll: burnedRoll })
      .eq("id", postId)
      .select("id");
    if (updateError || !updated || updated.length === 0) {
      throw updateError ?? new Error("Post not found.");
    }

    const { error: momentumError } = await client
      .from("characters")
      .update({ momentum: resetValue })
      .eq("id", post.speaker_character_id);
    if (momentumError) {
      throw momentumError;
    }
  },
  "Failed to burn momentum."
);
