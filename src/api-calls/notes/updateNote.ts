import { Bytes, setDoc, updateDoc } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import {
  constructCampaignNoteContentPath,
  constructCampaignNoteDocPath,
  constructCharacterNoteContentPath,
  constructCharacterNoteDocPath,
  getCampaignNoteContentDocument,
  getCampaignNoteDocument,
  getCharacterNoteContentDocument,
  getCharacterNoteDocument,
  CHARACTER_NOTES_TABLE,
  CHARACTER_NOTE_CONTENTS_TABLE,
} from "./_getRef";
import { encodeNoteContent } from "./noteContent";
import { createApiFunction } from "api-calls/createApiFunction";
import { projectId } from "config/firebase.config";

async function updateSupabaseNote(
  characterId: string,
  noteId: string,
  title: string,
  content?: Uint8Array
): Promise<void> {
  const client = getSupabaseClient();
  const { data: updated, error: titleError } = await client
    .from(CHARACTER_NOTES_TABLE)
    .update({ title })
    .eq("id", noteId)
    .eq("character_id", characterId)
    .select("id");
  if (titleError || !updated || updated.length === 0) {
    throw titleError ?? new Error("Note not found");
  }
  if (content) {
    const { error: contentError } = await client
      .from(CHARACTER_NOTE_CONTENTS_TABLE)
      .upsert(
        { note_id: noteId, content: encodeNoteContent(content) },
        { onConflict: "note_id" }
      );
    if (contentError) {
      throw contentError;
    }
  }
}

function updateFirebaseNote(params: {
  campaignId: string | undefined;
  characterId: string | undefined;
  noteId: string;
  title: string;
  content?: Uint8Array;
  isBeaconRequest?: boolean;
}): Promise<void> {
  const { campaignId, characterId, noteId, title, content, isBeaconRequest } =
    params;

  return new Promise((resolve, reject) => {
    const noteContentPath = characterId
      ? constructCharacterNoteContentPath(characterId, noteId)
      : constructCampaignNoteContentPath(campaignId as string, noteId);
    const noteDocPath = characterId
      ? constructCharacterNoteDocPath(characterId, noteId)
      : constructCampaignNoteDocPath(campaignId as string, noteId);

    // If we are making this call when closing the page, we want to use a fetch call with keepalive
    if (isBeaconRequest) {
      const contentPath = `projects/${projectId}/databases/(default)/documents${noteContentPath}`;
      const titlePath = `projects/${projectId}/databases/(default)/documents${noteDocPath}`;

      const token = window.sessionStorage.getItem("id-token") ?? "";

      if (content) {
        fetch(
          `https://firestore.googleapis.com/v1/${contentPath}?updateMask.fieldPaths=notes`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              name: contentPath,
              fields: {
                notes: {
                  bytesValue: Bytes.fromUint8Array(content).toBase64(),
                },
              },
            }),
            keepalive: true,
          }
        ).catch((e) => console.error(e));
      }
      fetch(
        `https://firestore.googleapis.com/v1/${titlePath}?updateMask.fieldPaths=title`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: titlePath,
            fields: {
              title: {
                stringValue: title,
              },
            },
          }),
          keepalive: true,
        }
      ).catch((e) => console.error(e));

      resolve();
    } else {
      const promises: Promise<unknown>[] = [];
      promises.push(
        updateDoc(
          characterId
            ? getCharacterNoteDocument(characterId, noteId)
            : getCampaignNoteDocument(campaignId as string, noteId),
          {
            title,
          }
        )
      );

      if (content) {
        promises.push(
          setDoc(
            characterId
              ? getCharacterNoteContentDocument(characterId, noteId)
              : getCampaignNoteContentDocument(campaignId as string, noteId),
            {
              notes: Bytes.fromUint8Array(content),
            },
            { merge: true }
          )
        );
      }

      Promise.all(promises)
        .then(() => {
          resolve();
        })
        .catch((e) => {
          reject(e);
        });
    }
  });
}

export const updateNote = createApiFunction<
  {
    campaignId: string | undefined;
    characterId: string | undefined;
    noteId: string;
    title: string;
    content?: Uint8Array;
    isBeaconRequest?: boolean;
  },
  void
>(async (params) => {
  const { campaignId, characterId, noteId, title, content, isBeaconRequest } =
    params;

  if (!campaignId && !characterId) {
    throw new Error("Either campaign or character ID must be defined.");
  }

  // Campaign notes stay on Firebase until the notes ticket ports them.
  if (!characterId) {
    return updateFirebaseNote(params);
  }
  if (isBeaconRequest) {
    // Best effort: the normal save fires without blocking page unload.
    // Server-saved shared editing (notes ticket) removes the need for this.
    void updateSupabaseNote(characterId, noteId, title, content).catch((e) =>
      console.error(e)
    );
    return;
  }
  await updateSupabaseNote(characterId, noteId, title, content);
}, "Failed to update note.");
