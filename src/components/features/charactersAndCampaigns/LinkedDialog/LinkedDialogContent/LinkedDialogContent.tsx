import { DialogContent } from "@mui/material";
import { LinkedDialogContentTitle } from "./LinkedDialogContentTitle";
import { OracleDialogContent } from "./OracleDialogContent";
import { MoveDialogContent } from "./MoveDialogContent";
import { AssetDialogContent } from "./AssetDialogContent";
import { getLinkedDialogKind } from "./getLinkedDialogKind";

export interface LinkedDialogContentProps {
  id?: string;
  handleBack: () => void;
  handleClose: () => void;
  isLastItem: boolean;
  /** The id the dialog is named by, when its container is not an MUI Dialog. */
  titleId?: string;
}

export function LinkedDialogContent(props: LinkedDialogContentProps) {
  const { id, handleBack, handleClose, isLastItem, titleId } = props;

  const unsupportedContent = (
    <>
      <LinkedDialogContentTitle
        id={id ?? ""}
        handleBack={handleBack}
        handleClose={handleClose}
        isLastItem={isLastItem}
        titleId={titleId}
      >
        Not Supported
      </LinkedDialogContentTitle>
      <DialogContent>
        Sorry. Displaying this item is not yet supported by our application.
      </DialogContent>
    </>
  );

  if (!id) {
    return unsupportedContent;
  }

  const dialogKind = getLinkedDialogKind(id);

  if (dialogKind === "oracle") {
    return (
      <OracleDialogContent
        id={id}
        handleBack={handleBack}
        handleClose={handleClose}
        isLastItem={isLastItem}
        titleId={titleId}
      />
    );
  }

  if (dialogKind === "move") {
    return (
      <MoveDialogContent
        id={id}
        handleBack={handleBack}
        handleClose={handleClose}
        isLastItem={isLastItem}
        titleId={titleId}
      />
    );
  }

  if (dialogKind === "asset") {
    return (
      <AssetDialogContent
        id={id}
        handleBack={handleBack}
        handleClose={handleClose}
        isLastItem={isLastItem}
        titleId={titleId}
      />
    );
  }

  return unsupportedContent;
}
