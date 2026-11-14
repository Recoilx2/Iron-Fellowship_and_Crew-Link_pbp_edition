export interface Note {
  noteId: string;

  title: string;
  order: number;
  shared: boolean;
  /**
   * Author of a campaign note (the row's created_by), used by My notes to
   * keep only the player's own. Character notes leave this unset: their
   * owner is the character's owner.
   */
  authorId?: string | null;
}
