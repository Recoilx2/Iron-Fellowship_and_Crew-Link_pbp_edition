import * as Y from "yjs";
import { TiptapTransformer } from "@hocuspocus/transformer";

import {
  decodeNoteContent,
  encodeNoteContent,
} from "api-calls/notes/noteContent";

/**
 * Plain-text edge of the campaign outline (ticket #133): the outline lives
 * as Yjs bytes on the note server (base64 beside the note row, the same
 * format the server function decodes), while revision previews, Apply and
 * Undo all work in plain text.
 *
 * The shared note editor binds its content to the TipTap `default`
 * fragment (the collaboration extension's default field), so that is
 * where real outline text lives; the plain `body` text only carries text
 * in fixtures that seed bytes by hand. Reads prefer the `default`
 * fragment and fall back to `body`; writes replace the `default`
 * fragment with the same delete-plus-insert surgery a collaborating
 * client performs, so open editors (including co-GMs') converge on the
 * new text through the usual sync instead of showing old and new text
 * side by side. Recomputing bytes from anything but the stored bytes
 * would merge as duplicated text, so Apply and Undo always read the row
 * first.
 */

function tipTapDocument(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

function inlineText(node: unknown): string {
  if (Array.isArray(node)) {
    return node.map(inlineText).join("");
  }
  if (node && typeof node === "object") {
    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") {
      return record.text;
    }
    if (Array.isArray(record.content)) {
      return inlineText(record.content);
    }
  }
  return "";
}

function tipTapText(json: unknown): string {
  const content = (json as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) {
    return inlineText(json);
  }
  return content.map(inlineText).join("\n");
}

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
    const tipTap = tipTapText(TiptapTransformer.fromYdoc(doc, "default"));
    if (tipTap.trim().length > 0) {
      return tipTap;
    }
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
 * Returns fresh note-server bytes with the outline text replaced,
 * leaving every other document root untouched. Pure: the data layer
 * builds replacements through here, so previews, Apply and Undo all
 * agree on the bytes the editor will read.
 */
export function replaceOutlineContent(
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
  const built = TiptapTransformer.toYdoc(tipTapDocument(text), "default");
  const fresh = built.getXmlFragment("default").toArray();
  doc.transact(() => {
    const body = doc.getText("body");
    body.delete(0, body.length);
    const fragment = doc.getXmlFragment("default");
    fragment.delete(0, fragment.length);
    for (const child of fresh) {
      fragment.push([
        (child as unknown as { clone: () => Y.XmlElement | Y.XmlText }).clone(),
      ]);
    }
  });
  return Y.encodeStateAsUpdate(doc);
}
