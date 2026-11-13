import { getSupabaseClient } from "config/supabase.config";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentUpdate, Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import type { HomebrewCollectionDocument } from "api-calls/homebrew/_homebrewCollection.type";

/**
 * Shared Supabase plumbing for the homebrew data layer. Every content table
 * (stats, moves, oracles, assets, ...) has the same shape: an `id`, a
 * `collection_id` tying the row to its collection, and a `data` payload
 * holding the document fields. The data layer composes flat documents for
 * the stores and decomposes them back for storage, so the stores never see
 * the database shape.
 */

export interface ClientOption {
  /**
   * Identity to act as. Defaults to the app's signed-in client; the
   * behavior tests pass one client per person so every rule is exercised
   * as the person it applies to.
   */
  client?: SupabaseClient;
}

export function resolveClient(option?: ClientOption): SupabaseClient {
  return option?.client ?? getSupabaseClient();
}

export interface ContentRow {
  id: string;
  collection_id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

/** Composes the flat document the stores expect from a content row. */
export function toContentDoc<T>(row: ContentRow): T & { collectionId: string } {
  return { ...(row.data as object), collectionId: row.collection_id } as T & {
    collectionId: string;
  };
}

/** Strips the relational keys back off before a document is stored. */
export function toContentData(doc: { collectionId?: unknown; id?: unknown } & Record<string, unknown>): Record<string, unknown> {
  const rest = { ...doc };
  delete rest.collectionId;
  delete rest.id;
  return rest;
}

/**
 * Applies a document update to stored data: plain keys merge, dotted paths
 * (such as `contents.iron`) reach into nested maps the way the old document
 * updates did, and `undefined` deletes the target. Arrays replace wholesale.
 */
export function applyContentUpdate<T extends Record<string, unknown>>(
  current: T,
  update: DocumentUpdate<T>
): T {
  const next: Record<string, unknown> = { ...(current as object) };
  for (const [path, value] of Object.entries(update)) {
    setPath(next, path.split("."), value);
  }
  return next as T;
}

function setPath(target: Record<string, unknown>, parts: string[], value: unknown): void {
  const [head, ...rest] = parts;
  if (head === undefined) return;
  if (rest.length === 0) {
    if (value === undefined) {
      delete target[head];
    } else {
      target[head] = value;
    }
    return;
  }
  const child = target[head];
  const next: Record<string, unknown> =
    child !== null && typeof child === "object" && !Array.isArray(child)
      ? { ...(child as Record<string, unknown>) }
      : {};
  setPath(next, rest, value);
  target[head] = next;
}

/** Reads one content row; rejects when it does not exist. */
export async function fetchContentRow(
  client: SupabaseClient,
  table: string,
  id: string
): Promise<ContentRow> {
  const { data, error } = await client
    .from(table)
    .select("id, collection_id, data, updated_at")
    .eq("id", id)
    .single();
  if (error || !data) {
    throw error ?? new Error(`homebrew row ${id} not found in ${table}`);
  }
  return data as unknown as ContentRow;
}

async function fetchContentRows(
  client: SupabaseClient,
  table: string,
  collectionId: string
): Promise<ContentRow[]> {
  const { data, error } = await client
    .from(table)
    .select("id, collection_id, data, updated_at")
    .eq("collection_id", collectionId);
  if (error) throw error;
  return (data ?? []) as unknown as ContentRow[];
}

export interface HomebrewContentApi<TDoc extends { collectionId: string }> {
  create(params: { doc: TDoc } & ClientOption): Promise<string>;
  update(
    params: { id: string; doc: DocumentUpdate<TDoc> } & ClientOption
  ): Promise<void>;
  remove(params: { id: string } & ClientOption): Promise<void>;
  listen(
    homebrewId: string,
    updateData: (data: Record<string, TDoc>) => void,
    onError: (error: unknown) => void,
    opts?: ClientOption
  ): Unsubscribe;
}

/**
 * Builds the create/update/delete/listen surface for one homebrew content
 * table. Reads are public; the access rules reject writes from anyone but
 * the collection's editors, so failures surface as rejected promises.
 */
export function createHomebrewContentApi<TDoc extends { collectionId: string }>(
  table: string
): HomebrewContentApi<TDoc> {
  const toChange = (
    payload: { eventType: string; new: unknown; old: unknown },
    homebrewId: string
  ) => {
    if (payload.eventType === "DELETE") {
      const old = payload.old as Partial<ContentRow> | null;
      if (typeof old?.id !== "string") return null;
      return { kind: "remove", key: old.id } as const;
    }
    const row = payload.new as Partial<ContentRow>;
    if (
      typeof row?.id !== "string" ||
      row.collection_id !== homebrewId ||
      !row.data
    ) {
      return null;
    }
    return { kind: "upsert", row: row as ContentRow } as const;
  };

  return {
    create: async ({ doc, client: override }) => {
      const client = resolveClient({ client: override });
      const { data, error } = await client
        .from(table)
        .insert({
          collection_id: doc.collectionId,
          data: toContentData(doc),
        })
        .select("id")
        .single();
      if (error || !data) {
        throw error ?? new Error(`failed to create row in ${table}`);
      }
      return (data as unknown as { id: string }).id;
    },

    update: async ({ id, doc, client: override }) => {
      const client = resolveClient({ client: override });
      const current = await fetchContentRow(client, table, id);
      const data = applyContentUpdate(
        (current.data ?? {}) as Record<string, unknown>,
        doc as DocumentUpdate<Record<string, unknown>>
      );
      // Reads are public but writes are editors-only, so an outsider's
      // UPDATE matches zero rows and PostgREST answers success with an empty
      // payload. Returning the row turns that silent no-op into a rejection.
      const { data: written, error } = await client
        .from(table)
        .update({ data })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!written || written.length === 0) {
        throw new Error(`failed to update row ${id} in ${table}`);
      }
    },

    remove: async ({ id, client: override }) => {
      const client = resolveClient({ client: override });
      // Same silent-no-op semantics as update: a DELETE that matches nothing
      // succeeds with an empty payload, so reject when nothing was written.
      const { data: written, error } = await client
        .from(table)
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!written || written.length === 0) {
        throw new Error(`failed to delete row ${id} in ${table}`);
      }
    },

    listen: (homebrewId, updateData, onError, opts) => {
      const client = resolveClient(opts);
      return listenToRows<ContentRow>({
        client,
        channelName: `homebrew-${table}:${homebrewId}`,
        bindings: [
          {
            type: "postgres_changes",
            table,
            filter: `collection_id=eq.${homebrewId}`,
            toChange: (payload) => toChange(payload, homebrewId),
          },
        ],
        fetchRows: () => fetchContentRows(client, table, homebrewId),
        getKey: (row) => row.id,
        getUpdatedAt: (row) => row.updated_at,
        onRows: (rows) => {
          const data: Record<string, TDoc> = {};
          rows.forEach((row) => {
            data[row.id] = toContentDoc<TDoc>(row);
          });
          updateData(data);
        },
        onError,
      });
    },
  };
}

export interface CollectionRow {
  id: string;
  type: string;
  slug: string;
  title: string;
  description: string | null;
  creator: string;
  ruleset_id: string;
  updated_at: string;
}

export interface CollectionMembership {
  editors: string[];
  viewers: string[];
}

/** Composes the collection document the stores expect. */
export function composeCollectionDocument(
  row: CollectionRow,
  membership: CollectionMembership
): HomebrewCollectionDocument {
  return {
    type: row.type as HomebrewCollectionDocument["type"],
    id: row.slug,
    title: row.title,
    description: row.description ?? undefined,
    editors: membership.editors,
    viewers: membership.viewers,
    creator: row.creator,
    rulesetId: row.ruleset_id,
  };
}

async function fetchMembership(
  client: SupabaseClient,
  table: "homebrew_editors" | "homebrew_viewers",
  collectionIds: string[]
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (collectionIds.length === 0) return grouped;
  const { data, error } = await client
    .from(table)
    .select("collection_id, user_id")
    .in("collection_id", collectionIds);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as Array<{
    collection_id: string;
    user_id: string;
  }>) {
    const list = grouped.get(row.collection_id) ?? [];
    list.push(row.user_id);
    grouped.set(row.collection_id, list);
  }
  return grouped;
}

export interface CollectionEntry {
  row: CollectionRow;
  editors: string[];
  viewers: string[];
}

/**
 * Reads a content row, lets the caller mutate its data payload, and writes
 * it back. Used for nested updates the flat update path cannot express
 * (impact entries inside a category, an oracle collection's parent).
 */
export async function modifyContentData(
  table: string,
  id: string,
  mutate: (data: Record<string, unknown>) => void,
  option?: ClientOption
): Promise<void> {
  const client = resolveClient(option);
  const row = await fetchContentRow(client, table, id);
  const data = { ...((row.data ?? {}) as Record<string, unknown>) };
  mutate(data);
  // Reject silent no-ops the same way the flat update path does: an
  // outsider's write matches zero rows and succeeds with an empty payload.
  const { data: written, error } = await client
    .from(table)
    .update({ data })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!written || written.length === 0) {
    throw new Error(`failed to write row ${id} in ${table}`);
  }
}

/** Reads one collection with its editors and viewers; null when missing. */
export async function fetchCollectionEntry(
  client: SupabaseClient,
  collectionId: string
): Promise<CollectionEntry | null> {
  const { data, error } = await client
    .from("homebrew_collections")
    .select("id, type, slug, title, description, creator, ruleset_id, updated_at")
    .eq("id", collectionId)
    .single();
  if (error || !data) return null;
  const row = data as unknown as CollectionRow;
  const [editors, viewers] = await Promise.all([
    fetchMembership(client, "homebrew_editors", [row.id]),
    fetchMembership(client, "homebrew_viewers", [row.id]),
  ]);
  return {
    row,
    editors: editors.get(row.id) ?? [],
    viewers: viewers.get(row.id) ?? [],
  };
}

/** Fetches every collection the person edits or views, with membership. */
export async function fetchMemberCollections(
  client: SupabaseClient,
  uid: string
): Promise<CollectionEntry[]> {
  const [editorRows, viewerRows] = await Promise.all([
    client.from("homebrew_editors").select("collection_id").eq("user_id", uid),
    client.from("homebrew_viewers").select("collection_id").eq("user_id", uid),
  ]);
  if (editorRows.error) throw editorRows.error;
  if (viewerRows.error) throw viewerRows.error;
  const ids = [
    ...new Set([
      ...((editorRows.data ?? []) as Array<{ collection_id: string }>).map(
        (row) => row.collection_id
      ),
      ...((viewerRows.data ?? []) as Array<{ collection_id: string }>).map(
        (row) => row.collection_id
      ),
    ]),
  ];
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("homebrew_collections")
    .select("id, type, slug, title, description, creator, ruleset_id, updated_at")
    .in("id", ids);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CollectionRow[];
  const [editors, viewers] = await Promise.all([
    fetchMembership(client, "homebrew_editors", ids),
    fetchMembership(client, "homebrew_viewers", ids),
  ]);
  return rows.map((row) => ({
    row,
    editors: editors.get(row.id) ?? [],
    viewers: viewers.get(row.id) ?? [],
  }));
}
