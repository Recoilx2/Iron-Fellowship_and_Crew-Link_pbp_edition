import { Unsubscribe } from "api-calls/helpers.type";
import { HomebrewCollectionDocument } from "api-calls/homebrew/_homebrewCollection.type";
import {
  ClientOption,
  CollectionEntry,
  CollectionMembership,
  composeCollectionDocument,
  fetchCollectionEntry,
  resolveClient,
} from "api-calls/homebrew/_supabase";
import { listenToRows } from "api-calls/realtime/listenToRows";

/**
 * Listens to one collection by id. Reads are public, so anyone signed in or
 * out can follow a shared link; writes stay restricted to editors.
 * Membership comes from the row fetches (row events only ever change scalar
 * columns), and a missing row reports through `onLoaded`.
 */
export function listenToHomebrewCollection(
  collectionId: string,
  updateCollection: (collection: HomebrewCollectionDocument) => void,
  onError: (error: unknown) => void,
  onLoaded: () => void,
  opts?: ClientOption
): Unsubscribe {
  const client = resolveClient(opts);
  let unsubscribe: Unsubscribe = () => {};
  let cancelled = false;
  let membership: CollectionMembership = { editors: [], viewers: [] };

  fetchCollectionEntry(client, collectionId).then(
    (entry) => {
      if (cancelled) return;
      if (!entry) {
        onLoaded();
        return;
      }
      membership = { editors: entry.editors, viewers: entry.viewers };
      unsubscribe = listenToRows<CollectionEntry>({
        client,
        channelName: `homebrew-collection:${collectionId}`,
        bindings: [
          {
            type: "postgres_changes",
            table: "homebrew_collections",
            filter: `id=eq.${collectionId}`,
            toChange: (payload) => {
              if (payload.eventType === "DELETE") {
                return null;
              }
              const row = payload.new as unknown as
                | CollectionEntry["row"]
                | undefined;
              if (!row || typeof row.id !== "string") return null;
              return { kind: "upsert", row: { row, ...membership } };
            },
          },
        ],
        fetchRows: async () => {
          const current = await fetchCollectionEntry(client, collectionId);
          if (!current) return [];
          membership = { editors: current.editors, viewers: current.viewers };
          return [current];
        },
        getKey: (entry) => entry.row.id,
        getUpdatedAt: (entry) => entry.row.updated_at,
        onRows: (rows) => {
          const current = rows[0];
          if (current) {
            updateCollection(
              composeCollectionDocument(current.row, {
                editors: current.editors,
                viewers: current.viewers,
              })
            );
          }
        },
        onError,
      });
    },
    (error) => {
      if (!cancelled) onError(error);
    }
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
