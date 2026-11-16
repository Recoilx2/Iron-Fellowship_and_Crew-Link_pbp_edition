import { Box, DialogTitle, IconButton, Typography } from "@mui/material";
import DialogContext from "@mui/material/Dialog/DialogContext";
import { PropsWithChildren, ReactNode, useContext, useId } from "react";
import CloseIcon from "@mui/icons-material/Close";
import { LiveRegion } from "./LiveRegion";

export interface DialogTitleWithCloseButtonProps extends PropsWithChildren {
  onClose: () => void;
  actions?: ReactNode;
  /**
   * The id the title is named by, for containers that are not MUI Dialogs
   * (which provide one through DialogContext) -- e.g. the phone
   * SwipeableDrawer in LinkedDialog. Left out, the context id is used.
   */
  titleId?: string;
}
export function DialogTitleWithCloseButton(
  props: DialogTitleWithCloseButtonProps
) {
  const { children, actions, onClose, titleId } = props;

  // The dialog is named by whichever element holds its title id. MUI puts that
  // id on DialogTitle, which here also holds the buttons, so the name would end
  // in "Close Dialog". Give the id to the heading alone instead.
  const { titleId: contextTitleId } = useContext(DialogContext);
  const titleBarId = useId();

  return (
    <>
      <LiveRegion />
      <DialogTitle
        display={"flex"}
        alignItems={"center"}
        justifyContent={"space-between"}
        component={"div"}
        id={titleBarId}
      >
        <Typography variant={"h6"} component={"h2"} id={titleId ?? contextTitleId}>
          {children}
        </Typography>
        <Box display={"flex"} alignItems={"center"} flexShrink={0} ml={1}>
          {actions}
          <IconButton aria-label={"Close Dialog"} onClick={() => onClose()}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
    </>
  );
}
