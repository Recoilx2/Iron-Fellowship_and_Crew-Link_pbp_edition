import {
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { GMAssistantDockContext } from "./useGMAssistantDock";

export function GMAssistantDockProvider(props: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const [hosted, setHostedState] = useState(false);
  const [slot, setSlotState] = useState<HTMLElement | null>(null);
  const setHosted = useCallback((next: boolean) => setHostedState(next), []);
  const setSlot = useCallback(
    (next: HTMLElement | null) => setSlotState(next),
    []
  );
  const value = useMemo(
    () => ({ open, setOpen, hosted, setHosted, slot, setSlot }),
    [open, hosted, setHosted, slot, setSlot]
  );
  return (
    <GMAssistantDockContext.Provider value={value}>
      {props.children}
    </GMAssistantDockContext.Provider>
  );
}
