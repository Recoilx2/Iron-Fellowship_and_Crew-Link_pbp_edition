import { Box } from "@mui/material";
import { useIsMobile } from "hooks/useIsMobile";
import { useCallback } from "react";
import { useStore } from "stores/store";
import { NoteSource } from "stores/notes/notes.slice.type";
import type { Note } from "types/Notes.type";
import { Notes } from "components/features/charactersAndCampaigns/Notes/Notes";
import { isMyNote } from "functions/myNotes";

/**
 * My notes (spec #9, ticket #31): the player's own notes, private and
 * shared, one step from chat. Campaign notes are kept by authorship;
 * character notes are kept when the open character is the player's own.
 * The shared roll log is never part of My notes.
 */
export function MyNotesTab() {
  const isMobile = useIsMobile();

  const uid = useStore((store) => store.auth.uid);
  const characterOwnerUid = useStore(
    (store) => store.characters.currentCharacter.currentCharacter?.uid
  );

  const notesFilter = useCallback(
    (source: NoteSource, note: Note) =>
      isMyNote(source, note, { uid, characterOwnerUid }),
    [uid, characterOwnerUid]
  );

  return (
    <Box height={"100%"}>
      <Notes hideRollLog notesFilter={notesFilter} condensedView={isMobile} />
    </Box>
  );
}
