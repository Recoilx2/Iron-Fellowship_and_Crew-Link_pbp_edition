export type Nullable<T> = T | null;

/**
 * Plain unsubscribe function returned by every data-layer listener.
 * The data layer converts at its edge; stores and components use this
 * app-owned type and never see backend listener types.
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
