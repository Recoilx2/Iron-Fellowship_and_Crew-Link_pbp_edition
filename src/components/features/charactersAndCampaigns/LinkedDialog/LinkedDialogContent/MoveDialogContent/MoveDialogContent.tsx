import { DialogContent } from "@mui/material";
import { LinkedDialogContentTitle } from "../LinkedDialogContentTitle";
import { useStore } from "stores/store";
import { MoveContent } from "components/features/datasworn/MoveContent";

export interface MoveDialogContentProps {
  id: string;
  handleBack: () => void;
  handleClose: () => void;
  isLastItem: boolean;
  /** The id the dialog is named by, when its container is not an MUI Dialog. */
  titleId?: string;
}

export function MoveDialogContent(props: MoveDialogContentProps) {
  const { id, handleBack, handleClose, isLastItem, titleId } = props;

  const moves = useStore((store) => store.rules.moveMaps.moveMap);
  const move = moves[id];
  if (!move) {
    return (
      <>
        <LinkedDialogContentTitle
          id={id}
          handleBack={handleBack}
          handleClose={handleClose}
          isLastItem={isLastItem}
          titleId={titleId}
        >
          Move Not Found
        </LinkedDialogContentTitle>
        <DialogContent>Sorry, we could not find that move.</DialogContent>
      </>
    );
  }

  return (
    <>
      <LinkedDialogContentTitle
        id={id}
        handleBack={handleBack}
        handleClose={handleClose}
        isLastItem={isLastItem}
        titleId={titleId}
      >
        {move.name}
      </LinkedDialogContentTitle>
      <DialogContent>
        <MoveContent move={move} />
      </DialogContent>
    </>
  );
}
