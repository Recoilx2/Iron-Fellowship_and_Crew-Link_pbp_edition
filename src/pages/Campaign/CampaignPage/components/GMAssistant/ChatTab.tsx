import { Box, Button, LinearProgress, Alert, Typography } from "@mui/material";
import type { AssistantModelOption } from "api-calls/assistant/gmAssistantClient";
import { ConversationThread } from "./ConversationThread";

/**
 * A failure as the panel shows it: fixed client text plus the server's
 * reference. `ref` is null when nothing was logged for the failure yet
 * (the network failed before any reference existed).
 */
export interface ModelsFailure {
  code: string;
  message: string;
  ref: string | null;
}

/**
 * The GM assistant panel's Chat tab (spec #10, ticket #130): the
 * not-set-up message, the generic failure with its Retry button, the
 * loading bar, or the conversation thread. Split out of
 * `GMAssistantPanel.tsx` (ticket #151).
 */
export function ChatTab(props: {
  campaignId: string;
  models: AssistantModelOption[] | null;
  failure: ModelsFailure | null;
  currentModel: string;
  endpointHost: string | null;
  onTokenEstimate: (tokens: number) => void;
  onRetry: () => void;
}) {
  const { campaignId, models, failure, currentModel, endpointHost, onTokenEstimate, onRetry } = props;
  if (failure?.code === "NOT_SET_UP") {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant={"body2"}>
          The assistant isn&apos;t set up on this server. Ask whoever runs
          it.
        </Typography>
      </Box>
    );
  }
  if (failure) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert
          severity={"error"}
          action={
            <Button size={"small"} onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {failure.message}
          {failure.ref ? ` (ref: ${failure.ref})` : ""}
        </Alert>
      </Box>
    );
  }
  if (models === null) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress aria-label={"Loading models"} />
      </Box>
    );
  }
  return <ConversationThread campaignId={campaignId} currentModel={currentModel} endpointHost={endpointHost} onTokenEstimate={onTokenEstimate} />;
}
