import { describe, expect, it } from "vitest";

import {
  characterRowToDocument,
  characterUpdateToColumns,
  type CharacterRow,
} from "api-calls/character/_getRef";
import { applyDocumentUpdate } from "api-calls/applyDocumentUpdate";

function makeRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: "char-1",
    owner_id: "user-1",
    campaign_id: null,
    world_id: null,
    name: "Del Nar",
    stats: { edge: 2 },
    condition_meters: { health: 3 },
    initiative_status: null,
    momentum: 2,
    special_tracks: {},
    experience: {},
    debilities: {},
    adds: null,
    profile_image: null,
    expansion_ids: [],
    custom_tracks: {},
    theme: null,
    created_at: "2026-11-12T00:00:00.000Z",
    updated_at: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("character row mapping", () => {
  it("reads a row as the app's character document", () => {
    const document = characterRowToDocument(
      makeRow({
        campaign_id: "camp-1",
        adds: 1,
        profile_image: {
          filename: "portrait.png",
          position: { x: 0, y: 0 },
          scale: 1,
        },
      })
    );

    expect(document).toEqual({
      uid: "user-1",
      campaignId: "camp-1",
      name: "Del Nar",
      stats: { edge: 2 },
      conditionMeters: { health: 3 },
      momentum: 2,
      adds: 1,
      profileImage: {
        filename: "portrait.png",
        position: { x: 0, y: 0 },
        scale: 1,
      },
    });
  });

  it("omits empty maps and links the app never set", () => {
    const document = characterRowToDocument(makeRow());

    expect(document.campaignId).toBeUndefined();
    expect(document.conditionMeters).toEqual({ health: 3 });
    expect(document.specialTracks).toBeUndefined();
    expect(document.expansionIds).toBeUndefined();
  });

  it("merges dotted paths without losing siblings", () => {
    expect(
      applyDocumentUpdate(
        { conditionMeters: { health: 3, spirit: 2 } },
        { "conditionMeters.health": 5 }
      )
    ).toEqual({ conditionMeters: { health: 5, spirit: 2 } });
  });

  it("converts an app update to row columns, touching only named fields", () => {
    const columns = characterUpdateToColumns(makeRow(), {
      "conditionMeters.health": 1,
      momentum: 4,
    });

    expect(columns).toEqual({ condition_meters: { health: 1 }, momentum: 4 });
  });

  it("clears the portrait when the app nulls it", () => {
    const columns = characterUpdateToColumns(
      makeRow({
        profile_image: {
          filename: "old.png",
          position: { x: 0, y: 0 },
          scale: 1,
        },
      }),
      { profileImage: null }
    );

    expect(columns).toEqual({ profile_image: null });
  });
});
