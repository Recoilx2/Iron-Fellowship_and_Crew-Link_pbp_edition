import { firestore } from "config/firebase.config";
import {
  collection,
  CollectionReference,
  doc,
  DocumentReference,
} from "firebase/firestore";
import { CharacterDocument } from "./_character.type";

/**
 * Transitional Firebase references for character documents. Campaigns, worlds
 * and homebrew still live on Firebase until their tickets port them, and a
 * few of their functions touch character documents. New character code must
 * not import from here; it uses the Supabase identifiers in `_getRef.ts`.
 * Ticket #24 deletes this file with the rest of Firebase.
 */

export function constructCharacterCollectionPath() {
  return `/characters`;
}

export function constructCharacterDocPath(characterId: string) {
  return `/characters/${characterId}`;
}

export function getCharacterCollection() {
  return collection(
    firestore,
    constructCharacterCollectionPath()
  ) as CollectionReference<CharacterDocument>;
}

export function getCharacterDoc(characterId: string) {
  return doc(
    firestore,
    constructCharacterDocPath(characterId)
  ) as DocumentReference<CharacterDocument>;
}
