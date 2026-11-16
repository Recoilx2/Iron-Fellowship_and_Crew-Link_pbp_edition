import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  IconButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  fetchAssistantContextSize,
  fetchAssistantModels,
  type AssistantContextSize,
  type AssistantModelOption,
} from "api-calls/assistant/gmAssistantClient";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
} from "api-calls/assistant/assistantSettings";
import { toAssistantFailure } from "./assistantFailure";
import { ContextSizeBar } from "./ContextSizeBar";
import { ContextTab } from "./ContextTab";
import { OutlineTab } from "./OutlineTab";
import { ChatTab, type ModelsFailure } from "./ChatTab";
import { useStore } from "stores/store";
import type {
  AssistantContextChoice,
  AssistantSettingsDocument,
} from "api-calls/assistant/_assistant.type";
import { emptyAssistantContextChoice } from "api-calls/assistant/_assistant.type";

type AssistantTab = "chat" | "context" | "outline";

/**
 * The GM assistant panel, variant A from #7 (tickets #130-#132): a header
 * with the title, the model picker and a close button, a size bar showing
 * the approximate total against the chosen model's context size, then Chat,
 * Context and Outline tabs. The Chat tab streams the assistant, the
 * Context tab holds the saved context choice, and the Outline tab edits
 * the campaign's one GM-only outline.
 *
 * The model list comes from the server; the GM's choice is saved to
 * assistant_settings beside their saved context choice. Sizes come from
 * the server too (the same code the chat path builds text with), with the
 * conversation overhead estimated beside it. When the server has no model
 * server the panel says so plainly, and every other failure shows a short
 * generic message with the reference code.
 *
 * Split along its jobs (ticket #151): the Chat tab and its conversation
 * thread live in `ChatTab.tsx` and `ConversationThread.tsx`; this file is
 * the shell — header, size bar, tabs and the saved settings.
 */
export function GMAssistantPanel(props: {
  campaignId: string;
  onClose: () => void;
}) {
  const { campaignId, onClose } = props;
  const [tab, setTab] = useState<AssistantTab>("chat");
  const [models, setModels] = useState<AssistantModelOption[] | null>(null);
  const [endpointHost, setEndpointHost] = useState<string | null>(null);
  const [settings, setSettings] = useState<AssistantSettingsDocument | null>(
    null
  );
  const [size, setSize] = useState<AssistantContextSize | null>(null);
  const [conversationTokens, setConversationTokens] = useState(0);
  const [failure, setFailure] = useState<ModelsFailure | null>(null);
  const [reloads, setReloads] = useState(0);
  // A settings save that failed: the choice is put back and the GM is told
  // (story 29) with a short generic message and a reference.
  const [settingsError, setSettingsError] = useState<ModelsFailure | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [list, saved] = await Promise.all([
          fetchAssistantModels(campaignId),
          fetchAssistantSettings({ campaignId }).catch(() => null),
        ]);
        if (cancelled) {
          return;
        }
        setModels(Array.isArray(list.models) ? list.models : []);
        setEndpointHost(list.endpointHost ?? null);
        setSettings(saved);
        setFailure(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setModels([]);
        setFailure(toAssistantFailure(error));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [campaignId, reloads]);

  const currentModel =
    models?.find((model) => model.id === settings?.model)?.id ??
    models?.[0]?.id ??
    "";
  const budgetTokens =
    models?.find((model) => model.id === currentModel)?.contextTokens ?? null;
  const totalTokens =
    (size?.totalTokens ?? 0) +
    (size?.instructionTokens ?? 0) +
    conversationTokens;

  // Sizes come from the server (the same code the chat path builds text
  // with), refreshed whenever the saved choice changes. A failure leaves
  // the last sizes up rather than hiding the bar.
  useEffect(() => {
    let cancelled = false;
    fetchAssistantContextSize(campaignId)
      .then((loaded) => {
        if (!cancelled) setSize(loaded);
      })
      .catch(() => {
        if (!cancelled) setSize(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, settings?.context, tab]);

  const saveContext = (context: AssistantContextChoice): void => {
    const previous = settings;
    setSettingsError(null);
    const next: AssistantSettingsDocument = {
      model: settings?.model ?? null,
      context,
      updatedAt: new Date().toISOString(),
    };
    setSettings(next);
    saveAssistantSettings({
      campaignId,
      model: next.model,
      context: next.context,
    }).catch((error: unknown) => {
      setSettings(previous);
      setSettingsError(toAssistantFailure(error));
    });
  };

  const pickModel = (id: string): void => {
    const previous = settings;
    setSettingsError(null);
    const next: AssistantSettingsDocument = {
      model: id,
      context: settings?.context ?? emptyAssistantContextChoice(),
      updatedAt: new Date().toISOString(),
    };
    setSettings(next);
    saveAssistantSettings({
      campaignId,
      model: id,
      context: next.context,
    }).catch((error: unknown) => {
      setSettings(previous);
      setSettingsError(toAssistantFailure(error));
    });
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
      }}
    >
      <Stack
        direction={"row"}
        alignItems={"center"}
        spacing={1}
        sx={{ px: 1.5, pt: 1 }}
      >
        <Typography fontWeight={700} sx={{ flexGrow: 1 }}>
          GM assistant
        </Typography>
        {models !== null && models.length > 0 && (
          <TextField
            select
            size={"small"}
            value={currentModel}
            onChange={(event) => pickModel(event.target.value)}
            SelectProps={{ native: true }}
            inputProps={{ "aria-label": "Model" }}
            sx={{ maxWidth: 200 }}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </TextField>
        )}
        <IconButton onClick={onClose} aria-label={"Close assistant"}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <ContextSizeBar
        totalTokens={totalTokens}
        budgetTokens={budgetTokens}
        onEdit={() => setTab("context")}
      />
      {settingsError && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Alert severity={"error"} onClose={() => setSettingsError(null)}>
            {settingsError.message}
            {settingsError.ref ? ` (ref: ${settingsError.ref})` : ""}
          </Alert>
        </Box>
      )}
      <Tabs
        value={tab}
        onChange={(_, next: AssistantTab) => setTab(next)}
        variant={"fullWidth"}
        aria-label={"Assistant sections"}
        sx={{ minHeight: 40 }}
      >
        <Tab value={"chat"} label={"Chat"} sx={{ minHeight: 40 }} />
        <Tab value={"context"} label={"Context"} sx={{ minHeight: 40 }} />
        <Tab
          value={"outline"}
          label={"Outline"}
          sx={{ minHeight: 40 }}
        />
      </Tabs>
      <Box
        sx={{
          flexGrow: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          borderTop: 1,
          borderColor: "divider",
        }}
      >
        {tab === "chat" && (
          <ChatTab
            campaignId={campaignId}
            models={models}
            failure={failure}
            currentModel={currentModel}
            endpointHost={endpointHost}
            onTokenEstimate={setConversationTokens}
            onRetry={() => {
              setFailure(null);
              setModels(null);
              setReloads((count) => count + 1);
            }}
          />
        )}
        {tab === "context" && (
          <ContextTab
            campaignId={campaignId}
            context={settings?.context ?? emptyAssistantContextChoice()}
            size={size}
            conversationTokens={conversationTokens}
            onSave={saveContext}
          />
        )}
        {tab === "outline" && <OutlineTab campaignId={campaignId} />}
      </Box>
    </Box>
  );
}
