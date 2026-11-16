import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Button,
  Dialog,
  Drawer,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AssistantIcon from "@mui/icons-material/AutoAwesome";
import { useStore } from "stores/store";
import { GMAssistantPanel } from "./GMAssistantPanel";
import { useGMAssistantDock } from "./useGMAssistantDock";

/**
 * The GM assistant entry point (spec #10, ticket #130): an Assistant
 * button for GMs of the campaign opening the docked panel. Players and
 * outsiders get nothing at all -- no button, panel or settings -- while
 * the server still refuses their requests (the access rules and the
 * server function check GM membership independently of this gate).
 *
 * Layout follows variant A from #7: on desktop the panel docks in place
 * of the Chat tab's side pane (ticket #150), so it never covers the chat
 * feed; on phones it opens full-screen with its own close button. With no
 * Chat pane on screen (the world tabs) the desktop panel falls back to a
 * floating drawer. The campaign screen renders this once in its header, so the
 * button stays one step away from every campaign tab, world screens
 * included.
 */
export function GMAssistant() {
  const uid = useStore((store) => store.auth.uid);
  const campaignId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaignId
  );
  const gmIds = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.gmIds ?? []
  );
  const dock = useGMAssistantDock();
  const [localOpen, setLocalOpen] = useState(false);
  const open = dock ? dock.open : localOpen;
  const setOpen = dock ? dock.setOpen : setLocalOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));

  // Focus returns to the Assistant button when the docked panel or drawer
  // closes. The phone dialog restores focus itself.
  useEffect(() => {
    if (wasOpen.current && !open && !isPhone) {
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, isPhone]);

  if (!campaignId || !gmIds.includes(uid)) {
    return null;
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant={"outlined"}
        color={"inherit"}
        startIcon={<AssistantIcon />}
        onClick={() => setOpen(true)}
      >
        Assistant
      </Button>
      {open && (
        <AssistantSurface
          campaignId={campaignId}
          onClose={() => setOpen(false)}
          isPhone={isPhone}
          slot={dock?.hosted ? dock.slot : null}
          waitForSlot={!!dock?.hosted}
        />
      )}
    </>
  );
}

/**
 * The open panel's surface, phone and desktop alike. The panel's React
 * element lives at one stable position, portalled into a host node that
 * this component owns; only the host node moves -- into the phone Dialog,
 * into the Chat side pane's slot on desktop, or into a floating drawer
 * when there is no Chat pane. Moving the node keeps the panel's state
 * (tab, conversation, typed prompt, streamed reply) across campaign tab
 * switches, which unmount and remount the Chat pane, and across the window
 * crossing the md breakpoint while the assistant is open, which used to
 * remount the panel and lose its state (found in the PR #166 review,
 * ticket #151). The phone Dialog keeps its own focus handling (open focus
 * trap, restore on close); the desktop region moves focus into the panel
 * only when it first opens.
 */
function AssistantSurface(props: {
  campaignId: string;
  onClose: () => void;
  isPhone: boolean;
  slot: HTMLElement | null;
  waitForSlot: boolean;
}) {
  const { campaignId, onClose, isPhone, slot, waitForSlot } = props;
  const [host] = useState(() => document.createElement("div"));
  const [drawerEl, setDrawerEl] = useState<HTMLElement | null>(null);
  const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  // While the Chat pane is on screen but its slot has not mounted yet, the
  // host waits unattached instead of flashing the drawer.
  const target = isPhone
    ? dialogEl
    : slot ?? (waitForSlot
      ? null
      : drawerEl);

  useLayoutEffect(() => {
    host.style.height = "100%";
    if (target) {
      target.appendChild(host);
      // The desktop region is focused once, when the panel first opens.
      // The phone Dialog focuses itself, so its own handling stays.
      if (!focused.current && !isPhone) {
        focused.current = true;
        regionRef.current?.focus();
      }
    } else {
      host.remove();
    }
  }, [host, target, isPhone]);

  // On unmount the host is detached and the once-focus forgotten, so a
  // remount (React StrictMode's mount-cleanup-mount cycle in development,
  // found in the PR #164 review) focuses the region again.
  useLayoutEffect(
    () => () => {
      host.remove();
      focused.current = false;
    },
    [host]
  );

  return (
    <>
      {createPortal(
        <Box
          ref={regionRef}
          // On a phone the Dialog is already the landmark named "GM
          // assistant"; a complementary landmark with the same label
          // nested inside it would say the panel twice.
          role={isPhone ? undefined : "complementary"}
          aria-label={isPhone ? undefined : "GM assistant"}
          tabIndex={-1}
          // Escape closing the phone dialog is asserted by a test, but the
          // path a keydown takes from inside the portalled panel to MUI's
          // Modal root is subtle (the host div has no fiber, so the
          // synthetic path re-enters the Dialog's tree at its host Box).
          // Handling Escape here as well keeps that behaviour explicit and
          // independent of where the host node lives.
          onKeyDown={
            isPhone
              ? (event) => {
                  if (event.key === "Escape") {
                    onClose();
                  }
                }
              : undefined
          }
          sx={{ height: "100%", outline: "none" }}
        >
          <GMAssistantPanel campaignId={campaignId} onClose={onClose} />
        </Box>,
        host
      )}
      {isPhone ? (
        <Dialog
          fullScreen
          open
          onClose={onClose}
          aria-label={"GM assistant"}
        >
          <Box
            ref={setDialogEl}
            sx={{ height: "100%", display: "flex", flexDirection: "column" }}
          />
        </Dialog>
      ) : (
        !slot &&
        !waitForSlot && (
          <Drawer
            anchor={"right"}
            variant={"persistent"}
            open
            PaperProps={{ sx: { width: 400, maxWidth: "90vw" } }}
          >
            <Box ref={setDrawerEl} sx={{ height: "100%" }} />
          </Drawer>
        )
      )}
    </>
  );
}
