import { describe, expect, it } from "vitest";

import {
  applyContentUpdate,
  toContentData,
  toContentDoc,
} from "api-calls/homebrew/_supabase";

describe("toContentDoc", () => {
  it("lifts the collection id onto the composed document", () => {
    expect(
      toContentDoc({
        id: "row-id",
        collection_id: "collection-id",
        data: { label: "Iron", dataswornId: "iron" },
        updated_at: "2026-01-01T00:00:00Z",
      })
    ).toEqual({ label: "Iron", dataswornId: "iron", collectionId: "collection-id" });
  });
});

describe("toContentData", () => {
  it("strips the collection id and row id back off the document", () => {
    expect(
      toContentData({
        label: "Iron",
        dataswornId: "iron",
        collectionId: "collection-id",
      })
    ).toEqual({ label: "Iron", dataswornId: "iron" });
  });
});

describe("applyContentUpdate", () => {
  it("merges top-level fields", () => {
    expect(
      applyContentUpdate({ label: "Old", value: 1 }, { label: "New" })
    ).toEqual({ label: "New", value: 1 });
  });

  it("applies dotted paths into nested maps", () => {
    expect(
      applyContentUpdate(
        { contents: { iron: { label: "Iron" } } },
        { "contents.edge.label": "Edge" }
      )
    ).toEqual({
      contents: { iron: { label: "Iron" }, edge: { label: "Edge" } },
    });
  });

  it("deletes nested entries when the update value is undefined", () => {
    expect(
      applyContentUpdate(
        { contents: { iron: { label: "Iron" } }, parent: "keep" },
        { "contents.iron": undefined, parent: undefined }
      )
    ).toEqual({ contents: {} });
  });

  it("replaces arrays wholesale", () => {
    expect(applyContentUpdate({ rows: [1, 2] }, { rows: [3] })).toEqual({
      rows: [3],
    });
  });
});
