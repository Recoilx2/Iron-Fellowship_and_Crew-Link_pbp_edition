import { Dialog, SwipeableDrawer } from "@mui/material";
import DialogContext from "@mui/material/Dialog/DialogContext";
import { useId } from "react";
import { useStore } from "stores/store";
import { LinkedDialogContent } from "./LinkedDialogContent";
import { useIsMobile } from "hooks/useIsMobile";
import { idMap } from "data/idMap";
import { useMatch } from "react-router-dom";
import { BASE_ROUTES, basePaths } from "routes";
import { ReferenceModeContext } from "hooks/useReferenceMode";

export function LinkedDialog() {
  const { isOpen, previousIds, openId } = useStore(
    (store) => store.appState.openDialogState
  );
  const handleBack = useStore((store) => store.appState.prevDialog);
  const handleClose = useStore((store) => store.appState.closeDialog);

  const isMobile = useIsMobile();
  // The phone drawer is a dialog to screen readers, like the desktop Dialog,
  // named by the same heading (DialogTitleWithCloseButton reads the id from
  // DialogContext).
  const titleId = useId();
  // The dialog sits outside the page, so it follows the page it opened from:
  // moves and oracles opened from the Rules page are for reading only.
  const isRulesPage = !!useMatch({
    path: basePaths[BASE_ROUTES.RULES],
    end: false,
  });

  const newId = openId ? idMap[openId] ?? openId : undefined;

  if (isMobile) {
    return (
      <ReferenceModeContext.Provider value={isRulesPage}>
        <SwipeableDrawer
          anchor={"bottom"}
          open={isOpen}
          onOpen={() => {}}
          disableSwipeToOpen
          disableDiscovery
          variant="temporary"
          ModalProps={{
            keepMounted: false,
          }}
          onClose={handleClose}
          sx={{ pt: 1 }}
          PaperProps={{
            role: "dialog",
            "aria-modal": true,
            "aria-labelledby": titleId,
            sx: (theme) => ({
              top: theme.spacing(2),
              borderTopLeftRadius: theme.shape.borderRadius,
              borderTopRightRadius: theme.shape.borderRadius,
            }),
          }}
        >
          <DialogContext.Provider value={{ titleId }}>
            <LinkedDialogContent
              id={newId}
              isLastItem={previousIds.length === 0}
              handleBack={handleBack}
              handleClose={handleClose}
            />
          </DialogContext.Provider>
        </SwipeableDrawer>
      </ReferenceModeContext.Provider>
    );
  }

  return (
    <ReferenceModeContext.Provider value={isRulesPage}>
      <Dialog open={isOpen} onClose={handleClose}>
        <LinkedDialogContent
          id={newId}
          isLastItem={previousIds.length === 0}
          handleBack={handleBack}
          handleClose={handleClose}
        />
      </Dialog>
    </ReferenceModeContext.Provider>
  );
}
