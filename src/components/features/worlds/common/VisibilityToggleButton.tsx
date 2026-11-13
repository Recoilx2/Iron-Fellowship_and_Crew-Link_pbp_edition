import { IconButton, Tooltip } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

export interface VisibilityToggleButtonProps {
  sharedWithPlayers?: boolean;
  onToggle: () => void;
}

export function VisibilityToggleButton(props: VisibilityToggleButtonProps) {
  const { sharedWithPlayers, onToggle } = props;

  const shared = sharedWithPlayers ?? false;

  return (
    <Tooltip title={shared ? "Hide from players" : "Share with players"}>
      <IconButton
        aria-label={shared ? "Hide from players" : "Share with players"}
        aria-pressed={shared}
        onClick={(evt) => {
          evt.stopPropagation();
          onToggle();
        }}
      >
        {shared ? <VisibilityIcon /> : <VisibilityOffIcon />}
      </IconButton>
    </Tooltip>
  );
}
