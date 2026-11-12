import { describe, expect, it, vi, afterEach } from "vitest";

import {
  getCampaignNoteDocumentName,
  getCharacterNoteDocumentName,
  getHocuspocusUrl,
  getWorldDescriptionDocumentName,
  getWorldNoteDocumentName,
} from "config/hocuspocus.config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getHocuspocusUrl", () => {
  it("derives the websocket gateway route from the Supabase URL", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:8000");
    expect(getHocuspocusUrl()).toBe("ws://localhost:8000/hocuspocus");
  });

  it("keeps https as a secure websocket and drops trailing slashes", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://notes.example.com///");
    expect(getHocuspocusUrl()).toBe("wss://notes.example.com/hocuspocus");
  });

  it("fails loudly when the stack URL is missing", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(() => getHocuspocusUrl()).toThrow();
  });
});

describe("note document names", () => {
  const noteId = "33333333-3333-3333-3333-333333333333";

  it("names character note documents in the character-notes scope", () => {
    expect(getCharacterNoteDocumentName(noteId)).toBe(
      `character-notes/${noteId}`
    );
  });

  it("names campaign note documents in the campaign-notes scope", () => {
    expect(getCampaignNoteDocumentName(noteId)).toBe(
      `campaign-notes/${noteId}`
    );
  });

  it("names world note documents in the world-notes scope", () => {
    expect(getWorldNoteDocumentName(noteId)).toBe(`world-notes/${noteId}`);
  });

  it("names world descriptions in the world-descriptions scope", () => {
    expect(getWorldDescriptionDocumentName(noteId)).toBe(
      `world-descriptions/${noteId}`
    );
  });
});
