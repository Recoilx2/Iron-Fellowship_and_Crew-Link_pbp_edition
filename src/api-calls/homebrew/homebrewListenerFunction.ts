import { Unsubscribe } from "api-calls/helpers.type";

/**
 * Listener shape every homebrew content area keeps: subscribe to one
 * collection's rows of one type, get the full map on every change, and stop
 * with a plain unsubscribe.
 */
export type HomebrewListenerFunction<T> = (
  homebrewId: string,
  updateData: (data: Record<string, T>) => void,
  onError: (error: unknown) => void
) => Unsubscribe;
