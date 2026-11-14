import * as Y from "yjs";

import {
  decodeNoteContent,
  encodeNoteContent,
} from "api-calls/notes/noteContent";

/**
 * Plain-text edge of the campaign outline (ticket #133): the outline lives
 * as Yjs bytes on the note server (base64 beside the note row, the same
 * format the server function decodes), while revision previews, Apply and
 * Undo all work in plain text. Encoding writes the text as the document's
 * body, the way the repo's note tests seed contents; decoding reads that
 * body back, so editor, server and versions all agree on the text.
 */

export function encodeOutlineText(text: string): string {
  if (!text || text.trim().length === 0) {
    throw new Error("An outline revision needs non-blank text.");
  }
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return encodeNoteContent(Y.encodeStateAsUpdate(doc));
}

export function decodeOutlineBytes(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) {
    return "";
  }
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
    return doc.getText("body").toString();
  } catch {
    return "";
  }
}

export function decodeOutlineContent(
  content: string | null | undefined
): string {
  if (!content) {
    return "";
  }
  try {
    return decodeOutlineBytes(decodeNoteContent(content));
  } catch {
    return "";
  }
}

/**
 * Returns fresh note-server bytes with the body text replaced, leaving
 * every other document root untouched. Pure: the data layer and the panel
 * both build replacements through here, so previews, Apply and Undo all
 * agree on the bytes the editor will read.
 */
export function replaceOutlineBodyText(
  bytes: Uint8Array | null | undefined,
  text: string
): Uint8Array {
  const doc = new Y.Doc();
  if (bytes && bytes.length > 0) {
    try {
      Y.applyUpdate(doc, bytes);
    } catch {
      // Undecodable bytes read as empty; the replacement still lands.
    }
  }
  doc.transact(() => {
    const body = doc.getText("body");
    body.delete(0, body.length);
    body.insert(0, text);
  });
  return Y.encodeStateAsUpdate(doc);
}
