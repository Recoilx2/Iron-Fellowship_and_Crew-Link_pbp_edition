import { useStore } from "stores/store";
import { LinkedDialogContentTitle } from "./LinkedDialogContentTitle";
import { Box, DialogContent } from "@mui/material";
import { AssetCard } from "components/features/assets/AssetCard";

export interface AssetDialogContentProps {
  id: string;
  handleBack: () => void;
  handleClose: () => void;
  isLastItem: boolean;
  /** The id the dialog is named by, when its container is not an MUI Dialog. */
  titleId?: string;
}

export function AssetDialogContent(props: AssetDialogContentProps) {
  const { id, handleBack, handleClose, isLastItem, titleId } = props;

  const assets = useStore((store) => store.rules.assetMaps.assetMap);

  const asset = assets[id];

  if (!asset) {
    return (
      <>
        <LinkedDialogContentTitle
          id={id}
          handleBack={handleBack}
          handleClose={handleClose}
          isLastItem={isLastItem}
          titleId={titleId}
        >
          Asset Not Found
        </LinkedDialogContentTitle>
        <DialogContent>Sorry, we could not find that asset.</DialogContent>
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
        {asset.name}
      </LinkedDialogContentTitle>
      <DialogContent>
        <Box maxWidth={(theme) => theme.spacing(48)} mx={"auto"}>
          <AssetCard assetId={id} />
        </Box>
      </DialogContent>
    </>
  );
}
