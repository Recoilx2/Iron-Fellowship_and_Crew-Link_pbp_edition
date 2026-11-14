import { describe, expect, it } from "vitest";

import {
  decodeOutlineBytes,
  decodeOutlineContent,
  encodeOutlineText,
} from "./outlineText";

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
});

function decodeOutlineBytesForTest(content: string): string {
  return decodeOutlineContent(content);
}
