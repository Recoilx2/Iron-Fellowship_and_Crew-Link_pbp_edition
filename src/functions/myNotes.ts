import type { Note } from "types/Notes.type";
import { NoteSource } from "stores/notes/notes.slice.type";

export interface MyNotesOwner {
  uid?: string;
  characterOwnerUid?: string;
}

/**
 * My notes (spec #9, ticket #31) shows only the player's own notes: the
 * notes on their own character, private and shared, plus the campaign notes
 * they authored. Anything the row-level policies hide from them never
 * reaches this filter; it only drops other people's notes the player is
 * allowed to see (shared notes).
 */
export function isMyNote(
  source: NoteSource,
  note: Note,
  owner: MyNotesOwner
): boolean {
  if (!owner.uid) {
    return false;
  }
  if (source === NoteSource.Character) {
    return owner.characterOwnerUid === owner.uid;
  }
  return note.authorId === owner.uid;
}
