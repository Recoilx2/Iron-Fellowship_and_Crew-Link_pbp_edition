import { NoteSource } from "stores/notes/notes.slice.type";

/**
 * The id the note editor carries: the note source plus its row id. Split on
 * the first dash only: row ids are uuids, which contain dashes themselves.
 */
export function constructNoteId(source: NoteSource, id: string): string {
  return `${source}-${id}`;
}

export function parseNoteId(noteId: string): {
  source: NoteSource;
  id: string;
} {
  const dash = noteId.indexOf("-");
  return {
    source: noteId.slice(0, dash) as NoteSource,
    id: noteId.slice(dash + 1),
  };
}
