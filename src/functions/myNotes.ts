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
  // The campaign outline is edited in the assistant panel's Outline tab,
  // never in a notes list: not even its author sees it under My notes.
  // (Players cannot read the outline at all: the access rules hide it, so
  // it never reaches this filter for them.)
  if (note.kind === "outline") {
    return false;
  }
  if (!owner.uid) {
    return false;
  }
  if (source === NoteSource.Character) {
    return owner.characterOwnerUid === owner.uid;
  }
  return note.authorId === owner.uid;
}
