import { describe, expect, it } from "vitest";

import { NoteSource } from "stores/notes/notes.slice.type";
import { constructNoteId, parseNoteId } from "./noteIds";

describe("note ids", () => {
  it("round-trips uuid note ids through the editor id", () => {
    const uuid = "44444444-4444-4444-4444-444444444444";
    expect(parseNoteId(constructNoteId(NoteSource.Character, uuid))).toEqual({
      source: NoteSource.Character,
      id: uuid,
    });
    expect(parseNoteId(constructNoteId(NoteSource.Campaign, uuid))).toEqual({
      source: NoteSource.Campaign,
      id: uuid,
    });
  });

  it("splits on the first dash only", () => {
    expect(parseNoteId("character-abc-def")).toEqual({
      source: NoteSource.Character,
      id: "abc-def",
    });
  });
});
