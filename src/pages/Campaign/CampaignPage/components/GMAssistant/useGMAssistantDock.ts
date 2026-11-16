import { createContext, useContext } from "react";

/**
 * Shared state between the Assistant button (campaign header) and the Chat
 * tab's side pane (ticket #150). On desktop the open assistant docks in
 * place of the side pane: the Chat tab registers that it has a pane
 * ("hosted"), renders an empty slot instead of the side screens while the
 * assistant is open, and the assistant portals its panel into the slot.
 * Anywhere else (no Chat pane on screen) the assistant falls back to the
 * floating drawer.
 */
export interface GMAssistantDockState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** True while a Chat tab with a side pane is on screen. */
  hosted: boolean;
  setHosted: (hosted: boolean) => void;
  slot: HTMLElement | null;
  setSlot: (slot: HTMLElement | null) => void;
}

export const GMAssistantDockContext = createContext<GMAssistantDockState | null>(null);

/** The dock state, or null when rendered outside a provider. */
export function useGMAssistantDock(): GMAssistantDockState | null {
  return useContext(GMAssistantDockContext);
}
