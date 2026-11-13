import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { LoadingButton } from "@mui/lab";
import { useSnackbar } from "providers/SnackbarProvider/useSnackbar";
import { updateUser } from "api-calls/auth/updateUser";
import { useState } from "react";
import { useStore } from "stores/store";
import { UserAvatar } from "./UserAvatar";
import { DialogTitleWithCloseButton } from "./DialogTitleWithCloseButton";

export interface UserNameDialogProps {
  open: boolean;
  updating?: boolean;
  handleClose: () => void;
}

export function UserNameDialog(props: UserNameDialogProps) {
  const { open, updating, handleClose } = props;
  const { error } = useSnackbar();

  const user = useStore((store) => store.auth.user);

  const [name, setName] = useState(user?.displayName ?? "");

  const [isLoading, setIsLoading] = useState(false);

  const handleSave = () => {
    if (name.trim().length > 0) {
      setIsLoading(true);
      updateUser({ displayName: name })
        .then(() => {
          location.reload();
          handleClose();
        })
        .catch((e) => {
          console.error(e);
          error("Failed to update name");
          handleClose();
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      error("Name is required.");
    }
  };

  return (
    <Dialog open={open} onClose={updating ? handleClose : () => {}}>
      {updating ? (
        <DialogTitleWithCloseButton onClose={handleClose}>
          Change Username
        </DialogTitleWithCloseButton>
      ) : (
        <DialogTitle>We did not catch your name</DialogTitle>
      )}
      <DialogContent>
        <Stack spacing={2}>
          <Typography>
            Usernames will be displayed to other players in campaigns.
          </Typography>
          {user && <UserAvatar uid={user.uid} forceName={name} />}
          <TextField
            label={"Username"}
            value={name}
            onChange={(evt) => setName(evt.currentTarget.value)}
            sx={{ mt: 4 }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {updating && (
          <Button onClick={handleClose} color={"inherit"}>
            Cancel
          </Button>
        )}
        <LoadingButton
          loading={isLoading}
          variant={"contained"}
          color={"primary"}
          onClick={() => handleSave()}
        >
          Set Name
        </LoadingButton>
      </DialogActions>
    </Dialog>
  );
}
