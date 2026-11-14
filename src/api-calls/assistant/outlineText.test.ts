import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { TiptapTransformer } from "@hocuspocus/transformer";

import { encodeNoteContent } from "api-calls/notes/noteContent";
import {
  decodeOutlineBytes,
  decodeOutlineContent,
  encodeOutlineText,
  replaceOutlineContent,
} from "./outlineText";

function editorBytes(text: string): Uint8Array {
  const doc = TiptapTransformer.toYdoc(
    {
      type: "doc",
      content: text.split("\n").map((line) => ({
        type: "paragraph",
        content: line ? [{ type: "text", text: line }] : [],
      })),
    },
    "default"
  );
  return Y.encodeStateAsUpdate(doc);
}

function editorText(bytes: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const json = TiptapTransformer.fromYdoc(doc, "default") as {
    content?: Array<{ content?: Array<{ text?: string }> }>;
  };
  return (
    json.content
      ?.map(
        (block) => block.content?.map((span) => span.text ?? "").join("") ?? ""
      )
      .join("\n") ?? ""
  );
}

// Seam under test: the outline's plain-text edge. The outline lives as Yjs
// bytes on the note server (base64 beside the note row); revisions preview,
// apply and undo all work in plain text, so encode and decode must round
// trip exactly what the editor and the server function read.
describe("outline text encoding", () => {
  it("round trips plain text through the note-server bytes", () => {
    const text = "Act one: the bell rings.\nAct two: a betrayal.";
    const bytes = decodeOutlineBytesForTest(encodeOutlineText(text));
    expect(bytes).toBe(text);
  });

  it("decodes what the server function reads to the same text", () => {
    const text = "The harbor wakes before dawn.";
    expect(decodeOutlineContent(encodeOutlineText(text))).toBe(text);
  });

  it("reads empty and undecodable contents as empty, never as an error", () => {
    expect(decodeOutlineContent(null)).toBe("");
    expect(decodeOutlineContent(undefined)).toBe("");
    expect(decodeOutlineContent("!!! not base64 !!!")).toBe("");
    expect(decodeOutlineBytes(new Uint8Array([]))).toBe("");
    expect(decodeOutlineBytes(new Uint8Array([1, 2, 3]))).toBe("");
  });

  it("refuses to encode blank text", () => {
    expect(() => encodeOutlineText("   ")).toThrow();
  });

  it("decodes the editor's TipTap fragment, not just hand-seeded body text", () => {
    const text = "Act one: the bell rings.\nAct two: a betrayal.";
    expect(decodeOutlineBytes(editorBytes(text))).toBe(text);
  });

  it("replaces the editor fragment so open editors converge", () => {
    const replaced = replaceOutlineContent(
      editorBytes("Act one: the bell rings."),
      "Act one revised: the bell cracks."
    );
    expect(decodeOutlineBytes(replaced)).toBe(
      "Act one revised: the bell cracks."
    );
    // The hand-seeded body is cleared too, so the server's scan of the
    // row sees exactly the replacement.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, replaced);
    expect(doc.getText("body").toString()).toBe("");
    expect(editorText(replaced)).toBe("Act one revised: the bell cracks.");
  });

  it("replaces onto empty bytes", () => {
    expect(decodeOutlineBytes(replaceOutlineContent(null, "Fresh plan."))).toBe(
      "Fresh plan."
    );
  });

  it("round trips replaced editor bytes through the note-server encoding", () => {
    const text = "The harbor wakes before dawn.";
    const bytes = replaceOutlineContent(editorBytes("Something old."), text);
    expect(decodeOutlineContent(encodeNoteContent(bytes))).toBe(text);
  });
});

function decodeOutlineBytesForTest(content: string): string {
  return decodeOutlineContent(content);
}
