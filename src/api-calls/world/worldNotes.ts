import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe as PlainUnsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import type {
  PostgresChangePayload,
  RowChange,
} from "api-calls/realtime/listenToRows";
import { decodeNoteContent, encodeNoteContent } from "api-calls/notes/noteContent";

/**
 * World item notes (public and GM-only notes for locations, lore and
 * NPCs). Each item has one public and one GM-only world_notes row holding
 * Yjs documents on the note server; the contents rows below are the
 * fallback read path and the initial value for fresh editor documents.
 */

export const WORLD_NOTES_TABLE = "world_notes";
export const WORLD_NOTE_CONTENTS_TABLE = "world_note_contents";

export type WorldNoteItemKind = "location" | "lore" | "npc";

const kindToColumn: Record<WorldNoteItemKind, string> = {
  location: "location_id",
  lore: "lore_id",
  npc: "npc_id",
};

export interface WorldNoteRow {
  id: string;
  world_id: string;
  location_id: string | null;
  lore_id: string | null;
  npc_id: string | null;
  gm_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorldNoteContentRow {
  note_id: string;
  content: string | null;
  updated_at: string;
}

export function constructWorldNoteRowChannelName(
  kind: WorldNoteItemKind,
  itemId: string
): string {
  return `world-note-ids:${kind}:${itemId}`;
}

export function constructWorldNoteRowFilter(
  kind: WorldNoteItemKind,
  itemId: string
): string {
  return `${kindToColumn[kind]}=eq.${itemId}`;
}

export function constructWorldNoteContentChannelName(noteId: string): string {
  return `world-note-content:${noteId}`;
}

export function constructWorldNoteContentFilter(noteId: string): string {
  return `note_id=eq.${noteId}`;
}

export function worldNotePayloadToChange(
  payload: PostgresChangePayload<WorldNoteRow>
): RowChange<WorldNoteRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<WorldNoteRow>;
    return typeof old.id === "string"
      ? { kind: "remove", key: old.id }
      : null;
  }
  const row = payload.new as Partial<WorldNoteRow>;
  return row && typeof row.id === "string"
    ? { kind: "upsert", row: row as WorldNoteRow }
    : null;
}

export function worldNoteContentPayloadToChange(
  payload: PostgresChangePayload<WorldNoteContentRow>
): RowChange<WorldNoteContentRow> | null {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<WorldNoteContentRow>;
    return typeof old.note_id === "string"
      ? { kind: "remove", key: old.note_id }
      : null;
  }
  const row = payload.new as Partial<WorldNoteContentRow>;
  return row && typeof row.note_id === "string"
    ? { kind: "upsert", row: row as WorldNoteContentRow }
    : null;
}

/**
 * Reads the public and GM-only note ids for one world item. Rows are
 * created with the item, so both are usually present; missing sides resolve
 * to undefined.
 */
export async function getWorldItemNoteIds(
  kind: WorldNoteItemKind,
  itemId: string
): Promise<{ publicNoteId?: string; gmNoteId?: string }> {
  const column = kindToColumn[kind];
  const { data, error } = await getSupabaseClient()
    .from(WORLD_NOTES_TABLE)
    .select("id, gm_only")
    .eq(column, itemId);
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as Array<{ id: string; gm_only: boolean }>;
  return {
    publicNoteId: rows.find((row) => !row.gm_only)?.id,
    gmNoteId: rows.find((row) => row.gm_only)?.id,
  };
}

/**
 * Creates the missing note rows for one world item. Called after item
 * creation and before note writes, so the note server always finds a row
 * to check access against.
 */
export async function ensureWorldItemNotes(
  worldId: string,
  kind: WorldNoteItemKind,
  itemId: string
): Promise<{ publicNoteId: string; gmNoteId: string }> {
  const existing = await getWorldItemNoteIds(kind, itemId);
  if (existing.publicNoteId && existing.gmNoteId) {
    return {
      publicNoteId: existing.publicNoteId,
      gmNoteId: existing.gmNoteId,
    };
  }
  const column = kindToColumn[kind];
  const client = getSupabaseClient();
  // The id is generated here so the insert needs no RETURNING clause: the
  // world_notes SELECT policy re-queries its own table, which cannot see a
  // just-inserted row in the same statement, so insert-then-select always
  // fails RLS (#74). The plain INSERT policy compares the world against
  // is_world_gm directly and accepts the row.
  const insertNote = async (gmOnly: boolean): Promise<string> => {
    const id = crypto.randomUUID();
    const { error } = await client
      .from(WORLD_NOTES_TABLE)
      .insert({ id, world_id: worldId, [column]: itemId, gm_only: gmOnly });
    if (error) {
      throw error;
    }
    return id;
  };
  // A concurrent creator may win the race: fall back to a re-read.
  const getOrInsert = async (
    known: string | undefined,
    gmOnly: boolean
  ): Promise<string> => {
    if (known) return known;
    try {
      return await insertNote(gmOnly);
    } catch {
      const reread = await getWorldItemNoteIds(kind, itemId);
      const found = gmOnly ? reread.gmNoteId : reread.publicNoteId;
      if (!found) throw new Error("Failed to create world note.");
      return found;
    }
  };
  const [publicNoteId, gmNoteId] = await Promise.all([
    getOrInsert(existing.publicNoteId, false),
    getOrInsert(existing.gmNoteId, true),
  ]);
  return { publicNoteId, gmNoteId };
}

/**
 * Writes note bytes to a contents row, creating the note row first when
 * the item predates notes. The live Yjs bytes already sit on the note
 * server; this is the fallback path and what unsharing revocation reads.
 */
export async function writeWorldNoteContent(
  worldId: string,
  kind: WorldNoteItemKind,
  itemId: string,
  gmOnly: boolean,
  notes: Uint8Array
): Promise<void> {
  const ids = await ensureWorldItemNotes(worldId, kind, itemId);
  const noteId = gmOnly ? ids.gmNoteId : ids.publicNoteId;
  const { error } = await getSupabaseClient()
    .from(WORLD_NOTE_CONTENTS_TABLE)
    .upsert({ note_id: noteId, content: encodeNoteContent(notes) });
  if (error) {
    throw error;
  }
}

/**
 * Follows one note's contents row, emitting bytes or undefined when the
 * note has no saved content yet. Readers without access receive nothing:
 * the database filters the row.
 */
export function listenToWorldNoteContent(
  noteId: string,
  onContent: (content?: Uint8Array) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe {
  const client = getSupabaseClient();
  return listenToRows<WorldNoteContentRow>({
    client,
    channelName: constructWorldNoteContentChannelName(noteId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLD_NOTE_CONTENTS_TABLE,
        filter: constructWorldNoteContentFilter(noteId),
        toChange: worldNoteContentPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLD_NOTE_CONTENTS_TABLE)
        .select("*")
        .eq("note_id", noteId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as WorldNoteContentRow[];
    },
    getKey: (row) => row.note_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const content = rows[0]?.content;
      if (content) {
        try {
          onContent(decodeNoteContent(content));
        } catch (error) {
          onError(error);
        }
      } else {
        onContent(undefined);
      }
    },
    onError,
  });
}

/**
 * Follows one side (public or GM-only) of one item's notes, tracking the
 * note row itself so notes created after subscribing still arrive. Emits
 * bytes, or undefined when the note has no saved content yet.
 */
export function listenToWorldItemNotes(
  kind: WorldNoteItemKind,
  itemId: string,
  gmOnly: boolean,
  onNotes: (notes: Uint8Array | undefined) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): PlainUnsubscribe {
  const client = getSupabaseClient();
  let contentUnsubscribe: PlainUnsubscribe | undefined;
  let currentNoteId: string | undefined;

  const rowsUnsubscribe = listenToRows<WorldNoteRow>({
    client,
    channelName: constructWorldNoteRowChannelName(kind, itemId),
    bindings: [
      {
        type: "postgres_changes",
        table: WORLD_NOTES_TABLE,
        filter: constructWorldNoteRowFilter(kind, itemId),
        toChange: worldNotePayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(WORLD_NOTES_TABLE)
        .select("*")
        .eq(kindToColumn[kind], itemId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as WorldNoteRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      const note = rows.find((row) => row.gm_only === gmOnly);
      if (note?.id === currentNoteId) {
        return;
      }
      contentUnsubscribe?.();
      contentUnsubscribe = undefined;
      currentNoteId = note?.id;
      if (!currentNoteId) {
        onNotes(undefined);
        return;
      }
      contentUnsubscribe = listenToWorldNoteContent(
        currentNoteId,
        onNotes,
        onError
      );
    },
    onError,
  });

  return () => {
    rowsUnsubscribe();
    contentUnsubscribe?.();
  };
}
