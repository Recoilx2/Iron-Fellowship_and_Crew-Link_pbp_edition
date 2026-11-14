import { useState } from "react";
import {
  Button,
  Dialog,
  Drawer,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AssistantIcon from "@mui/icons-material/AutoAwesome";
import { useStore } from "stores/store";
import { GMAssistantPanel } from "./GMAssistantPanel";

/**
 * The GM assistant entry point (spec #10, ticket #130): an Assistant
 * button for GMs of the campaign opening the docked panel. Players and
 * outsiders get nothing at all -- no button, panel or settings -- while
 * the server still refuses their requests (the access rules and the
 * server function check GM membership independently of this gate).
 *
 * Layout follows variant A from #7: on desktop the panel docks as a
 * right-hand pane, on phones it opens full-screen with its own close
 * button. The campaign screen renders this once in its header, so the
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
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));

  if (!campaignId || !gmIds.includes(uid)) {
    return null;
  }

  return (
    <>
      <Button
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
          <Drawer
            anchor={"right"}
            variant={"persistent"}
            open
            PaperProps={{ sx: { width: 400, maxWidth: "90vw" } }}
          >
            <GMAssistantPanel
              campaignId={campaignId}
              onClose={() => setOpen(false)}
            />
          </Drawer>
        ))}
    </>
  );
}
