import { useEffect, useRef, useState } from "react";
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
      {open &&
        (isPhone ? (
          <Dialog
            fullScreen
            open
            onClose={() => setOpen(false)}
            aria-label={"GM assistant"}
          >
            <GMAssistantPanel
              campaignId={campaignId}
              onClose={() => setOpen(false)}
            />
          </Dialog>
        ) : (
          <DesktopPanel
            campaignId={campaignId}
            onClose={() => setOpen(false)}
            slot={dock?.hosted ? dock.slot : null}
            waitForSlot={!!dock?.hosted}
          />
        ))}
    </>
  );
}

/**
 * The desktop panel: portalled into the Chat side pane's slot when there
 * is one, otherwise a floating drawer. Focus moves into the panel when it
 * opens.
 */
function DesktopPanel(props: {
  campaignId: string;
  onClose: () => void;
  slot: HTMLElement | null;
  waitForSlot: boolean;
}) {
  const { campaignId, onClose, slot, waitForSlot } = props;
  const regionRef = useRef<HTMLDivElement>(null);
  const placed = slot !== null || !waitForSlot;
  useEffect(() => {
    if (placed) {
      regionRef.current?.focus();
    }
  }, [placed]);

  // The Chat pane is on screen but its slot has not mounted yet.
  if (!placed) {
    return null;
  }

  const region = (
    <Box
      ref={regionRef}
      role={"complementary"}
      aria-label={"GM assistant"}
      tabIndex={-1}
      sx={{ height: "100%", outline: "none" }}
    >
      <GMAssistantPanel campaignId={campaignId} onClose={onClose} />
    </Box>
  );

  if (slot) {
    return createPortal(region, slot);
  }
  return (
    <Drawer
      anchor={"right"}
      variant={"persistent"}
      open
      PaperProps={{ sx: { width: 400, maxWidth: "90vw" } }}
    >
      {region}
    </Drawer>
  );
}
