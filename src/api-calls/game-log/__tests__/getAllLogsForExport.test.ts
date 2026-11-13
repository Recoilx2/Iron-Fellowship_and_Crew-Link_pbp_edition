import { describe, expect, it } from "vitest";

import {
  characterRollRowToExportRecord,
  type CharacterRollRow,
} from "../_getRef";

function makeRow(overrides: Partial<CharacterRollRow> = {}): CharacterRollRow {
  return {
    id: "log-1",
    character_id: "char-1",
    roll: { type: 0, timestamp: "2026-05-30T05:00:00.000Z", gmsOnly: false },
    gms_only: false,
    created_at: "2026-05-30T05:00:00.000Z",
    updated_at: "2026-05-30T05:00:00.000Z",
    ...overrides,
  };
}

describe("character roll export", () => {
  it("exports the stored roll document untouched", () => {
    expect(characterRollRowToExportRecord(makeRow())).toEqual({
      id: "log-1",
      roll: {
        type: 0,
        timestamp: "2026-05-30T05:00:00.000Z",
        gmsOnly: false,
      },
    });
  });
});
