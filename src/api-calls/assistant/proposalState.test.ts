import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveProposalState } from "api-calls/assistant/saveProposalState";
import { ASSISTANT_MESSAGES_TABLE, messageRowToDocument } from "./_getRef";
import type { AssistantMessageRow } from "./_getRef";
import { getSupabaseClient } from "config/supabase.config";

vi.mock("config/supabase.config");

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

// Seam under test: remembering what the GM did with a proposal. The outcome
// is written onto the assistant message that carried it, and read back with
// the message. The access rules are covered by the live tests; here the
// client is a stub.
const state = {
  updated: [] as Array<{ table: string; columns: Record<string, unknown> }>,
  filters: [] as Array<{ column: string; value: unknown }>,
  updateResult: [{ id: "message-1" }] as Array<{ id: string }>,
};

beforeEach(() => {
  state.updated = [];
  state.filters = [];
  state.updateResult = [{ id: "message-1" }];
  mockedGetSupabaseClient.mockReturnValue({
    from: (table: string) => ({
      update: (columns: Record<string, unknown>) => {
        state.updated.push({ table, columns });
        return {
          eq: (column: string, value: unknown) => {
            state.filters.push({ column, value });
            return {
              select: () =>
                Promise.resolve({ data: state.updateResult, error: null }),
            };
          },
        };
      },
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>);
});

function row(overrides: Partial<AssistantMessageRow> = {}): AssistantMessageRow {
  return {
    id: "message-1",
    conversation_id: "conversation-1",
    role: "assistant",
    content: "Here is a revision.",
    stopped_partway: false,
    proposal_state: null,
    applied_version_id: null,
    created_at: "2026-11-14T00:00:00Z",
    updated_at: "2026-11-14T00:00:00Z",
    ...overrides,
  };
}

describe("proposal state", () => {
  it("records an applied proposal with the version its Apply kept", async () => {
    await saveProposalState({
      messageId: "message-1",
      state: "applied",
      appliedVersionId: "version-1",
    });

    expect(state.updated).toEqual([
      {
        table: ASSISTANT_MESSAGES_TABLE,
        columns: { proposal_state: "applied", applied_version_id: "version-1" },
      },
    ]);
    expect(state.filters).toEqual([{ column: "id", value: "message-1" }]);
  });

  it("records a dismissed proposal without a version", async () => {
    await saveProposalState({
      messageId: "message-1",
      state: "dismissed",
      appliedVersionId: null,
    });

    expect(state.updated[0].columns).toEqual({
      proposal_state: "dismissed",
      applied_version_id: null,
    });
  });

  it("clears the state after an Undo so the proposal can be applied again", async () => {
    await saveProposalState({
      messageId: "message-1",
      state: null,
      appliedVersionId: null,
    });

    expect(state.updated[0].columns).toEqual({
      proposal_state: null,
      applied_version_id: null,
    });
  });

  it("refuses a version id on anything but an applied proposal", async () => {
    await expect(
      saveProposalState({
        messageId: "message-1",
        state: "dismissed",
        appliedVersionId: "version-1",
      })
    ).rejects.toThrow(/only an applied/i);
    expect(state.updated).toHaveLength(0);
  });

  it("fails when no message row was updated", async () => {
    state.updateResult = [];
    await expect(
      saveProposalState({
        messageId: "message-1",
        state: "dismissed",
        appliedVersionId: null,
      })
    ).rejects.toThrow(/message not found/i);
  });

  it("reads the saved state back with the message", () => {
    expect(messageRowToDocument(row())).toMatchObject({
      proposalState: null,
      appliedVersionId: null,
    });
    expect(
      messageRowToDocument(
        row({ proposal_state: "applied", applied_version_id: "version-1" })
      )
    ).toMatchObject({ proposalState: "applied", appliedVersionId: "version-1" });
    expect(
      messageRowToDocument(row({ proposal_state: "dismissed" }))
    ).toMatchObject({ proposalState: "dismissed", appliedVersionId: null });
  });
});
