import { describe, expect, it } from "vitest";

import {
  decodeNoteContent,
  encodeNoteContent,
} from "api-calls/notes/noteContent";

describe("note content encoding", () => {
  it("round-trips editor bytes through text", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 13, 10, 65]);
    expect(decodeNoteContent(encodeNoteContent(bytes))).toEqual(bytes);
  });

  it("round-trips an empty update", () => {
    expect(decodeNoteContent(encodeNoteContent(new Uint8Array()))).toEqual(
      new Uint8Array()
    );
  });
});
