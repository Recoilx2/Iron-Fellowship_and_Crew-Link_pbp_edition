import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyOutlineRevision,
  listOutlineVersions,
  undoOutlineRevision,
} from "./outlineVersions";
import { ASSISTANT_OUTLINE_VERSIONS_TABLE } from "./_getRef";
import { CAMPAIGN_NOTE_CONTENTS_TABLE } from "api-calls/notes/_getRef";
import { getSupabaseClient } from "config/supabase.config";
import { decodeOutlineContent } from "./outlineText";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: the outline version history behind Apply and Undo.
// Apply keeps the replaced text as a GM-only version, then replaces the
// outline contents; Undo restores the latest kept text and drops that
// version. The access rules behind the writes are covered by the live
// tests; here the client is a stub.
const state = {
  inserted: [] as Array<Record<string, unknown>>,
  upsertedContents: [] as Array<Record<string, unknown>>,
  deleted: [] as Array<Record<string, unknown>>,
  deleteResult: [{ id: "version-1" }] as Array<{ id: string }>,
  versionRows: [] as Array<Record<string, unknown>>,
  contentRows: [] as Array<Record<string, unknown>>,
};

function versionRow(id: string, content: string, createdAt: string) {
  return {
    id,
    campaign_id: "campaign-1",
    created_by: "gm-1",
    content,
    created_at: createdAt,
  };
}

beforeEach(() => {
  state.inserted = [];
  state.upsertedContents = [];
  state.deleted = [];
  state.deleteResult = [{ id: "version-1" }];
  state.versionRows = [];
  state.contentRows = [];
  mockedGetSupabaseClient.mockReturnValue({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: "gm-1" } } },
          error: null,
        }),
    },
    from: (table: string) => {
      if (table === ASSISTANT_OUTLINE_VERSIONS_TABLE) {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.inserted.push(row);
            return { data: null, error: null };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () =>
                  Promise.resolve({ data: state.versionRows, error: null }),
              }),
            }),
          }),
          delete: () => ({
            eq: (column: string, value: unknown) => {
              state.deleted.push({ column, value });
              return {
                eq: () => ({
                  select: () =>
                    Promise.resolve({
                      data: state.deleteResult,
                      error: null,
                    }),
                }),
              };
            },
          }),
        };
      }
      return {
        upsert: async (row: Record<string, unknown>) => {
          state.upsertedContents.push(row);
          return { data: null, error: null };
        },
        select: () => ({
          eq: () =>
            Promise.resolve({ data: state.contentRows, error: null }),
        }),
      };
    },
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe("outline versions", () => {
  it("apply keeps the replaced text, then replaces the outline", async () => {
    const current = "Act one: the bell rings.";
    const proposed = "Act one revised: the bell cracks.";

    const versionId = await applyOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: current,
      proposedText: proposed,
    });

    expect(typeof versionId).toBe("string");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      campaign_id: "campaign-1",
      created_by: "gm-1",
      content: current,
    });
    expect(state.upsertedContents).toHaveLength(1);
    expect(state.upsertedContents[0]).toMatchObject({ note_id: "outline-1" });
    expect(
      decodeOutlineContent(state.upsertedContents[0]?.content as string)
    ).toBe(proposed);
  });

  it("apply with a blank current outline replaces without keeping a version", async () => {
    const versionId = await applyOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: "  ",
      proposedText: "A fresh plan.",
    });

    expect(versionId).toBeNull();
    expect(state.inserted).toHaveLength(0);
    expect(state.upsertedContents).toHaveLength(1);
    expect(
      decodeOutlineContent(state.upsertedContents[0]?.content as string)
    ).toBe("A fresh plan.");
  });

  it("apply refuses a blank proposal without writing anything", async () => {
    await expect(
      applyOutlineRevision({
        campaignId: "campaign-1",
        outlineId: "outline-1",
        currentText: "Something.",
        proposedText: "   ",
      })
    ).rejects.toBeTruthy();
    expect(state.inserted).toHaveLength(0);
    expect(state.upsertedContents).toHaveLength(0);
  });

  it("undo restores the latest kept text and drops that version", async () => {
    state.versionRows = [
      versionRow("version-2", "Second plan.", "2026-11-14T00:02:00Z"),
      versionRow("version-1", "First plan.", "2026-11-14T00:01:00Z"),
    ];
    state.deleteResult = [{ id: "version-2" }];

    const restored = await undoOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
    });

    expect(restored).toBe("Second plan.");
    expect(state.upsertedContents).toHaveLength(1);
    expect(
      decodeOutlineContent(state.upsertedContents[0]?.content as string)
    ).toBe("Second plan.");
    expect(state.deleted).toContainEqual({ column: "id", value: "version-2" });
  });

  it("undo with no kept versions throws without writing", async () => {
    state.versionRows = [];
    await expect(
      undoOutlineRevision({ campaignId: "campaign-1", outlineId: "outline-1" })
    ).rejects.toThrow(/nothing to undo/i);
    expect(state.upsertedContents).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
  });

  it("lists versions newest first", async () => {
    state.versionRows = [
      versionRow("version-2", "Second plan.", "2026-11-14T00:02:00Z"),
      versionRow("version-1", "First plan.", "2026-11-14T00:01:00Z"),
    ];

    const versions = await listOutlineVersions({ campaignId: "campaign-1" });

    expect(versions.map((version) => version.id)).toEqual([
      "version-2",
      "version-1",
    ]);
    expect(versions[0]).toMatchObject({ content: "Second plan." });
    expect(CAMPAIGN_NOTE_CONTENTS_TABLE).toBe("campaign_note_contents");
  });
});
