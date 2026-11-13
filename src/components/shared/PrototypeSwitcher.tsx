// PROTOTYPE helper: floating bar to flip between UI variants (?variant=).
// Hidden in production builds.
import { Box, IconButton, Typography } from "@mui/material";
import LeftIcon from "@mui/icons-material/ChevronLeft";
import RightIcon from "@mui/icons-material/ChevronRight";
import { ReactNode, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export interface PrototypeSwitcherProps {
  variants: { key: string; name: string }[];
  current: string;
  // Extra state shown in the bar, so you can see what changed.
  children?: ReactNode;
  // Controls kept visible on small screens too.
  alwaysShown?: ReactNode;
}

export function PrototypeSwitcher(props: PrototypeSwitcherProps) {
  const { variants, current, children, alwaysShown } = props;
  const [, setParams] = useSearchParams();
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    setParams((p) => {
      p.set("variant", next.key);
      return p;
    }, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 3000,
        bgcolor: "#111",
        color: "#fff",
        borderRadius: 999,
        boxShadow: 6,
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        fontFamily: "monospace",
        maxWidth: "96vw",
        flexWrap: "nowrap",
        whiteSpace: "nowrap",
        justifyContent: "center",
      }}
    >
      <IconButton size={"small"} onClick={() => go(-1)} sx={{ color: "#fff" }} aria-label={"Previous variant"}>
        <LeftIcon />
      </IconButton>
      <Typography sx={{ fontFamily: "monospace", fontSize: 14 }}>
        {variants[index].key} ({variants[index].name})
      </Typography>
      <IconButton size={"small"} onClick={() => go(1)} sx={{ color: "#fff" }} aria-label={"Next variant"}>
        <RightIcon />
      </IconButton>
      {alwaysShown}
      <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center" }}>{children}</Box>
    </Box>
  );
}
