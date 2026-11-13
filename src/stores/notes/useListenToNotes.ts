import { Unsubscribe } from "api-calls/helpers.type";
import { useEffect } from "react";
import { useStore } from "stores/store";
import { ROLL_LOG_ID } from "./notes.slice.type";

export function useListenToNotes() {
  const campaignId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaignId
  );
  const characterId = useStore(
    (store) => store.characters.currentCharacter.currentCharacterId
  );

  const openNote = useStore((store) => store.notes.openNote);

  const subscribe = useStore((store) => store.notes.subscribe);
  const subscribeToNoteContent = useStore(
    (store) => store.notes.subscribeToNoteContent
  );

  useEffect(() => {
    const unsubscribe = subscribe(campaignId, characterId);

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [campaignId, characterId, subscribe]);

  useEffect(() => {
    let unsubscribe: Unsubscribe;

    if (openNote && openNote !== ROLL_LOG_ID) {
      subscribeToNoteContent(openNote);
    }

    return () => {
      unsubscribe && unsubscribe();
    };
  }, [openNote, subscribeToNoteContent]);
}
