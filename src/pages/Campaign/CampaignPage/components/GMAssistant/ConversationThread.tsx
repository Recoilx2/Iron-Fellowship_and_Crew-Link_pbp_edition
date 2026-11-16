import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import HistoryIcon from "@mui/icons-material/History";
import CopyIcon from "@mui/icons-material/ContentCopy";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import ComposerIcon from "@mui/icons-material/Reply";
import {
  approximateTokensForChars,
  extractOutlineProposal,
  streamAssistantChat,
} from "api-calls/assistant/gmAssistantClient";
import { listenToConversations } from "api-calls/assistant/listenToConversations";
import { listenToMessages } from "api-calls/assistant/listenToMessages";
import { createConversation } from "api-calls/assistant/createConversation";
import { deleteConversation } from "api-calls/assistant/deleteConversation";
import { toAssistantFailure } from "./assistantFailure";
import type { ModelsFailure } from "./ChatTab";
import { OutlineRevision } from "./OutlineRevision";
import { saveProposalState } from "api-calls/assistant/saveProposalState";
import { useOutlineDocument } from "./useOutlineDocument";
import { useStore } from "stores/store";
import type {
  AssistantConversationWithId,
  AssistantMessageWithId,
} from "api-calls/assistant/_assistant.type";

/**
 * The Chat tab's conversation thread (spec #10, tickets #130-#133): the
 * conversation header with its history menu, the streamed replies with
 * Copy and Send-to-composer, outline-revision previews on marked replies,
 * and the composer with its Revise-outline toggle and Stop button. Split
 * out of `GMAssistantPanel.tsx` (ticket #151).
 */
export function ConversationThread(props: { campaignId: string; currentModel: string; endpointHost: string | null; onTokenEstimate?: (tokens: number) => void }) {
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
  const [threadError, setThreadError] = useState<ModelsFailure | null>(null);
  // Dedicated outline-revision mode for the next message: the server
  // includes the current outline and asks for a marked complete
  // replacement, which previews side by side below. Never guessed from
  // the wording -- the GM arms it explicitly for one send.
  const [revisionMode, setRevisionMode] = useState(false);
  // Dismissals are saved on the reply (ticket #148); this only covers the
  // moment before the saved state arrives, or a save that failed.
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
    setThreadError(null);
    try {
      setSelectedId(await createConversation({ campaignId }));
    } catch (error) {
      setThreadError(toAssistantFailure(error));
    }
  };

  const removeConversation = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    const gone = selectedId;
    const kept = conversations.filter((entry) => entry.id !== gone);
    setThreadError(null);
    try {
      await deleteConversation({ conversationId: gone });
    } catch (error) {
      setThreadError(toAssistantFailure(error));
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
      setThreadError(null);
      try {
        targetId = await createConversation({ campaignId });
      } catch (error) {
        setThreadError(toAssistantFailure(error));
        return;
      }
      setSelectedId(targetId);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText("");
    setThreadError(null);
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
      setThreadError(toAssistantFailure(error));
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
                setThreadError(null);
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
                (() => {
                  const proposed = extractOutlineProposal(message.content);
                  if (!proposed || !outlineId) {
                    return null;
                  }
                  if (
                    message.proposalState === "dismissed" ||
                    dismissedRevisions[message.id]
                  ) {
                    return (
                      <Typography
                        variant={"caption"}
                        color={"text.secondary"}
                        display={"block"}
                        sx={{ mt: 0.5 }}
                      >
                        Outline revision dismissed.
                      </Typography>
                    );
                  }
                  return (
                    <OutlineRevision
                      campaignId={campaignId}
                      outlineId={outlineId}
                      current={outlineText}
                      proposed={proposed}
                      proposal={{
                        state: message.proposalState,
                        appliedVersionId: message.appliedVersionId,
                      }}
                      onProposalChange={(outcome) =>
                        saveProposalState({
                          messageId: message.id,
                          ...outcome,
                        })
                      }
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
      {threadError && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Alert severity={"error"} onClose={() => setThreadError(null)}>
            {threadError.message}
            {threadError.ref ? ` (ref: ${threadError.ref})` : ""}
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
