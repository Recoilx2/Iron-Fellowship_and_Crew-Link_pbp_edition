import { describe, expect, it } from "vitest";

import {
  constructUserWorldsChannelName,
  constructWorldChannelName,
  worldPayloadToChange,
  worldRowToDocument,
  worldUpdateToColumns,
  type WorldRow,
} from "api-calls/world/_getRef";
import { encodeNoteContent } from "api-calls/notes/noteContent";

function makeRow(overrides: Partial<WorldRow> = {}): WorldRow {
  return {
    id: "world-1",
    setting_key: "ironlands",
    name: "Ironlands",
    description: null,
    new_truths: {},
    owner_ids: ["user-1"],
    created_at: "2026-11-12T00:00:00.000Z",
    updated_at: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("world row mapping", () => {
  it("maps a row to the document stores read", () => {
    expect(worldRowToDocument(makeRow())).toMatchObject({
      settingKey: "ironlands",
      name: "Ironlands",
      ownerIds: ["user-1"],
    });
  });

  it("decodes the description bytes for a fresh editor document", () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const doc = worldRowToDocument(
      makeRow({ description: encodeNoteContent(bytes) })
    );
    expect(doc.worldDescription).toEqual(bytes);
  });

  it("omits empty truths and a missing description", () => {
    const doc = worldRowToDocument(makeRow());
    expect(doc.worldDescription).toBeUndefined();
    expect(doc.newTruths).toBeUndefined();
  });

  it("converts app-level updates into row columns", () => {
    expect(
      worldUpdateToColumns({ name: "Renamed", settingKey: "the_forge" })
    ).toEqual({ name: "Renamed", setting_key: "the_forge" });
  });

  it("opens private channels per person and per world", () => {
    expect(constructUserWorldsChannelName("user-1")).toBe(
      "user-worlds:user-1"
    );
    expect(constructWorldChannelName("world-1")).toBe("world:world-1");
  });

  it("turns row events into upserts and removals", () => {
    expect(
      worldPayloadToChange({
        eventType: "INSERT",
        new: makeRow(),
        old: null,
      })
    ).toMatchObject({ kind: "upsert" });
    expect(
      worldPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { id: "world-1" },
      })
    ).toEqual({ kind: "remove", key: "world-1" });
  });
});
