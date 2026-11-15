import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { TiptapTransformer } from "@hocuspocus/transformer";

import {
  applyOutlineRevision,
  listOutlineVersions,
  MAX_KEPT_OUTLINE_VERSIONS,
  undoOutlineRevision,
} from "./outlineVersions";
import { ASSISTANT_OUTLINE_VERSIONS_TABLE } from "./_getRef";
import { CAMPAIGN_NOTE_CONTENTS_TABLE } from "api-calls/notes/_getRef";
import { encodeNoteContent } from "api-calls/notes/noteContent";
import { getSupabaseClient } from "config/supabase.config";
import { decodeOutlineBytes } from "./outlineText";

function editorContentsRow(text: string): Record<string, unknown> {
  const doc = TiptapTransformer.toYdoc(
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text }] },
      ],
    },
    "default"
  );
  return { content: encodeNoteContent(Y.encodeStateAsUpdate(doc)) };
}

vi.mock("config/supabase.config");
vi.mock("config/hocuspocus.config", () => ({
  getCampaignNoteDocumentName: (id: string) => `campaign-notes/${id}`,
  getHocuspocusUrl: () => "ws://notes.test/hocuspocus",
  getHocuspocusToken: async () => "token",
}));

// The provider is mocked at its seam: a fake note server holds one Y.Doc
// per document name; a provider copies it in, reports synced, and
// forwards local changes back before reporting them acknowledged.
const server = vi.hoisted(() => ({
  docs: new Map<string, unknown>(),
  opened: [] as string[],
  destroyed: 0,
  acknowledge: true,
  refuse: false,
  lastDocument: null as unknown,
}));
vi.mock("@hocuspocus/provider", async () => {
  const Yjs = await import("yjs");
  class FakeProvider {
    hasUnsyncedChanges = false;
    private onUnsynced: (p: { number: number }) => void;
    constructor(config: {
      name: string;
      document: InstanceType<typeof Yjs.Doc>;
      token: unknown;
      onSynced?: () => void;
      onUnsyncedChanges?: (p: { number: number }) => void;
    }) {
      server.opened.push(config.name);
      server.lastDocument = config.document;
      this.onUnsynced = config.onUnsyncedChanges ?? (() => {});
      const remote =
        (server.docs.get(config.name) as InstanceType<typeof Yjs.Doc>) ??
        new Yjs.Doc();
      server.docs.set(config.name, remote);
      if (server.refuse) return;
      setTimeout(() => {
        Yjs.applyUpdate(config.document, Yjs.encodeStateAsUpdate(remote));
        config.document.on("update", (update: Uint8Array, origin: unknown) => {
          if (origin === "server") return;
          this.hasUnsyncedChanges = true;
          this.onUnsynced({ number: 1 });
          if (!server.acknowledge) return;
          setTimeout(() => {
            Yjs.applyUpdate(remote, update, "server");
            this.hasUnsyncedChanges = false;
            this.onUnsynced({ number: 0 });
          }, 5);
        });
        config.onSynced?.();
      }, 5);
    }
    destroy() {
      server.destroyed += 1;
    }
  }
  return { HocuspocusProvider: FakeProvider };
});

function seedServer(documentName: string, text: string): void {
  const doc = TiptapTransformer.toYdoc(
    {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
    "default"
  );
  server.docs.set(documentName, doc);
}

function serverText(documentName: string): string {
  const doc = server.docs.get(documentName) as Y.Doc;
  return decodeOutlineBytes(Y.encodeStateAsUpdate(doc));
}

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
  server.docs.clear();
  server.opened = [];
  server.destroyed = 0;
  server.acknowledge = true;
  server.refuse = false;
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
  it("apply keeps what the note server holds, then replaces it there", async () => {
    // A live edit the REST row has not caught up with yet.
    state.contentRows = [editorContentsRow("Stale row text.")];
    seedServer("campaign-notes/outline-1", "Act one: the bell rings.");

    const versionId = await applyOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: "Stale row text.",
      proposedText: "Act one revised: the bell cracks.",
    });

    expect(typeof versionId).toBe("string");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      campaign_id: "campaign-1",
      created_by: "gm-1",
      content: "Act one: the bell rings.",
    });
    expect(server.opened).toEqual(["campaign-notes/outline-1"]);
    expect(serverText("campaign-notes/outline-1")).toBe(
      "Act one revised: the bell cracks."
    );
    // Nothing is written over REST any more.
    expect(state.upsertedContents).toHaveLength(0);
    expect(server.destroyed).toBe(1);
  });

  it("apply with a blank outline replaces without keeping a version", async () => {
    const versionId = await applyOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: "  ",
      proposedText: "A fresh plan.",
    });

    expect(versionId).toBeNull();
    expect(state.inserted).toHaveLength(0);
    expect(serverText("campaign-notes/outline-1")).toBe("A fresh plan.");
  });

  it("apply does not report success until the note server acknowledged", async () => {
    seedServer("campaign-notes/outline-1", "Old.");
    server.acknowledge = false;
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = applyOutlineRevision({
        campaignId: "campaign-1",
        outlineId: "outline-1",
        currentText: "Old.",
        proposedText: "New.",
      }).then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(60000);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("apply fails and writes nothing over REST when the note server never syncs", async () => {
    // Auth refused / server down: no onSynced ever fires.
    vi.useFakeTimers();
    try {
      server.refuse = true;
      const pending = applyOutlineRevision({
        campaignId: "campaign-1",
        outlineId: "outline-1",
        currentText: "Old.",
        proposedText: "New.",
      });
      const assertion = expect(pending).rejects.toBeTruthy();
      await vi.advanceTimersByTimeAsync(60000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    expect(state.upsertedContents).toHaveLength(0);
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
    seedServer("campaign-notes/outline-1", "Third plan, live.");

    const restored = await undoOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
    });

    expect(restored).toBe("Second plan.");
    expect(state.upsertedContents).toHaveLength(0);
    expect(serverText("campaign-notes/outline-1")).toBe("Second plan.");
    expect(state.deleted).toContainEqual({ column: "id", value: "version-2" });
  });

  it("undo with no kept versions throws without writing", async () => {
    state.versionRows = [];
    await expect(
      undoOutlineRevision({ campaignId: "campaign-1", outlineId: "outline-1" })
    ).rejects.toThrow(/nothing to undo/i);
    expect(state.upsertedContents).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
    expect(server.opened).toHaveLength(0);
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

  it("apply prunes kept versions past the retention cap, newest kept", async () => {
    // Seam under test: the version history stays bounded per campaign.
    // Keeping one more past the cap drops the oldest, so Undo still sees
    // the newest rows.
    seedServer("campaign-notes/outline-1", "Latest plan.");
    const kept = MAX_KEPT_OUTLINE_VERSIONS;
    const total = kept + 2;
    state.versionRows = Array.from({ length: total }, (_, index) => {
      // Newest first, as the prune query orders by created_at desc.
      const n = total - index;
      return versionRow(
        `version-${n}`,
        `Plan ${n}.`,
        `2026-11-14T00:${String(n).padStart(2, "0")}:00Z`
      );
    });

    await applyOutlineRevision({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: "Latest plan.",
      proposedText: "Even later plan.",
    });

    expect(state.inserted).toHaveLength(1);
    // Two rows past the cap are pruned oldest-first; the newest 20 stay.
    expect(state.deleted).toHaveLength(2);
    expect(state.deleted).toContainEqual({
      column: "id",
      value: "version-2",
    });
    expect(state.deleted).toContainEqual({
      column: "id",
      value: "version-1",
    });
  });
});
