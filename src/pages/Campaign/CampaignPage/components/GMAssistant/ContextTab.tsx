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
import {
  fetchAssistantContextSize,
  type AssistantContextSize,
} from "api-calls/assistant/gmAssistantClient";
import { referenceFor, withReference } from "./assistantFailure";

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
 *
 * Every candidate shows a size before it is ticked (ticket #149): once the
 * options load, the whole candidate list goes to the server in one batched
 * preview request (GM-only parts left out, channels at the default post
 * count). A ticked entry keeps the size of its saved choice. While the
 * preview loads a candidate shows an ellipsis; if it fails, or the server
 * has no size for it, a dash. No error text is shown for it.
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
  const [failedRef, setFailedRef] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setFailedRef(null);
    fetchAssistantContextOptions({ campaignId })
      .then((loaded) => {
        if (!cancelled) setOptions(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailedRef(referenceFor(error));
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, reloads]);

  // One batched request sizes every candidate; the answer is keyed by the
  // same item keys the saved-context size uses.
  const [preview, setPreview] = useState<
    "loading" | "failed" | Map<string, number>
  >("loading");
  useEffect(() => {
    setPreview("loading");
    if (!options) return;
    let cancelled = false;
    const candidates: AssistantContextChoice = {
      includeOutline: options.outlineAvailable,
      lore: options.lore.map((entry) => ({ id: entry.id, includeGmParts: false })),
      npcs: options.npcs.map((entry) => ({ id: entry.id, includeGmParts: false })),
      locations: options.locations.map((entry) => ({
        id: entry.id,
        includeGmParts: false,
      })),
      notes: options.notes.map((note) => note.id),
      channels: options.channels.map((channel) => ({
        id: channel.id,
        postCount: 5,
      })),
    };
    fetchAssistantContextSize(campaignId, { preview: candidates })
      .then((sized) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        const empty = new Set(
          sized.unavailable
            .filter((entry) => entry.reason === "empty")
            .map((entry) => entry.key)
        );
        for (const key of empty) map.set(key, 0);
        for (const item of sized.items) map.set(item.key, item.tokens);
        setPreview(map);
      })
      .catch(() => {
        if (!cancelled) setPreview("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, options]);

  const sizeByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of size?.items ?? []) map.set(item.key, item.tokens);
    return map;
  }, [size]);

  /** "~N tokens" for a key: the saved choice's size, else the preview's. */
  const sizeLabel = (key: string): string => {
    const saved = sizeByKey.get(key);
    if (saved !== undefined) return `~${saved} tokens`;
    if (preview === "loading") return "…";
    const previewed = preview === "failed" ? undefined : preview.get(key);
    return previewed === undefined ? "–" : `~${previewed} tokens`;
  };

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

  if (failedRef) {
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
          {withReference(
            "The assistant couldn't list the campaign material.",
            failedRef
          )}
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
      <Typography variant={"caption"} color={"text.secondary"} sx={{ pr: 1 }}>
        {sizeLabel(
          `${list === "npcs" ? "npc" : list === "locations" ? "location" : "lore"}:${id}`
        )}
      </Typography>
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
              {options.outlineAvailable && ` (${sizeLabel("outline")})`}
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
              <Typography variant={"caption"} color={"text.secondary"} sx={{ pr: 1 }}>
                {sizeLabel(`note:${note.id}`)}
              </Typography>
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
              <Typography variant={"caption"} color={"text.secondary"}>
                {sizeLabel(`channel:${channel.id}`)}
              </Typography>
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
