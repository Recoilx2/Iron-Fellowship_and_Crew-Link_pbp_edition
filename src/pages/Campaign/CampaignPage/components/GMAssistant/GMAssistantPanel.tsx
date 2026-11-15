import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import HistoryIcon from "@mui/icons-material/History";
import CopyIcon from "@mui/icons-material/ContentCopy";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import ComposerIcon from "@mui/icons-material/Reply";
import {
  fetchAssistantContextSize,
  approximateTokensForChars,
  extractOutlineProposal,
  fetchAssistantModels,
  streamAssistantChat,
  type AssistantContextSize,
  type AssistantModelOption,
} from "api-calls/assistant/gmAssistantClient";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
} from "api-calls/assistant/assistantSettings";
import { listenToConversations } from "api-calls/assistant/listenToConversations";
import { listenToMessages } from "api-calls/assistant/listenToMessages";
import { createConversation } from "api-calls/assistant/createConversation";
import { deleteConversation } from "api-calls/assistant/deleteConversation";
import { toAssistantFailure } from "./assistantFailure";
import { ContextSizeBar } from "./ContextSizeBar";
import { ContextTab } from "./ContextTab";
import { OutlineTab } from "./OutlineTab";
import { OutlineRevision } from "./OutlineRevision";
import { useOutlineDocument } from "./useOutlineDocument";
import { useStore } from "stores/store";
import type {
  AssistantConversationWithId,
  AssistantMessageWithId,
} from "api-calls/assistant/_assistant.type";
import {
  emptyAssistantContextChoice,
  type AssistantContextChoice,
  type AssistantSettingsDocument,
} from "api-calls/assistant/_assistant.type";

type AssistantTab = "chat" | "context" | "outline";

interface ModelsFailure {
  code: string;
  message: string;
  ref: string | null;
}

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
    }).catch(() => {
      setSettings(previous);
    });
  };

  const pickModel = (id: string): void => {
    const previous = settings;
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
    }).catch(() => {
      setSettings(previous);
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

function ChatTab(props: {
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

function ConversationThread(props: { campaignId: string; currentModel: string; endpointHost: string | null; onTokenEstimate?: (tokens: number) => void }) {
  const { campaignId, currentModel, endpointHost, onTokenEstimate } = props;
  const [conversations, setConversations] = useState<
    AssistantConversationWithId[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageWithId[]>([]);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(
    null
  );
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ModelsFailure | null>(null);
  // Dedicated outline-revision mode for the next message: the server
  // includes the current outline and asks for a marked complete
  // replacement, which previews side by side below. Never guessed from
  // the wording -- the GM arms it explicitly for one send.
  const [revisionMode, setRevisionMode] = useState(false);
  const [dismissedRevisions, setDismissedRevisions] = useState<
    Record<string, boolean>
  >({});
  const { outlineId, text: outlineText } = useOutlineDocument(campaignId);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const openChannelId = useStore((store) => store.chat.openChannelId);
  const setDraft = useStore((store) => store.chat.setDraft);

  // The size bar counts the open conversation beside the server-sized
  // context and instructions, with the same character-to-token estimate.
  useEffect(() => {
    if (!onTokenEstimate) return;
    const chars =
      messages.reduce((sum, message) => sum + message.content.length, 0) +
      (streamingText?.length ?? 0);
    onTokenEstimate(approximateTokensForChars(chars));
  }, [messages, streamingText, onTokenEstimate]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, streamingText]);

  useEffect(
    () =>
      listenToConversations(
        campaignId,
        {
          onConversations: (list) => {
            setConversations(list);
            setSelectedId((current) =>
              current && list.some((entry) => entry.id === current)
                ? current
                : (list[0]?.id ?? null)
            );
          },
          onLoaded: () => {},
        },
        () => {}
      ),
    [campaignId]
  );

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    return listenToMessages(
      selectedId,
      {
        onMessages: setMessages,
        onLoaded: () => {},
      },
      () => {}
    );
  }, [selectedId]);

  const selected = conversations.find((entry) => entry.id === selectedId);

  const startConversation = async (): Promise<void> => {
    const id = await createConversation({ campaignId }).catch(() => null);
    if (id) {
      setSelectedId(id);
    }
  };

  const removeConversation = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    const gone = selectedId;
    const kept = conversations.filter((entry) => entry.id !== gone);
    const deleted = await deleteConversation({ conversationId: gone })
      .then(() => true)
      .catch(() => false);
    if (!deleted) {
      return;
    }
    setConversations(kept);
    setSelectedId(kept[0]?.id ?? null);
  };

  const copyReply = (text: string): void => {
    try {
      void navigator.clipboard?.writeText(text)?.catch(() => {});
    } catch {
      // Clipboard access is best-effort: the text stays visible to copy
      // by hand when the browser refuses programmatic access.
    }
  };

  const sendToComposer = (text: string): void => {
    if (openChannelId) {
      setDraft(openChannelId, text);
    }
  };

  const send = async (): Promise<void> => {
    const trimmed = input.trim();
    if (trimmed.length === 0 || streamingText !== null) {
      return;
    }
    let targetId = selectedId;
    if (!targetId) {
      try {
        targetId = await createConversation({ campaignId });
      } catch {
        targetId = null;
      }
      if (!targetId) {
        return;
      }
      setSelectedId(targetId);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText("");
    setSendError(null);
    setInput("");
    try {
      await streamAssistantChat({
        conversationId: targetId,
        message: trimmed,
        ...(revisionMode ? { mode: "outline-revision" as const } : {}),
        signal: controller.signal,
        onChunk: (chunk) =>
          setStreamingText((previous) => (previous ?? "") + chunk),
      });
      // The finished reply arrives through the message listener, which
      // also carries the stopped marker when the GM stopped it partway.
    } catch (error) {
      setSendError(toAssistantFailure(error));
    } finally {
      abortRef.current = null;
      setStreamingText(null);
      setRevisionMode(false);
    }
  };

  const stop = (): void => {
    abortRef.current?.abort();
  };

  return (
    <>
      <Stack
        direction={"row"}
        alignItems={"center"}
        spacing={0.5}
        sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}
      >
        <Tooltip title={"Conversations"}>
          <IconButton
            size={"small"}
            aria-label={"Conversations"}
            onClick={(event) => setHistoryAnchor(event.currentTarget)}
          >
            <HistoryIcon fontSize={"small"} />
          </IconButton>
        </Tooltip>
        <Typography noWrap sx={{ flexGrow: 1, fontSize: 14 }}>
          {selected?.title ?? "New conversation"}
        </Typography>
        <Tooltip title={"New conversation"}>
          <IconButton
            size={"small"}
            aria-label={"New conversation"}
            onClick={() => void startConversation()}
          >
            <AddIcon fontSize={"small"} />
          </IconButton>
        </Tooltip>
        <Tooltip title={"Delete conversation"}>
          <IconButton
            size={"small"}
            aria-label={"Delete conversation"}
            disabled={!selectedId}
            onClick={() => void removeConversation()}
          >
            <DeleteIcon fontSize={"small"} />
          </IconButton>
        </Tooltip>
        <Menu
          disablePortal
          open={historyAnchor !== null}
          anchorEl={historyAnchor}
          onClose={() => setHistoryAnchor(null)}
        >
          {conversations.map((entry) => (
            <MenuItem
              key={entry.id}
              selected={entry.id === selectedId}
              onClick={() => {
                setSelectedId(entry.id);
                setHistoryAnchor(null);
              }}
            >
              {entry.title}
            </MenuItem>
          ))}
        </Menu>
      </Stack>
      <Box sx={{ flexGrow: 1, overflowY: "auto", p: 1.5, minHeight: 0 }}>
        {selectedId === null && (
          <Typography variant={"body2"} color={"text.secondary"}>
            Start a new conversation to think the story through.
          </Typography>
        )}
        {selectedId !== null && messages.length === 0 && (
          <Typography variant={"body2"} color={"text.secondary"}>
            Ask the assistant anything about your campaign.
          </Typography>
        )}
        <Stack spacing={1.5}>
          {messages.map((message) => (
            <Box
              key={message.id}
              sx={{
                alignSelf: message.role === "user" ? "flex-end" : "stretch",
                maxWidth: message.role === "user" ? "85%" : "100%",
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor:
                    message.role === "user" ? "primary.main" : "action.hover",
                  color:
                    message.role === "user"
                      ? "primary.contrastText"
                      : "text.primary",
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                }}
              >
                {message.content}
                {message.stoppedPartway && (
                  <Typography
                    variant={"caption"}
                    display={"block"}
                    color={
                      message.role === "user"
                        ? "primary.contrastText"
                        : "text.secondary"
                    }
                  >
                    (stopped)
                  </Typography>
                )}
              </Box>
              {message.role === "assistant" && message.content && (
                <Stack direction={"row"} spacing={0.5} sx={{ mt: 0.5 }}>
                  <Tooltip title={"Copy"}>
                    <IconButton
                      size={"small"}
                      aria-label={"Copy reply"}
                      onClick={() => copyReply(message.content)}
                    >
                      <CopyIcon fontSize={"inherit"} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip
                    title={
                      openChannelId
                        ? "Fill the chat composer with this reply"
                        : "Open a channel first"
                    }
                  >
                    <span>
                      <Button
                        size={"small"}
                        startIcon={<ComposerIcon />}
                        disabled={!openChannelId}
                        onClick={() => sendToComposer(message.content)}
                        aria-label={"Send to composer"}
                      >
                        Send to composer
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              )}
              {message.role === "assistant" &&
                message.content &&
                !dismissedRevisions[message.id] &&
                (() => {
                  const proposed = extractOutlineProposal(message.content);
                  if (!proposed || !outlineId) {
                    return null;
                  }
                  return (
                    <OutlineRevision
                      campaignId={campaignId}
                      outlineId={outlineId}
                      current={outlineText}
                      proposed={proposed}
                      onDiscard={() =>
                        setDismissedRevisions((dismissed) => ({
                          ...dismissed,
                          [message.id]: true,
                        }))
                      }
                    />
                  );
                })()}
            </Box>
          ))}
          {streamingText !== null && (
            <Box sx={{ alignSelf: "stretch", maxWidth: "100%" }}>
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: "action.hover",
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                }}
              >
                {streamingText}
                <Box component={"span"} sx={{ opacity: 0.6 }}>
                  {" "}
                  ▍
                </Box>
              </Box>
            </Box>
          )}
        </Stack>
        <div ref={endRef} />
      </Box>
      {sendError && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Alert severity={"error"} onClose={() => setSendError(null)}>
            {sendError.message}
            {sendError.ref ? ` (ref: ${sendError.ref})` : ""}
          </Alert>
        </Box>
      )}
      <Box sx={{ borderTop: 1, borderColor: "divider", p: 1 }}>
        <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
          <TextField
            multiline
            maxRows={6}
            fullWidth
            size={"small"}
            placeholder={
              revisionMode
                ? "How should the outline change?"
                : "Ask the assistant…"
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Tooltip
            title={
              revisionMode
                ? "Revision mode on: the next send asks for an outline revision"
                : "Send the next message as an outline revision"
            }
          >
            <span>
              <Button
                size={"small"}
                variant={revisionMode ? "contained" : "outlined"}
                disabled={streamingText !== null}
                onClick={() => setRevisionMode((on) => !on)}
                aria-label={"Revise outline"}
                aria-pressed={revisionMode}
              >
                Revise outline
              </Button>
            </span>
          </Tooltip>
          {streamingText !== null ? (
            <IconButton color={"error"} onClick={stop} aria-label={"Stop reply"}>
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton
              color={"primary"}
              onClick={() => void send()}
              disabled={input.trim().length === 0}
              aria-label={"Send to assistant"}
            >
              <SendIcon />
            </IconButton>
          )}
        </Stack>
        <Typography variant={"caption"} color={"text.secondary"}>
          Drafts use {currentModel || "the default model"}.{" "}
          {endpointHost
            ? `Requests go to ${endpointHost} via this server.`
            : "Requests go to this server's configured endpoint."}{" "}
          Players never see the assistant.
        </Typography>
      </Box>
    </>
  );
}
