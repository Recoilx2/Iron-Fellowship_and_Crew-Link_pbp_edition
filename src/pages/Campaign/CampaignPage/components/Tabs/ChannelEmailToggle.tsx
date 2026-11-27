import { useEffect, useState } from "react";
import { Checkbox, FormControlLabel, Tooltip } from "@mui/material";
import EmailIcon from "@mui/icons-material/Email";
import EmailOffIcon from "@mui/icons-material/EmailOutlined";
import { useStore } from "stores/store";
import {
  getChannelEmailPreference,
  setChannelEmailPreference,
} from "api-calls/chat/emailPrefs";

/**
 * Per-channel email opt-in. A missing preference row is deliberately shown
 * as "off": no row means no email, so nobody starts receiving mail just by
 * opening a channel. The global switch in User Settings still wins; this
 * control stays editable but says why nothing will arrive while it is off.
 */
export function ChannelEmailToggle(props: {
  channelId: string;
  channelName: string;
}) {
  const { channelId, channelName } = props;
  const uid = useStore((store) => store.auth.uid);
  // Optional chaining keeps the toggle usable in isolated component tests
  // whose store mock only carries the slices they exercise.
  const globalEnabled = useStore(
    (store) => store.accessibilitySettings?.settings?.emailNotificationsEnabled
  );
  const [optedIn, setOptedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    setOptedIn(null);
    if (uid) {
      getChannelEmailPreference({ uid, channelId })
        .then((value) => {
          if (active) setOptedIn(value);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [uid, channelId]);

  const change = (next: boolean) => {
    if (!uid) return;
    setOptedIn(next);
    setChannelEmailPreference({ uid, channelId, optedIn: next }).catch(() => {
      setOptedIn(!next);
    });
  };

  return (
    <Tooltip
      title={
        globalEnabled === false
          ? "Emails are turned off in User Settings"
          : "Get an email when someone posts here"
      }
    >
      <FormControlLabel
        control={
          <Checkbox
            size={"small"}
            icon={<EmailOffIcon />}
            checkedIcon={<EmailIcon color={"primary"} />}
            checked={optedIn === true}
            onChange={(event) => change(event.target.checked)}
            inputProps={{
              "aria-label": `Email notifications for ${channelName}`,
            }}
          />
        }
        label={"Emails"}
      />
    </Tooltip>
  );
}
