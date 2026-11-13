import { describe, expect, it } from "vitest";
import { NoteSource } from "stores/notes/notes.slice.type";
import type { Note } from "types/Notes.type";
import { isMyNote } from "../myNotes";

function note(overrides: Partial<Note> = {}): Note {
  return {
    noteId: "note-1",
    title: "Note",
    order: 0,
    shared: false,
    ...overrides,
  };
}

describe("isMyNote", () => {
  it("keeps my private character notes", () => {
    expect(
      isMyNote(NoteSource.Character, note({ shared: false }), {
        uid: "player-1",
        characterOwnerUid: "player-1",
      })
    ).toBe(true);
  });

  it("keeps my shared character notes", () => {
    expect(
      isMyNote(NoteSource.Character, note({ shared: true }), {
        uid: "player-1",
        characterOwnerUid: "player-1",
      })
    ).toBe(true);
  });

  it("keeps campaign notes I authored, private or shared", () => {
    expect(
      isMyNote(
        NoteSource.Campaign,
        note({ shared: false, authorId: "player-1" }),
        { uid: "player-1" }
      )
    ).toBe(true);
    expect(
      isMyNote(NoteSource.Campaign, note({ shared: true, authorId: "player-1" }), {
        uid: "player-1",
      })
    ).toBe(true);
  });

  it("drops campaign notes authored by someone else, even shared ones", () => {
    expect(
      isMyNote(NoteSource.Campaign, note({ shared: true, authorId: "gm-1" }), {
        uid: "player-1",
      })
    ).toBe(false);
  });

  it("drops character notes when the open character is not mine", () => {
    expect(
      isMyNote(NoteSource.Character, note({ shared: true }), {
        uid: "player-1",
        characterOwnerUid: "player-2",
      })
    ).toBe(false);
  });

  it("drops character notes when no character is open", () => {
    expect(
      isMyNote(NoteSource.Character, note({ shared: true }), {
        uid: "player-1",
        characterOwnerUid: undefined,
      })
    ).toBe(false);
  });

  it("drops legacy campaign notes with no recorded author", () => {
    expect(
      isMyNote(NoteSource.Campaign, note({ shared: true, authorId: null }), {
        uid: "player-1",
      })
    ).toBe(false);
  });

  it("keeps nothing when nobody is signed in", () => {
    expect(
      isMyNote(NoteSource.Character, note({ shared: false }), {
        uid: undefined,
        characterOwnerUid: undefined,
      })
    ).toBe(false);
    expect(
      isMyNote(NoteSource.Campaign, note({ shared: false }), {
        uid: undefined,
      })
    ).toBe(false);
  });
});
