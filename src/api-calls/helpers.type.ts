export type Nullable<T> = T | null;

/**
 * App-owned shared types for the data layer. The backend (Supabase) is an
 * implementation detail of the data layer: stores, pages and components use
 * these types instead, and the data layer converts at its edge.
 */

/**
 * Plain unsubscribe function returned by every data-layer listener.
 */
export type Unsubscribe = () => void;
