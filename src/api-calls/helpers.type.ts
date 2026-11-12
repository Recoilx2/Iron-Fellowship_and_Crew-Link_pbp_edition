export type Nullable<T> = T | null;

/**
 * Plain unsubscribe function returned by every data-layer listener.
 * Replaces the Firebase `Unsubscribe` type outside the data layer — both are
 * `() => void`, so existing listeners fit without behaviour changes.
 */
export type Unsubscribe = () => void;

/**
 * App-owned partial-document update: either a plain partial of the document
 * or an open map of field values (including dotted field paths such as
 * `"map.0.1.type"`). Backend sentinel values like `arrayUnion` or
 * `deleteField` stay in the data layer behind intent functions; the data
 * layer converts this to the backend update type at its edge.
 */
export type DocumentUpdate<T> = Partial<T> | Record<string, unknown>;
