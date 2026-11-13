// PROTOTYPE (#6): what each roll button opens. In the real app these reuse
// the existing move, stat, track and oracle data and the existing rollers;
// here the lists are a small sample and the dice are rolled locally.
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MinusIcon from "@mui/icons-material/Remove";
import PlusIcon from "@mui/icons-material/Add";
import BackIcon from "@mui/icons-material/ArrowBack";
import { useState } from "react";
import { ROLL_RESULT, ROLL_TYPE, Roll } from "types/DieRolls.type";
import { TrackTypes } from "types/Track.type";
import { Character, RollKind } from "./usePrototypeChat";

const d = (n: number) => 1 + Math.floor(Math.random() * n);
const outcome = (score: number, c1: number, c2: number) =>
  score > c1 && score > c2 ? ROLL_RESULT.HIT : score > c1 || score > c2 ? ROLL_RESULT.WEAK_HIT : ROLL_RESULT.MISS;

const base = (characterId: string | null) => ({
  timestamp: new Date(),
  characterId,
  uid: "",
  gmsOnly: false,
});

interface Move {
  name: string;
  stats: string[];
}
const moves: Record<string, Move[]> = {
  Adventure: [
    { name: "Face Danger", stats: ["Edge", "Heart", "Iron", "Shadow", "Wits"] },
    { name: "Secure an Advantage", stats: ["Edge", "Heart", "Iron", "Shadow", "Wits"] },
    { name: "Gather Information", stats: ["Wits"] },
    { name: "Heal", stats: ["Iron", "Wits"] },
    { name: "Resupply", stats: ["Wits"] },
    { name: "Undertake a Journey", stats: ["Wits"] },
  ],
  Relationship: [
    { name: "Compel", stats: ["Heart", "Iron", "Shadow"] },
    { name: "Sojourn", stats: ["Heart"] },
    { name: "Test Your Bond", stats: ["Heart"] },
  ],
  Combat: [
    { name: "Enter the Fray", stats: ["Heart", "Shadow", "Wits"] },
    { name: "Strike", stats: ["Iron", "Edge"] },
    { name: "Clash", stats: ["Iron", "Edge"] },
  ],
};

const oracles: Record<string, { name: string; results: string[] }[]> = {
  "Ask the Oracle": [
    { name: "Almost certain", results: ["Yes", "Yes", "Yes", "No"] },
    { name: "Fifty-fifty", results: ["Yes", "No"] },
    { name: "Unlikely", results: ["Yes", "No", "No", "No"] },
  ],
  "Core oracles": [
    { name: "Action", results: ["Scheme", "Clash", "Reveal", "Protect", "Abandon", "Hunt"] },
    { name: "Theme", results: ["Risk", "Secret", "Bond", "Ruin", "Hope", "Debt"] },
  ],
  Places: [
    { name: "Location", results: ["Ruin", "Bog", "Hollow", "Shrine", "Ridge", "Ford"] },
    { name: "Region", results: ["Barrier Islands", "Ragged Coast", "Deep Wilds", "Flooded Lands"] },
  ],
};

export interface RollPickerProps {
  kind: RollKind | null;
  character: Character | undefined;
  onClose: () => void;
  onRoll: (roll: Roll) => void;
}

export function RollPicker(props: RollPickerProps) {
  const { kind, character, onClose, onRoll } = props;
  const characterId = character?.id ?? null;
  const [search, setSearch] = useState("");
  const [move, setMove] = useState<Move | null>(null);
  const [stat, setStat] = useState<string | null>(null);
  const [adds, setAdds] = useState(0);
  const [notation, setNotation] = useState("2d6");

  const close = () => {
    setSearch("");
    setMove(null);
    setStat(null);
    setAdds(0);
    onClose();
  };
  const done = (roll: Roll) => {
    onRoll(roll);
    close();
  };

  const statValues = character?.stats ?? {};
  const rollStat = (statName: string, moveName?: string) => {
    const action = d(6);
    const modifier = statValues[statName] ?? 0;
    const c1 = d(10);
    const c2 = d(10);
    done({
      ...base(characterId),
      type: ROLL_TYPE.STAT,
      rollLabel: statName,
      moveName,
      action,
      modifier,
      adds: adds || undefined,
      challenge1: c1,
      challenge2: c2,
      result: outcome(Math.min(10, action + modifier + adds), c1, c2),
    });
  };

  const statAndAdds = (onRollStat: (s: string) => void, allowed?: string[]) => (
    <Stack spacing={2}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 1 }}>
        {Object.entries(statValues)
          .filter(([name]) => !allowed || allowed.includes(name))
          .map(([name, value]) => (
            <Button
              key={name}
              variant={stat === name ? "contained" : "outlined"}
              color={"inherit"}
              onClick={() => setStat(name)}
              sx={{ flexDirection: "column", py: 1 }}
            >
              <Typography variant={"h5"}>{value}</Typography>
              <Typography variant={"caption"}>{name}</Typography>
            </Button>
          ))}
      </Box>
      <Stack direction={"row"} alignItems={"center"} spacing={1}>
        <Typography>Adds</Typography>
        <IconButton size={"small"} onClick={() => setAdds((a) => Math.max(0, a - 1))} aria-label={"Fewer adds"}>
          <MinusIcon />
        </IconButton>
        <Typography variant={"h6"} sx={{ minWidth: 24, textAlign: "center" }}>
          {adds}
        </Typography>
        <IconButton size={"small"} onClick={() => setAdds((a) => a + 1)} aria-label={"More adds"}>
          <PlusIcon />
        </IconButton>
      </Stack>
      <Button variant={"contained"} size={"large"} disabled={!stat} onClick={() => stat && onRollStat(stat)}>
        {stat ? `Roll +${stat}${adds ? ` +${adds}` : ""}` : "Pick a stat"}
      </Button>
    </Stack>
  );

  let title = "";
  let body = null;
  const q = search.toLowerCase();
  const searchBox = (
    <TextField fullWidth size={"small"} placeholder={"Search"} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus sx={{ mb: 1 }} />
  );

  if (kind === "stat") {
    title = `Roll a stat as ${character?.name ?? "you"}`;
    body = statAndAdds((s) => rollStat(s));
  } else if (kind === "move" && move) {
    title = move.name;
    body = statAndAdds((s) => rollStat(s, move.name), move.stats);
  } else if (kind === "move") {
    title = "Make a move";
    body = (
      <>
        {searchBox}
        <List dense>
          {Object.entries(moves).map(([category, list]) => {
            const shown = list.filter((m) => m.name.toLowerCase().includes(q));
            if (!shown.length) return null;
            return (
              <Box key={category}>
                <ListSubheader disableSticky>{category}</ListSubheader>
                {shown.map((m) => (
                  <ListItemButton
                    key={m.name}
                    onClick={() => {
                      setMove(m);
                      setStat(m.stats.length === 1 ? m.stats[0] : null);
                    }}
                  >
                    <ListItemText primary={m.name} secondary={`+${m.stats.join(" / +")}`} />
                  </ListItemButton>
                ))}
              </Box>
            );
          })}
        </List>
      </>
    );
  } else if (kind === "progress") {
    title = "Progress roll";
    body = (
      <List>
        {(character?.tracks ?? []).map((t) => (
          <ListItemButton
            key={t.label}
            onClick={() => {
              const c1 = d(10);
              const c2 = d(10);
              done({
                ...base(characterId),
                type: ROLL_TYPE.TRACK_PROGRESS,
                rollLabel: t.label,
                trackProgress: t.progress,
                challenge1: c1,
                challenge2: c2,
                result: outcome(t.progress, c1, c2),
                trackType: t.type === "vow" ? TrackTypes.Vow : t.type === "journey" ? TrackTypes.Journey : TrackTypes.BondProgress,
              });
            }}
          >
            <ListItemText
              primary={t.label}
              secondary={
                <Stack direction={"row"} spacing={1} alignItems={"center"} component={"span"}>
                  <Chip size={"small"} label={t.type} component={"span"} />
                  <Box component={"span"} sx={{ flexGrow: 1 }}><LinearProgress variant={"determinate"} value={t.progress * 10} /></Box>
                  <span>{t.progress}/10</span>
                </Stack>
              }
            />
          </ListItemButton>
        ))}
        {!character?.tracks.length && <Typography color={"text.secondary"}>No progress tracks.</Typography>}
      </List>
    );
  } else if (kind === "oracle") {
    title = "Roll an oracle";
    body = (
      <>
        {searchBox}
        <List dense>
          {Object.entries(oracles).map(([category, list]) => {
            const shown = list.filter((o) => `${category} ${o.name}`.toLowerCase().includes(q));
            if (!shown.length) return null;
            return (
              <Box key={category}>
                <ListSubheader disableSticky>{category}</ListSubheader>
                {shown.map((o) => (
                  <ListItemButton
                    key={o.name}
                    onClick={() => {
                      const r = d(100);
                      done({
                        ...base(characterId),
                        type: ROLL_TYPE.ORACLE_TABLE,
                        rollLabel: o.name,
                        oracleCategoryName: category,
                        roll: r,
                        result: o.results[(r - 1) % o.results.length],
                      });
                    }}
                  >
                    <ListItemText primary={o.name} />
                  </ListItemButton>
                ))}
              </Box>
            );
          })}
        </List>
      </>
    );
  } else if (kind === "dice") {
    title = "Custom dice";
    const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(notation.replace(/\s/g, ""));
    body = (
      <Stack spacing={2}>
        <TextField label={"Dice"} helperText={"For example 2d6, 1d10+2"} value={notation} onChange={(e) => setNotation(e.target.value)} autoFocus />
        <Button
          variant={"contained"}
          disabled={!m}
          onClick={() => {
            if (!m) return;
            const values = Array.from({ length: Math.min(20, +m[1]) }, () => d(+m[2]));
            const modifier = m[3] ? +m[3] : 0;
            done({
              ...base(characterId),
              type: ROLL_TYPE.CUSTOM_DICE,
              rollLabel: notation,
              notation,
              dieSides: +m[2],
              dieValues: values,
              modifier,
              total: values.reduce((a, b) => a + b, 0) + modifier,
            });
          }}
        >
          Roll {notation}
        </Button>
      </Stack>
    );
  }

  return (
    <Dialog open={!!kind} onClose={close} fullWidth maxWidth={"xs"}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {kind === "move" && move && (
          <IconButton size={"small"} onClick={() => setMove(null)} aria-label={"Back to moves"}>
            <BackIcon />
          </IconButton>
        )}
        {title}
      </DialogTitle>
      <DialogContent>{body}</DialogContent>
      <DialogActions>
        <Button color={"inherit"} onClick={close}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
