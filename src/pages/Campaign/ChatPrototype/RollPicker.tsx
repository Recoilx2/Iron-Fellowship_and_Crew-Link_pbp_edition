// PROTOTYPE (#6): what each roll button opens. Styled after the app's own
// pieces: the moves list (CollapsibleSectionHeader + striped rows), the
// character sheet stat cards, the Ask the Oracle buttons and the custom dice
// roller. Moves and oracles are the real ones from the loaded ruleset; the
// dice are rolled locally and nothing is saved.
import {
  Box,
  Button,
  ButtonBase,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MinusIcon from "@mui/icons-material/Remove";
import PlusIcon from "@mui/icons-material/Add";
import BackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import OpenIcon from "@mui/icons-material/ChevronRight";
import { Datasworn } from "@datasworn-community/core";
import { ReactNode, useMemo, useState } from "react";
import { useStore } from "stores/store";
import { ROLL_RESULT, ROLL_TYPE, Roll } from "types/DieRolls.type";
import { CollapsibleSectionHeader } from "components/features/charactersAndCampaigns/CollapsibleSectionHeader";
import { MoveContent } from "components/features/datasworn/MoveContent";
import { Character, RollKind } from "./usePrototypeChat";

const d = (n: number) => 1 + Math.floor(Math.random() * n);
const outcome = (score: number, c1: number, c2: number) =>
  score > c1 && score > c2 ? ROLL_RESULT.HIT : score > c1 || score > c2 ? ROLL_RESULT.WEAK_HIT : ROLL_RESULT.MISS;
const base = (characterId: string | null) => ({ timestamp: new Date(), characterId, uid: "", gmsOnly: false });

export interface RollPickerProps {
  kind: RollKind | null;
  character: Character | undefined;
  onClose: () => void;
  onRoll: (roll: Roll) => void;
}

export function RollPicker(props: RollPickerProps) {
  const { kind, onClose } = props;
  const titles: Partial<Record<RollKind, string>> = {
    move: "Make a move",
    stat: `Roll a stat${props.character ? ` as ${props.character.name}` : ""}`,
    ask: "Ask the Oracle",
    oracle: "Oracles",
    dice: "Roll dice",
  };
  const done = (roll: Roll) => {
    props.onRoll(roll);
    onClose();
  };
  return (
    <Dialog open={!!kind} onClose={onClose} fullWidth maxWidth={kind === "ask" ? "xs" : "sm"} PaperProps={{ sx: { height: kind === "move" || kind === "oracle" ? "80vh" : undefined } }}>
      {kind === "move" ? (
        <MovePicker {...props} done={done} />
      ) : (
        <>
          <Title onClose={onClose}>{kind ? titles[kind] : ""}</Title>
          <DialogContent>
            {kind === "stat" && <StatAndAdds character={props.character} onRoll={(stat, value, adds) => done(statRoll(props.character, stat, value, adds))} />}
            {kind === "ask" && <AskTheOracle onRoll={done} characterId={props.character?.id ?? null} />}
            {kind === "oracle" && <OraclePicker onRoll={done} characterId={props.character?.id ?? null} />}
            {kind === "dice" && <DiceTray onRoll={done} characterId={props.character?.id ?? null} />}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}

function Title(props: { children: ReactNode; onClose: () => void; onBack?: () => void }) {
  return (
    <DialogTitle sx={(theme) => ({ display: "flex", alignItems: "center", gap: 1, fontFamily: theme.fontFamilyTitle, bgcolor: theme.palette.darkGrey.dark, color: theme.palette.darkGrey.contrastText, py: 1.25 })}>
      {props.onBack && (
        <IconButton size={"small"} onClick={props.onBack} aria-label={"Back"} sx={{ color: "inherit" }}>
          <BackIcon />
        </IconButton>
      )}
      <Box sx={{ flexGrow: 1 }}>{props.children}</Box>
      <IconButton size={"small"} onClick={props.onClose} aria-label={"Close"} sx={{ color: "inherit" }}>
        <CloseIcon />
      </IconButton>
    </DialogTitle>
  );
}

function statRoll(character: Character | undefined, stat: string, value: number, adds: number, moveName?: string): Roll {
  const action = d(6);
  const c1 = d(10);
  const c2 = d(10);
  return {
    ...base(character?.id ?? null),
    type: ROLL_TYPE.STAT,
    rollLabel: stat,
    moveName,
    action,
    modifier: value,
    adds: adds || undefined,
    challenge1: c1,
    challenge2: c2,
    result: outcome(Math.min(10, action + value + adds), c1, c2),
  };
}

// Same look as the character sheet's stat cards.
function StatCard(props: { label: string; value: number | string; selected?: boolean; onClick?: () => void }) {
  return (
    <Card
      variant={"outlined"}
      component={props.onClick ? ButtonBase : "div"}
      onClick={props.onClick}
      sx={(theme) => ({
        width: 78,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        outlineStyle: "solid",
        outlineWidth: props.selected ? 2 : 0,
        outlineColor: theme.palette.primary.main,
        borderColor: props.selected ? theme.palette.primary.main : undefined,
        "&:hover": props.onClick ? { outlineWidth: 2, borderColor: theme.palette.primary.main } : {},
      })}
    >
      <Typography
        variant={"subtitle1"}
        sx={(theme) => ({
          bgcolor: props.selected ? theme.palette.primary.main : theme.palette.background.paperInlay,
          color: props.selected ? theme.palette.primary.contrastText : theme.palette.text.secondary,
          fontFamily: theme.fontFamilyTitle,
          textAlign: "center",
          py: 0.5,
          textTransform: "uppercase",
        })}
      >
        {props.label}
      </Typography>
      <Typography variant={"h5"} sx={{ textAlign: "center", py: 1 }}>
        {props.value}
      </Typography>
    </Card>
  );
}

function StatAndAdds(props: { character: Character | undefined; allowed?: string[]; onRoll: (stat: string, value: number, adds: number) => void }) {
  const stats = Object.entries(props.character?.stats ?? {}).filter(([name]) => !props.allowed || props.allowed.includes(name.toLowerCase()));
  const [stat, setStat] = useState<string | null>(stats.length === 1 ? stats[0][0] : null);
  const [adds, setAdds] = useState(0);
  const value = stats.find(([n]) => n === stat)?.[1] ?? 0;
  if (!props.character) {
    return <Typography color={"text.secondary"}>GMs roll without a character: use Ask the Oracle, Oracles or Dice.</Typography>;
  }
  return (
    <Stack spacing={2.5} alignItems={"center"} sx={{ py: 1 }}>
      <Stack direction={"row"} spacing={1.5} flexWrap={"wrap"} useFlexGap justifyContent={"center"}>
        {stats.map(([name, v]) => (
          <StatCard key={name} label={name} value={v} selected={stat === name} onClick={() => setStat(name)} />
        ))}
      </Stack>
      <Stack direction={"row"} spacing={1} alignItems={"center"}>
        <IconButton onClick={() => setAdds((a) => Math.max(0, a - 1))} aria-label={"Fewer adds"}>
          <MinusIcon />
        </IconButton>
        <StatCard label={"Adds"} value={`+${adds}`} />
        <IconButton onClick={() => setAdds((a) => a + 1)} aria-label={"More adds"}>
          <PlusIcon />
        </IconButton>
      </Stack>
      <Button variant={"contained"} size={"large"} disabled={!stat} onClick={() => stat && props.onRoll(stat, value, adds)} sx={{ minWidth: 220 }}>
        {stat ? `Roll +${stat} (${value}${adds ? ` +${adds}` : ""})` : "Choose a stat"}
      </Button>
    </Stack>
  );
}

function statsOf(move: Datasworn.Move): string[] | null {
  if (move.roll_type !== "action_roll") return null;
  const found = new Set<string>();
  for (const condition of move.trigger?.conditions ?? []) {
    for (const option of (condition as { roll_options?: { using?: string; stat?: string }[] }).roll_options ?? []) {
      if (option.using === "stat" && option.stat) found.add(option.stat);
    }
  }
  return [...found];
}

function MovePicker(props: RollPickerProps & { done: (roll: Roll) => void }) {
  const { character, onClose, done } = props;
  const rootIds = useStore((store) => store.rules.rootMoveCollectionIds);
  const categoryMap = useStore((store) => store.rules.moveMaps.moveCategoryMap);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [move, setMove] = useState<Datasworn.Move | null>(null);

  const categories = useMemo(() => {
    const out: { id: string; name: string; moves: Datasworn.Move[] }[] = [];
    for (const rootId of rootIds) {
      const category = categoryMap[rootId];
      if (!category) continue;
      const moves = Object.values(category.contents ?? {}).filter((m) => statsOf(m)?.length);
      if (moves.length) out.push({ id: category._id, name: category.name, moves });
    }
    return out;
  }, [rootIds, categoryMap]);

  if (move) {
    const allowed = statsOf(move) ?? [];
    return (
      <>
        <Title onClose={onClose} onBack={() => setMove(null)}>
          {move.name}
        </Title>
        <DialogContent sx={{ pt: "16px !important" }}>
          <Box sx={{ mb: 2, maxHeight: 220, overflowY: "auto", pr: 1 }}>
            <MoveContent move={move} />
          </Box>
          <StatAndAdds character={character} allowed={allowed} onRoll={(stat, value, adds) => done(statRoll(character, stat, value, adds, move.name))} />
        </DialogContent>
      </>
    );
  }

  const q = search.trim().toLowerCase();
  return (
    <>
      <Title onClose={onClose}>Make a move</Title>
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          fullWidth
          size={"small"}
          placeholder={"Search moves"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          InputProps={{ startAdornment: <InputAdornment position={"start"}><SearchIcon /></InputAdornment> }}
        />
      </Box>
      <Box sx={{ overflowY: "auto", flexGrow: 1 }}>
        {categories.length === 0 && <Typography sx={{ p: 2 }} color={"text.secondary"}>Loading moves…</Typography>}
        {categories.map((c) => {
          const moves = c.moves.filter((m) => !q || m.name.toLowerCase().includes(q));
          if (!moves.length) return null;
          const isOpen = !!q || !!open[c.id];
          return (
            <Box key={c.id}>
              <CollapsibleSectionHeader text={c.name} open={isOpen} forcedOpen={!!q} toggleOpen={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} />
              {isOpen && (
                <List disablePadding>
                  {moves.map((m) => (
                    <ListItem key={m._id} disablePadding sx={(theme) => ({ "&:nth-of-type(even)": { backgroundColor: theme.palette.background.paperInlay } })}>
                      <ListItemButton onClick={() => setMove(m)} sx={{ justifyContent: "space-between" }}>
                        <Typography variant={"body2"}>{m.name}</Typography>
                        <Stack direction={"row"} spacing={0.5} alignItems={"center"}>
                          <Typography variant={"caption"} color={"text.secondary"}>
                            {(statsOf(m) ?? []).map((s) => `+${s}`).join(" ")}
                          </Typography>
                          <OpenIcon fontSize={"small"} />
                        </Stack>
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );
}

// Ironsworn odds: yes when the d100 roll is at or above the threshold.
const askOdds = [
  { label: "Almost Certain", yesAt: 11 },
  { label: "Likely", yesAt: 26 },
  { label: "50/50", yesAt: 51 },
  { label: "Unlikely", yesAt: 76 },
  { label: "Small Chance", yesAt: 91 },
];

function AskTheOracle(props: { onRoll: (roll: Roll) => void; characterId: string | null }) {
  return (
    <Stack spacing={1} sx={{ py: 1 }}>
      <Typography variant={"body2"} color={"text.secondary"}>
        How likely is it?
      </Typography>
      {askOdds.map((o) => (
        <Button
          key={o.label}
          variant={"outlined"}
          color={"inherit"}
          size={"large"}
          sx={{ justifyContent: "space-between" }}
          onClick={() => {
            const r = d(100);
            props.onRoll({
              ...base(props.characterId),
              type: ROLL_TYPE.ORACLE_TABLE,
              rollLabel: o.label,
              oracleCategoryName: "Ask the Oracle",
              roll: r,
              result: r >= o.yesAt ? "Yes" : "No",
              match: r % 11 === 0,
            });
          }}
        >
          <span>{o.label}</span>
          <Typography variant={"caption"} color={"text.secondary"}>
            {101 - o.yesAt}% yes
          </Typography>
        </Button>
      ))}
    </Stack>
  );
}

interface FlatTable {
  id: string;
  name: string;
  path: string;
  table: Datasworn.OracleRollable;
}

function flattenOracles(collection: Datasworn.OracleCollection, path: string, out: FlatTable[]) {
  const c = collection as unknown as { contents?: Record<string, Datasworn.OracleRollable>; collections?: Record<string, Datasworn.OracleCollection> };
  for (const table of Object.values(c.contents ?? {})) {
    out.push({ id: table._id, name: table.name, path, table });
  }
  for (const sub of Object.values(c.collections ?? {})) {
    flattenOracles(sub, path ? `${path} · ${sub.name}` : sub.name, out);
  }
}

function OraclePicker(props: { onRoll: (roll: Roll) => void; characterId: string | null }) {
  const rootIds = useStore((store) => store.rules.rootOracleCollectionIds);
  const collectionMap = useStore((store) => store.rules.oracleMaps.oracleCollectionMap);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const out: { id: string; name: string; tables: FlatTable[] }[] = [];
    for (const rootId of rootIds) {
      const top = collectionMap[rootId];
      if (!top) continue;
      const tables: FlatTable[] = [];
      flattenOracles(top, "", tables);
      if (tables.length) out.push({ id: top._id, name: top.name, tables });
    }
    return out;
  }, [rootIds, collectionMap]);

  const roll = (t: FlatTable) => {
    const rows = (t.table as unknown as { rows?: { roll?: { min: number; max: number } | null; text: string }[] }).rows ?? [];
    const r = d(100);
    const row = rows.find((x) => x.roll && r >= x.roll.min && r <= x.roll.max);
    props.onRoll({
      ...base(props.characterId),
      type: ROLL_TYPE.ORACLE_TABLE,
      rollLabel: t.name,
      oracleCategoryName: t.path || undefined,
      roll: r,
      // Strip Datasworn links like [Hinterlands](datasworn:...) to their text.
      result: (row?.text ?? "—").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"),
    });
  };

  const q = search.trim().toLowerCase();
  return (
    <Box sx={{ mx: -3 }}>
      <Box sx={{ px: 1.5, pb: 1 }}>
        <TextField
          fullWidth
          size={"small"}
          placeholder={"Search oracles"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          InputProps={{ startAdornment: <InputAdornment position={"start"}><SearchIcon /></InputAdornment> }}
        />
      </Box>
      {groups.length === 0 && <Typography sx={{ p: 2 }} color={"text.secondary"}>Loading oracles…</Typography>}
      {groups.map((g) => {
        const tables = g.tables.filter((t) => !q || `${g.name} ${t.path} ${t.name}`.toLowerCase().includes(q));
        if (!tables.length) return null;
        const isOpen = !!q || !!open[g.id];
        return (
          <Box key={g.id}>
            <CollapsibleSectionHeader text={g.name} open={isOpen} forcedOpen={!!q} toggleOpen={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} />
            {isOpen && (
              <List disablePadding>
                {tables.map((t) => (
                  <ListItem key={t.id} disablePadding sx={(theme) => ({ "&:nth-of-type(even)": { backgroundColor: theme.palette.background.paperInlay } })}>
                    <ListItemButton onClick={() => roll(t)}>
                      <Box>
                        <Typography variant={"body2"}>{t.name}</Typography>
                        {t.path && (
                          <Typography variant={"caption"} color={"text.secondary"}>
                            {t.path}
                          </Typography>
                        )}
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];

// Simple die outlines; d100 is shown as a pair of d10s.
function DieShape(props: { sides: number; size?: number }) {
  const s = props.size ?? 44;
  const shapes: Record<number, string> = {
    4: "22,3 41,38 3,38",
    6: "6,6 38,6 38,38 6,38",
    8: "22,2 40,22 22,42 4,22",
    10: "22,2 40,18 34,40 10,40 4,18",
    12: "22,2 40,14 40,32 22,42 4,32 4,14",
    20: "22,2 40,12 40,32 22,42 4,32 4,12",
    100: "22,2 40,18 34,40 10,40 4,18",
  };
  return (
    <svg width={s} height={s} viewBox={"0 0 44 44"} aria-hidden>
      <polygon points={shapes[props.sides]} fill={"currentColor"} opacity={0.12} stroke={"currentColor"} strokeWidth={2} strokeLinejoin={"round"} />
      <text x={22} y={props.sides === 4 ? 32 : 27} textAnchor={"middle"} fontSize={props.sides === 100 ? 10 : 12} fontWeight={700} fill={"currentColor"}>
        {props.sides === 100 ? "%" : props.sides}
      </text>
    </svg>
  );
}

function DiceTray(props: { onRoll: (roll: Roll) => void; characterId: string | null }) {
  const [counts, setCounts] = useState<Record<number, number>>({ 6: 2 });
  const [modifier, setModifier] = useState(0);
  const built =
    DIE_SIDES.filter((s) => counts[s])
      .map((s) => `${counts[s]}d${s}`)
      .join("+") + (modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "");
  const [text, setText] = useState<string | null>(null);
  const notation = text ?? built;

  const parse = (n: string) => {
    const parts = n.replace(/\s/g, "").match(/[+-]?[^+-]+/g) ?? [];
    const dice: number[][] = [];
    let mod = 0;
    for (const part of parts) {
      const m = /^([+-]?)(\d*)d(\d+)$/.exec(part);
      if (m) dice.push(Array.from({ length: Math.min(30, +(m[2] || 1)) }, () => +m[3]));
      else if (/^[+-]?\d+$/.test(part)) mod += +part;
      else return null;
    }
    return dice.length ? { sides: dice.flat(), mod } : null;
  };
  const parsed = parse(notation);

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 1 }}>
        {DIE_SIDES.map((s) => (
          <Card key={s} variant={"outlined"} sx={{ p: 1, display: "flex", flexDirection: "column", alignItems: "center", borderColor: counts[s] ? "primary.main" : undefined }}>
            <ButtonBase
              onClick={() => {
                setText(null);
                setCounts((c) => ({ ...c, [s]: (c[s] ?? 0) + 1 }));
              }}
              aria-label={`Add a d${s}`}
              sx={{ borderRadius: 1, color: counts[s] ? "primary.main" : "text.primary" }}
            >
              <DieShape sides={s} />
            </ButtonBase>
            <Stack direction={"row"} alignItems={"center"}>
              <IconButton
                size={"small"}
                aria-label={`Remove a d${s}`}
                disabled={!counts[s]}
                onClick={() => {
                  setText(null);
                  setCounts((c) => ({ ...c, [s]: Math.max(0, (c[s] ?? 0) - 1) }));
                }}
              >
                <MinusIcon fontSize={"small"} />
              </IconButton>
              <Typography sx={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>{counts[s] ?? 0}</Typography>
              <IconButton
                size={"small"}
                aria-label={`Add a d${s}`}
                onClick={() => {
                  setText(null);
                  setCounts((c) => ({ ...c, [s]: (c[s] ?? 0) + 1 }));
                }}
              >
                <PlusIcon fontSize={"small"} />
              </IconButton>
            </Stack>
          </Card>
        ))}
        <Card variant={"outlined"} sx={{ p: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant={"caption"} color={"text.secondary"} sx={{ mt: 1 }}>
            Modifier
          </Typography>
          <Stack direction={"row"} alignItems={"center"}>
            <IconButton size={"small"} aria-label={"Lower modifier"} onClick={() => { setText(null); setModifier((m) => m - 1); }}>
              <MinusIcon fontSize={"small"} />
            </IconButton>
            <Typography sx={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}>{modifier >= 0 ? `+${modifier}` : modifier}</Typography>
            <IconButton size={"small"} aria-label={"Raise modifier"} onClick={() => { setText(null); setModifier((m) => m + 1); }}>
              <PlusIcon fontSize={"small"} />
            </IconButton>
          </Stack>
        </Card>
      </Box>
      <TextField
        size={"small"}
        label={"Or type it"}
        helperText={parsed ? " " : "Try 2d6+1d8+2"}
        error={!parsed}
        value={notation}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant={"contained"}
        size={"large"}
        disabled={!parsed}
        onClick={() => {
          if (!parsed) return;
          const values = parsed.sides.map((sides) => d(sides));
          props.onRoll({
            ...base(props.characterId),
            type: ROLL_TYPE.CUSTOM_DICE,
            rollLabel: notation,
            notation,
            dieSides: parsed.sides[0],
            dieValues: values,
            modifier: parsed.mod,
            total: values.reduce((a, b) => a + b, 0) + parsed.mod,
          });
        }}
      >
        Roll {notation || "dice"}
      </Button>
    </Stack>
  );
}
