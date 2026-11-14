import { Box, Button, LinearProgress, Typography } from "@mui/material";

/**
 * The assistant size bar (spec #10, ticket #132): the approximate total
 * context against the chosen model's context size, with a warning line
 * when the total is near (>= 80%) or over the budget. Edit jumps to the
 * Context tab. Without a known budget (no models) it shows the total
 * alone.
 */
export function ContextSizeBar(props: {
  totalTokens: number;
  budgetTokens: number | null;
  onEdit: () => void;
}) {
  const { totalTokens, budgetTokens, onEdit } = props;
  const ratio =
    budgetTokens && budgetTokens > 0 ? totalTokens / budgetTokens : null;
  const over = ratio !== null && ratio >= 1;
  const near = ratio !== null && !over && ratio >= 0.8;

  return (
    <Box sx={{ px: 1.5, pb: 0.5 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant={"caption"} color={"text.secondary"} sx={{ flexGrow: 1 }}>
          {budgetTokens
            ? `~${totalTokens} / ${budgetTokens} tokens`
            : `~${totalTokens} tokens`}
        </Typography>
        <Button size={"small"} onClick={onEdit} aria-label={"Edit context"}>
          Edit
        </Button>
      </Box>
      {budgetTokens ? (
        <LinearProgress
          variant={"determinate"}
          value={Math.min(100, (ratio ?? 0) * 100)}
          color={over ? "error" : near ? "warning" : "primary"}
          aria-label={"Context size"}
        />
      ) : null}
      {near && (
        <Typography variant={"caption"} color={"warning.main"}>
          Near the model&apos;s context size — trim the context.
        </Typography>
      )}
      {over && (
        <Typography variant={"caption"} color={"error"}>
          Over the model&apos;s context size — trim the context.
        </Typography>
      )}
    </Box>
  );
}
