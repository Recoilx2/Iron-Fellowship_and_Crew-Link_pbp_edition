import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewCollectionDocument } from "api-calls/homebrew/_homebrewCollection.type";
import {
  ClientOption,
  CollectionEntry,
  CollectionMembership,
  composeCollectionDocument,
  fetchMemberCollections,
  resolveClient,
} from "api-calls/homebrew/_supabase";
import { listenToRows } from "api-calls/realtime/listenToRows";

/**
 * Lists every collection the person edits or views. Membership (who edits or
 * views what) is composed from the initial fetch and kept in a local cache:
 * row events on the public collections table carry no membership, so events
 * for unknown collections are ignored and membership changes for others
 * appear on the next subscribe.
 *
 * Two cases stay live: collections the person creates appear at once (the
 * creator is always an editor), and losing editorship or viewership drops
 * the collection immediately.
 */
export function listenToHomebrewCollections(
  uid: string,
  updateCollection: (
    collectionId: string,
    collection: HomebrewCollectionDocument
  ) => void,
  removeCollection: (collectionId: string) => void,
  onError: (error: unknown) => void,
  onLoaded: () => void,
  opts?: ClientOption
): Unsubscribe {
  const client = resolveClient(opts);
  const membershipById = new Map<string, CollectionMembership>();
  const known = new Map<string, string>();
  let loaded = false;

  const membershipOf = (
    id: string,
    creator: string
  ): CollectionMembership | null => {
    if (creator === uid) return { editors: [uid], viewers: [] };
    return membershipById.get(id) ?? null;
  };

  const unsubscribe = listenToRows<CollectionEntry>({
    client,
    channelName: `homebrew-collections:${uid}`,
    bindings: [
      {
        type: "postgres_changes",
        table: "homebrew_collections",
        toChange: (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<{ id: string }>;
            if (typeof old?.id !== "string") return null;
            membershipById.delete(old.id);
            return { kind: "remove", key: old.id };
          }
          const row = payload.new as unknown as
            | CollectionEntry["row"]
            | undefined;
          if (!row || typeof row.id !== "string") return null;
          const membership = membershipOf(row.id, row.creator);
          if (!membership) return null;
          return { kind: "upsert", row: { row, ...membership } };
        },
      },
      {
        type: "postgres_changes",
        table: "homebrew_editors",
        filter: `user_id=eq.${uid}`,
        toChange: (payload) => {
          if (payload.eventType !== "DELETE") return null;
          const old = payload.old as Partial<{ collection_id: string }>;
          if (typeof old?.collection_id !== "string") return null;
          membershipById.delete(old.collection_id);
          return { kind: "remove", key: old.collection_id };
        },
      },
      {
        type: "postgres_changes",
        table: "homebrew_viewers",
        filter: `user_id=eq.${uid}`,
        toChange: (payload) => {
          if (payload.eventType !== "DELETE") return null;
          const old = payload.old as Partial<{ collection_id: string }>;
          if (typeof old?.collection_id !== "string") return null;
          membershipById.delete(old.collection_id);
          return { kind: "remove", key: old.collection_id };
        },
      },
    ],
    fetchRows: async () => {
      const entries = await fetchMemberCollections(client, uid);
      membershipById.clear();
      for (const entry of entries) {
        membershipById.set(entry.row.id, {
          editors: entry.editors,
          viewers: entry.viewers,
        });
      }
      return entries;
    },
    getKey: (entry) => entry.row.id,
    getUpdatedAt: (entry) => entry.row.updated_at,
    onRows: (entries) => {
      const seen = new Set<string>();
      for (const entry of entries) {
        seen.add(entry.row.id);
        const doc = composeCollectionDocument(entry.row, {
          editors: entry.editors,
          viewers: entry.viewers,
        });
        const fingerprint = JSON.stringify(doc);
        if (known.get(entry.row.id) !== fingerprint) {
          known.set(entry.row.id, fingerprint);
          updateCollection(entry.row.id, doc);
        }
      }
      for (const id of [...known.keys()]) {
        if (!seen.has(id)) {
          known.delete(id);
          removeCollection(id);
        }
      }
      if (!loaded) {
        loaded = true;
        onLoaded();
      }
    },
    onError,
  });

  return unsubscribe;
}
