import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  fetchAssistantContextOptions,
  type AssistantContextOptions,
} from "api-calls/assistant/assistantContextOptions";
import type { AssistantContextChoice } from "api-calls/assistant/_assistant.type";
import type { AssistantContextSize } from "api-calls/assistant/gmAssistantClient";

/**
 * The GM assistant's Context tab (spec #10, ticket #132): the checklist of
 * what the assistant may read, grouped as campaign outline, lore, NPCs,
 * locations, notes and recent posts. Each entry shows its approximate size
 * from the server; world entries carry an eye toggle for their GM-only
 * part, and each channel has a post-count field. Chips show the
 * conversation and instruction overhead beside the context total. Every
 * change saves the choice (references only, never text) to
 * assistant_settings for this GM in this campaign; the server builds the
 * actual text at request time.
 */
export function ContextTab(props: {
  campaignId: string;
  context: AssistantContextChoice;
  size: AssistantContextSize | null;
  conversationTokens: number;
  onSave: (context: AssistantContextChoice) => void;
}) {
  const { campaignId, context, size, conversationTokens, onSave } = props;
  const [options, setOptions] = useState<AssistantContextOptions | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setFailed(false);
    fetchAssistantContextOptions({ campaignId })
      .then((loaded) => {
        if (!cancelled) setOptions(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, reloads]);

  const sizeByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of size?.items ?? []) map.set(item.key, item.tokens);
    return map;
  }, [size]);

  const toggleEntry = (
    list: "lore" | "npcs" | "locations",
    id: string
  ): void => {
    const selected = context[list].some((entry) => entry.id === id);
    onSave({
      ...context,
      [list]: selected
        ? context[list].filter((entry) => entry.id !== id)
        : [...context[list], { id, includeGmParts: false }],
    });
  };

  const toggleGmParts = (list: "lore" | "npcs" | "locations", id: string): void => {
    onSave({
      ...context,
      [list]: context[list].map((entry) =>
        entry.id === id
          ? { ...entry, includeGmParts: !entry.includeGmParts }
          : entry
      ),
    });
  };

  if (failed) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert
          severity={"error"}
          action={
            <Button size={"small"} onClick={() => setReloads((n) => n + 1)}>
              Retry
            </Button>
          }
        >
          The assistant couldn&apos;t list the campaign material.
        </Alert>
      </Box>
    );
  }

  if (!options) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress aria-label={"Loading context options"} />
      </Box>
    );
  }

  const gmOn = (list: "lore" | "npcs" | "locations", id: string): boolean =>
    context[list].some((entry) => entry.id === id && entry.includeGmParts);
  const checked = (list: "lore" | "npcs" | "locations", id: string): boolean =>
    context[list].some((entry) => entry.id === id);

  const renderEntry = (
    list: "lore" | "npcs" | "locations",
    id: string,
    name: string
  ) => (
    <Box
      key={id}
      sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 1 }}
    >
      <FormControlLabel
        sx={{ flexGrow: 1, mr: 0 }}
        control={
          <Checkbox
            size={"small"}
            checked={checked(list, id)}
            onChange={() => toggleEntry(list, id)}
            inputProps={{ "aria-label": `Include ${name}` }}
          />
        }
        label={<Typography variant={"body2"}>{name}</Typography>}
      />
      <IconButton
        size={"small"}
        disabled={!checked(list, id)}
        aria-pressed={gmOn(list, id)}
        aria-label={`Include GM-only part of ${name}`}
        title={
          gmOn(list, id)
            ? "GM-only part included"
            : "GM-only part left out"
        }
        onClick={() => toggleGmParts(list, id)}
      >
        {gmOn(list, id) ? (
          <VisibilityIcon fontSize={"small"} />
        ) : (
          <VisibilityOffIcon fontSize={"small"} />
        )}
      </IconButton>
      {sizeByKey.has(`${list === "npcs" ? "npc" : list === "locations" ? "location" : "lore"}:${id}`) && (
        <Typography variant={"caption"} color={"text.secondary"} sx={{ pr: 1 }}>
          ~
          {
            sizeByKey.get(
              `${list === "npcs" ? "npc" : list === "locations" ? "location" : "lore"}:${id}`
            )
          }{" "}
          tokens
        </Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", p: 1.5 }}>
      <Stack direction={"row"} spacing={1} sx={{ flexWrap: "wrap", mb: 1 }}>
        <Chip
          size={"small"}
          label={`Context ~${size?.totalTokens ?? 0} tokens`}
        />
        <Chip size={"small"} label={`Conversation ~${conversationTokens} tokens`} />
        <Chip
          size={"small"}
          label={`Instructions ~${size?.instructionTokens ?? 0} tokens`}
        />
      </Stack>
      {size && size.unavailable.length > 0 && (
        <Alert severity={"warning"} sx={{ mb: 1 }}>
          {size.unavailable.length} saved{" "}
          {size.unavailable.length === 1 ? "reference is" : "references are"}{" "}
          no longer available and {size.unavailable.length === 1 ? "was" : "were"} skipped.
        </Alert>
      )}

      <Typography variant={"subtitle2"}>Campaign outline</Typography>
      <Box sx={{ pl: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              size={"small"}
              checked={context.includeOutline}
              disabled={!options.outlineAvailable}
              onChange={() =>
                onSave({ ...context, includeOutline: !context.includeOutline })
              }
              inputProps={{ "aria-label": "Include campaign outline" }}
            />
          }
          label={
            <Typography variant={"body2"}>
              Include the outline
              {sizeByKey.has("outline") && ` (~${sizeByKey.get("outline")} tokens)`}
            </Typography>
          }
        />
        {!options.outlineAvailable && (
          <Typography variant={"caption"} color={"text.secondary"}>
            Open the Outline tab once to create it.
          </Typography>
        )}
      </Box>

      {(
        [
          ["Lore", options.lore, "lore"],
          ["NPCs", options.npcs, "npcs"],
          ["Locations", options.locations, "locations"],
        ] as const
      ).map(([heading, entries, list]) => (
        <Box key={heading} sx={{ mt: 1 }}>
          <Typography variant={"subtitle2"}>{heading}</Typography>
          {entries.length === 0 ? (
            <Typography variant={"caption"} color={"text.secondary"} sx={{ pl: 2 }}>
              None yet.
            </Typography>
          ) : (
            entries.map((entry) => renderEntry(list, entry.id, entry.name))
          )}
        </Box>
      ))}

      <Typography variant={"subtitle2"} sx={{ mt: 1 }}>
        Notes
      </Typography>
      {options.notes.length === 0 ? (
        <Typography variant={"caption"} color={"text.secondary"} sx={{ pl: 2 }}>
          No notes yet.
        </Typography>
      ) : (
        options.notes.map((note) => {
          const selected = context.notes.includes(note.id);
          return (
            <Box
              key={note.id}
              sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 1 }}
            >
              <FormControlLabel
                sx={{ flexGrow: 1, mr: 0 }}
                control={
                  <Checkbox
                    size={"small"}
                    checked={selected}
                    onChange={() =>
                      onSave({
                        ...context,
                        notes: selected
                          ? context.notes.filter((id) => id !== note.id)
                          : [...context.notes, note.id],
                      })
                    }
                    inputProps={{ "aria-label": `Include ${note.title}` }}
                  />
                }
                label={<Typography variant={"body2"}>{note.title}</Typography>}
              />
              {sizeByKey.has(`note:${note.id}`) && (
                <Typography variant={"caption"} color={"text.secondary"} sx={{ pr: 1 }}>
                  ~{sizeByKey.get(`note:${note.id}`)} tokens
                </Typography>
              )}
            </Box>
          );
        })
      )}

      <Typography variant={"subtitle2"} sx={{ mt: 1 }}>
        Recent posts
      </Typography>
      {options.channels.length === 0 ? (
        <Typography variant={"caption"} color={"text.secondary"} sx={{ pl: 2 }}>
          No channels yet.
        </Typography>
      ) : (
        options.channels.map((channel) => {
          const ref = context.channels.find((entry) => entry.id === channel.id);
          return (
            <Box
              key={channel.id}
              sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1 }}
            >
              <FormControlLabel
                sx={{ flexGrow: 1, mr: 0 }}
                control={
                  <Checkbox
                    size={"small"}
                    checked={Boolean(ref)}
                    onChange={() =>
                      onSave({
                        ...context,
                        channels: ref
                          ? context.channels.filter((entry) => entry.id !== channel.id)
                          : [...context.channels, { id: channel.id, postCount: 5 }],
                      })
                    }
                    inputProps={{ "aria-label": `Include ${channel.name}` }}
                  />
                }
                label={
                  <Typography variant={"body2"}>
                    {channel.name}
                    {channel.visibility === "dm" ? " (direct)" : ""}
                  </Typography>
                }
              />
              {sizeByKey.has(`channel:${channel.id}`) && (
                <Typography variant={"caption"} color={"text.secondary"}>
                  ~{sizeByKey.get(`channel:${channel.id}`)} tokens
                </Typography>
              )}
              <TextField
                size={"small"}
                type={"number"}
                disabled={!ref}
                value={ref?.postCount ?? 5}
                onChange={(event) => {
                  const count = Math.min(
                    50,
                    Math.max(1, Number.parseInt(event.target.value, 10) || 1)
                  );
                  onSave({
                    ...context,
                    channels: context.channels.map((entry) =>
                      entry.id === channel.id ? { ...entry, postCount: count } : entry
                    ),
                  });
                }}
                inputProps={{
                  "aria-label": `Post count for ${channel.name}`,
                  min: 1,
                  max: 50,
                }}
                sx={{ width: 76 }}
              />
            </Box>
          );
        })
      )}
      <Typography variant={"caption"} color={"text.secondary"} sx={{ mt: 1 }}>
        The server builds the text from these references when you chat. A
        reference you can no longer read is skipped, never leaked.
      </Typography>
    </Box>
  );
}
