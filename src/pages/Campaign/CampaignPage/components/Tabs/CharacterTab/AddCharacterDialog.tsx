import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { CharacterList } from "components/features/characters/CharacterList";
import { Link } from "react-router-dom";
import { constructCharacterCreateInCampaignUrl } from "pages/Character/routes";
import { useStore } from "stores/store";
import { useId, useState } from "react";

export interface AddCharacterDialogProps {
  open: boolean;
  handleClose: () => void;
  campaignId: string;
}

export function AddCharacterDialog(props: AddCharacterDialogProps) {
  const { open, handleClose, campaignId } = props;

  const characters = useStore((store) => store.characters.characterMap);
  const isLoading = useStore((store) => store.characters.loading);

  const addCharacterToCampaign = useStore(
    (store) => store.campaigns.currentCampaign.addCharacter
  );
  const [addCharacterLoading, setAddCharacterLoading] = useState(false);
  // Names the dialog with its title alone, not the close button beside it.
  const titleId = useId();
  const titleBarId = useId();

  const addCharacter = (characterId: string) => {
    setAddCharacterLoading(true);
    addCharacterToCampaign(characterId).finally(() => {
      setAddCharacterLoading(false);
      handleClose();
    });
  };

  // At most one active character per player per campaign (#127): the
  // player's active character in this campaign is the current one, and
  // choosing another retires it and makes the new one active.
  const activeCharacterId = Object.keys(characters).find(
    (characterId) =>
      characters[characterId].campaignId === campaignId &&
      characters[characterId].isActive !== false
  );
  const activeCharacter = activeCharacterId
    ? characters[activeCharacterId]
    : undefined;

  return (
    <Dialog open={open} onClose={() => handleClose()} aria-labelledby={titleId}>
      <DialogTitle
        id={titleBarId}
        component={"div"}
        display={"flex"}
        justifyContent={"space-between"}
        alignItems={"center"}
      >
        <Typography component={"h2"} variant={"inherit"} id={titleId}>
          Add Character
        </Typography>
        <IconButton
          aria-label={"Close Dialog"}
          onClick={() => handleClose()}
          disabled={addCharacterLoading}
          sx={{ ml: 2 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {Object.keys(characters).length > 0 && (
          <Typography
            sx={{ mb: 1 }}
            color={(theme) => theme.palette.text.secondary}
          >
            {activeCharacter
              ? `${activeCharacter.name} is your active character in this campaign. Choosing another retires ${activeCharacter.name} and makes the new character active.`
              : "Add an existing character"}
          </Typography>
        )}
        {!isLoading && (
          <CharacterList
            characters={characters}
            maxColumns={1}
            actions={(characterId) => {
              if (characterId === activeCharacterId) {
                return <Button disabled>Current</Button>;
              }
              const inThisCampaign =
                characters[characterId].campaignId === campaignId;
              const inAnotherCampaign = !!characters[characterId].campaignId;
              if (inThisCampaign) {
                return <Button disabled>In campaign</Button>;
              }
              return (
                <Button
                  disabled={inAnotherCampaign || addCharacterLoading}
                  onClick={() => addCharacter(characterId)}
                >
                  {inAnotherCampaign
                    ? "Selected"
                    : activeCharacter
                      ? "Swap"
                      : "Select"}
                </Button>
              );
            }}
          />
        )}
        {Object.keys(characters).length > 0 && (
          <Divider sx={{ my: 3 }}>OR</Divider>
        )}
        <Box
          display={"flex"}
          alignItems={"center"}
          justifyContent={"center"}
          mt={2}
        >
          <Button
            variant={"contained"}
            component={Link}
            to={constructCharacterCreateInCampaignUrl(campaignId)}
            disabled={addCharacterLoading}
          >
            Create New Character
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
