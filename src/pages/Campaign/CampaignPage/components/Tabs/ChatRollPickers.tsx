import { useMemo, useState } from "react";
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
import type { Datasworn } from "@datasworn-community/core";
import { useStore } from "stores/store";
import { useSystemOracles } from "hooks/useSystemOracle";
import { AskTheOracle } from "config/system.config";
import { MarkdownRenderer } from "components/shared/MarkdownRenderer";
import { CollapsibleSectionHeader } from "components/features/charactersAndCampaigns/CollapsibleSectionHeader";
import type { StatsMap } from "api-calls/character/_character.type";
import type { Roll } from "types/DieRolls.type";
import type { ChatRollContext, DiceRoller } from "./chatRolls";
import {
  parseMixedDiceNotation,
  rollChatCustomDice,
  rollChatOracleTable,
  rollChatStat,
} from "./chatRolls";

/**
 * What each roll button under the composer opens (spec #9, prototype
 * variant D). The pickers mirror the app's own pieces: the moves list with
 * its search and collapsible headers, the character sheet's stat cards,
 * the five Ask the Oracle odds, the grouped oracle tables, and a dice
 * tray that also takes typed notation. A finished roll attaches to the
 * draft; nothing posts until the player sends.
 */

export type ChatRollKind = "move" | "stat" | "ask" | "oracle" | "dice";

export interface ChatRollPickerProps {
  kind: ChatRollKind | null;
  /** The speaking character's stats; empty when the speaker has none. */
  stats: StatsMap;
  characterName: string | null;
  context: ChatRollContext;
  roller: DiceRoller;
  onClose: () => void;
  onRoll: (roll: Roll) => void;
}

export function ChatRollPicker(props: ChatRollPickerProps) {
  const { kind, onClose, onRoll, characterName } = props;
  const titles: Partial<Record<ChatRollKind, string>> = {
    move: "Make a move",
    stat: `Roll a stat${characterName ? ` as ${characterName}` : ""}`,
    ask: "Ask the Oracle",
    oracle: "Oracles",
    dice: "Roll dice",
  };
  const done = (roll: Roll) => {
    onRoll(roll);
  };
  return (
    <Dialog
      open={!!kind}
      onClose={onClose}
      fullWidth
      maxWidth={kind === "ask" ? "xs" : "sm"}
      PaperProps={{
        sx: { height: kind === "move" || kind === "oracle" ? "80vh" : undefined },
      }}
    >
      {kind === "move" ? (
        <ChatMovePicker {...props} done={done} />
      ) : (
        <>
          <PickerTitle onClose={onClose}>
            {kind ? titles[kind] : ""}
          </PickerTitle>
          <DialogContent>
            {kind === "stat" && (
              <ChatStatPicker {...props} done={done} />
            )}
            {kind === "ask" && <ChatAskPicker {...props} done={done} />}
            {kind === "oracle" && <ChatOraclePicker {...props} done={done} />}
            {kind === "dice" && <ChatDicePicker {...props} done={done} />}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}

function PickerTitle(props: {
  children: React.ReactNode;
  onClose: () => void;
  onBack?: () => void;
}) {
  return (
    <DialogTitle
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1,
        fontFamily: theme.fontFamilyTitle,
        bgcolor: theme.palette.darkGrey.dark,
        color: theme.palette.darkGrey.contrastText,
        py: 1.25,
      })}
    >
      {props.onBack && (
        <IconButton
          size={"small"}
          onClick={props.onBack}
          aria-label={"Back"}
          sx={{ color: "inherit" }}
        >
          <BackIcon />
        </IconButton>
      )}
      <Box sx={{ flexGrow: 1 }}>{props.children}</Box>
      <IconButton
        size={"small"}
        onClick={props.onClose}
        aria-label={"Close"}
        sx={{ color: "inherit" }}
      >
        <CloseIcon />
      </IconButton>
    </DialogTitle>
  );
}

interface StatEntry {
  key: string;
  label: string;
  value: number;
}

function StatCard(props: {
  label: string;
  value: number | string;
  selected?: boolean;
  onClick?: () => void;
}) {
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
        "&:hover": props.onClick
          ? { outlineWidth: 2, borderColor: theme.palette.primary.main }
          : {},
      })}
    >
      <Typography
        variant={"subtitle1"}
        sx={(theme) => ({
          bgcolor: props.selected
            ? theme.palette.primary.main
            : theme.palette.background.paperInlay,
          color: props.selected
            ? theme.palette.primary.contrastText
            : theme.palette.text.secondary,
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

function StatAndAdds(props: {
  entries: StatEntry[];
  busy?: boolean;
  onRoll: (entry: StatEntry, adds: number) => void;
}) {
  const { entries } = props;
  const [statKey, setStatKey] = useState<string | null>(
    entries.length === 1 ? entries[0].key : null
  );
  const [adds, setAdds] = useState(0);
  const stat = entries.find((entry) => entry.key === statKey) ?? null;
  return (
    <Stack spacing={2.5} alignItems={"center"} sx={{ py: 1 }}>
      <Stack
        direction={"row"}
        spacing={1.5}
        flexWrap={"wrap"}
        useFlexGap
        justifyContent={"center"}
      >
        {entries.map((entry) => (
          <StatCard
            key={entry.key}
            label={entry.label}
            value={entry.value}
            selected={statKey === entry.key}
            onClick={() => setStatKey(entry.key)}
          />
        ))}
      </Stack>
      <Stack direction={"row"} spacing={1} alignItems={"center"}>
        <IconButton
          onClick={() => setAdds((value) => Math.max(0, value - 1))}
          aria-label={"Fewer adds"}
        >
          <MinusIcon />
        </IconButton>
        <StatCard label={"Adds"} value={`+${adds}`} />
        <IconButton
          onClick={() => setAdds((value) => value + 1)}
          aria-label={"More adds"}
        >
          <PlusIcon />
        </IconButton>
      </Stack>
      <Button
        variant={"contained"}
        size={"large"}
        disabled={!stat || props.busy}
        onClick={() => stat && props.onRoll(stat, adds)}
        sx={{ minWidth: 220 }}
      >
        {stat
          ? `Roll +${stat.label} (${stat.value}${adds ? ` +${adds}` : ""})`
          : "Choose a stat"}
      </Button>
    </Stack>
  );
}

function statsOfMove(move: Datasworn.Move): string[] {
  if (move.roll_type !== "action_roll") {
    return [];
  }
  const found = new Set<string>();
  const conditions =
    (move as { trigger?: { conditions?: unknown[] } }).trigger?.conditions ??
    [];
  for (const condition of conditions) {
    const options =
      (condition as { roll_options?: { using?: string; stat?: string }[] })
        .roll_options ?? [];
    for (const option of options) {
      if (option.using === "stat" && option.stat) {
        found.add(option.stat);
      }
    }
  }
  return [...found];
}

function ChatMovePicker(
  props: ChatRollPickerProps & { done: (roll: Roll) => void }
) {
  const { stats, context, roller, onClose, done } = props;
  const rootIds = useStore((store) => store.rules.rootMoveCollectionIds);
  const categoryMap = useStore((store) => store.rules.moveMaps.moveCategoryMap);
  const statRules = useStore((store) => store.rules.stats);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [move, setMove] = useState<Datasworn.Move | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const categories = useMemo(() => {
    const out: { id: string; name: string; moves: Datasworn.Move[] }[] = [];
    for (const rootId of rootIds) {
      const category = categoryMap[rootId] as
        | { _id: string; name: string; contents?: Record<string, Datasworn.Move> }
        | undefined;
      if (!category) {
        continue;
      }
      const moves = Object.values(category.contents ?? {}).filter(
        (candidate) => statsOfMove(candidate).length > 0
      );
      if (moves.length > 0) {
        out.push({ id: category._id, name: category.name, moves });
      }
    }
    return out;
  }, [rootIds, categoryMap]);

  if (move) {
    const allowed = statsOfMove(move);
    const entries: StatEntry[] = allowed.map((key) => ({
      key,
      label: (statRules[key] as { label?: string } | undefined)?.label ?? key,
      value: stats[key] ?? 0,
    }));
    return (
      <>
        <PickerTitle onClose={onClose} onBack={() => setMove(null)}>
          {move.name}
        </PickerTitle>
        <DialogContent sx={{ pt: "16px !important" }}>
          <Box sx={{ mb: 2, maxHeight: 220, overflowY: "auto", pr: 1 }}>
            <MarkdownRenderer markdown={move.text} />
          </Box>
          <StatAndAdds
            entries={entries}
            busy={busy}
            onRoll={(entry, adds) => {
              setBusy(true);
              setError(undefined);
              rollChatStat(
                entry.label,
                {
                  modifier: entry.value,
                  adds,
                  move: { name: move.name, id: move._id },
                },
                context,
                roller
              )
                .then(done)
                .catch((rollError: unknown) =>
                  setError(
                    rollError instanceof Error
                      ? rollError.message
                      : "Could not roll."
                  )
                )
                .finally(() => setBusy(false));
            }}
          />
          {error && (
            <Typography color={"error"} sx={{ textAlign: "center" }}>
              {error}
            </Typography>
          )}
        </DialogContent>
      </>
    );
  }

  const q = search.trim().toLowerCase();
  return (
    <>
      <PickerTitle onClose={onClose}>Make a move</PickerTitle>
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          fullWidth
          size={"small"}
          placeholder={"Search moves"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          InputProps={{
            startAdornment: (
              <InputAdornment position={"start"}>
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      <Box sx={{ overflowY: "auto", flexGrow: 1 }}>
        {categories.length === 0 && (
          <Typography sx={{ p: 2 }} color={"text.secondary"}>
            Loading moves…
          </Typography>
        )}
        {categories.map((category) => {
          const moves = category.moves.filter(
            (candidate) =>
              !q || candidate.name.toLowerCase().includes(q)
          );
          if (moves.length === 0) {
            return null;
          }
          const isOpen = !!q || !!open[category.id];
          return (
            <Box key={category.id}>
              <CollapsibleSectionHeader
                text={category.name}
                open={isOpen}
                forcedOpen={!!q}
                toggleOpen={() =>
                  setOpen((state) => ({
                    ...state,
                    [category.id]: !state[category.id],
                  }))
                }
              />
              {isOpen && (
                <List disablePadding>
                  {moves.map((candidate) => (
                    <ListItem
                      key={candidate._id}
                      disablePadding
                      sx={(theme) => ({
                        "&:nth-of-type(even)": {
                          backgroundColor:
                            theme.palette.background.paperInlay,
                        },
                      })}
                    >
                      <ListItemButton
                        onClick={() => setMove(candidate)}
                        sx={{ justifyContent: "space-between" }}
                      >
                        <Typography variant={"body2"}>
                          {candidate.name}
                        </Typography>
                        <Stack
                          direction={"row"}
                          spacing={0.5}
                          alignItems={"center"}
                        >
                          <Typography
                            variant={"caption"}
                            color={"text.secondary"}
                          >
                            {statsOfMove(candidate)
                              .map(
                                (key) =>
                                  `+${
                                    (statRules[key] as { label?: string } | undefined)
                                      ?.label ?? key
                                  }`
                              )
                              .join(" ")}
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

function ChatStatPicker(
  props: ChatRollPickerProps & { done: (roll: Roll) => void }
) {
  const { stats, context, roller, done } = props;
  const statRules = useStore((store) => store.rules.stats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  if (Object.keys(stats).length === 0) {
    return (
      <Typography color={"text.secondary"} sx={{ py: 1 }}>
        GMs roll without a character: use Ask the Oracle, Oracles or Dice.
      </Typography>
    );
  }
  const entries: StatEntry[] = Object.entries(statRules).map(
    ([key, rule]) => ({
      key,
      label: (rule as { label?: string })?.label ?? key,
      value: stats[key] ?? 0,
    })
  );
  return (
    <Stack sx={{ py: 1 }}>
      <StatAndAdds
        entries={entries}
        busy={busy}
        onRoll={(entry, adds) => {
          setBusy(true);
          setError(undefined);
          rollChatStat(
            entry.label,
            { modifier: entry.value, adds },
            context,
            roller
          )
            .then(done)
            .catch((rollError: unknown) =>
              setError(
                rollError instanceof Error ? rollError.message : "Could not roll."
              )
            )
            .finally(() => setBusy(false));
        }}
      />
      {error && (
        <Typography color={"error"} sx={{ textAlign: "center" }}>
          {error}
        </Typography>
      )}
    </Stack>
  );
}

const ASK_ODDS_ORDER = [
  AskTheOracle.AlmostCertain,
  AskTheOracle.Likely,
  AskTheOracle.FiftyFifty,
  AskTheOracle.Unlikely,
  AskTheOracle.SmallChance,
];

const ASK_ODDS_LABELS: Record<AskTheOracle, string> = {
  [AskTheOracle.AlmostCertain]: "Almost Certain",
  [AskTheOracle.Likely]: "Likely",
  [AskTheOracle.FiftyFifty]: "50/50",
  [AskTheOracle.Unlikely]: "Unlikely",
  [AskTheOracle.SmallChance]: "Small Chance",
};

function ChatAskPicker(
  props: ChatRollPickerProps & { done: (roll: Roll) => void }
) {
  const { context, roller, done } = props;
  const { askTheOracle } = useSystemOracles();
  const [busy, setBusy] = useState<AskTheOracle | null>(null);
  return (
    <Stack spacing={1} sx={{ py: 1 }}>
      <Typography variant={"body2"} color={"text.secondary"}>
        How likely is it?
      </Typography>
      {ASK_ODDS_ORDER.map((odds) => (
        <Button
          key={odds}
          variant={"outlined"}
          color={"inherit"}
          size={"large"}
          disabled={busy !== null}
          onClick={() => {
            setBusy(odds);
            rollChatOracleTable(askTheOracle[odds], context, roller)
              .then((roll) => {
                if (roll) {
                  done(roll);
                }
              })
              .finally(() => setBusy(null));
          }}
        >
          {ASK_ODDS_LABELS[odds]}
        </Button>
      ))}
    </Stack>
  );
}

interface FlatOracleTable {
  id: string;
  name: string;
  path: string;
}

interface OracleGroupNode {
  _id: string;
  name: string;
  oracle_type?: string;
  contents?: Record<string, { _id: string; name: string }>;
  collections?: Record<string, OracleGroupNode>;
}

function flattenOracles(
  collection: OracleGroupNode,
  path: string,
  out: FlatOracleTable[]
) {
  for (const table of Object.values(collection.contents ?? {})) {
    out.push({ id: table._id, name: table.name, path });
  }
  if (collection.oracle_type === "tables") {
    for (const sub of Object.values(collection.collections ?? {})) {
      flattenOracles(sub, path ? `${path} · ${sub.name}` : sub.name, out);
    }
  }
}

function ChatOraclePicker(
  props: ChatRollPickerProps & { done: (roll: Roll) => void }
) {
  const { context, roller, done } = props;
  const rootIds = useStore((store) => store.rules.rootOracleCollectionIds);
  const collectionMap = useStore(
    (store) => store.rules.oracleMaps.oracleCollectionMap
  );
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const out: { id: string; name: string; tables: FlatOracleTable[] }[] = [];
    for (const rootId of rootIds) {
      const top = collectionMap[rootId] as OracleGroupNode | undefined;
      if (!top) {
        continue;
      }
      const tables: FlatOracleTable[] = [];
      flattenOracles(top, "", tables);
      if (tables.length > 0) {
        out.push({ id: top._id, name: top.name, tables });
      }
    }
    return out;
  }, [rootIds, collectionMap]);

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
          InputProps={{
            startAdornment: (
              <InputAdornment position={"start"}>
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      {groups.length === 0 && (
        <Typography sx={{ p: 2 }} color={"text.secondary"}>
          Loading oracles…
        </Typography>
      )}
      {groups.map((group) => {
        const tables = group.tables.filter(
          (table) =>
            !q ||
            `${group.name} ${table.path} ${table.name}`
              .toLowerCase()
              .includes(q)
        );
        if (tables.length === 0) {
          return null;
        }
        const isOpen = !!q || !!open[group.id];
        return (
          <Box key={group.id}>
            <CollapsibleSectionHeader
              text={group.name}
              open={isOpen}
              forcedOpen={!!q}
              toggleOpen={() =>
                setOpen((state) => ({
                  ...state,
                  [group.id]: !state[group.id],
                }))
              }
            />
            {isOpen && (
              <List disablePadding>
                {tables.map((table) => (
                  <ListItem
                    key={table.id}
                    disablePadding
                    sx={(theme) => ({
                      "&:nth-of-type(even)": {
                        backgroundColor: theme.palette.background.paperInlay,
                      },
                    })}
                  >
                    <ListItemButton
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        rollChatOracleTable(table.id, context, roller)
                          .then((roll) => {
                            if (roll) {
                              done(roll);
                            }
                          })
                          .finally(() => setBusy(false));
                      }}
                    >
                      <Box>
                        <Typography variant={"body2"}>{table.name}</Typography>
                        {table.path && (
                          <Typography
                            variant={"caption"}
                            color={"text.secondary"}
                          >
                            {table.path}
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

function DieShape(props: { sides: number; size?: number }) {
  const size = props.size ?? 44;
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
    <svg
      width={size}
      height={size}
      viewBox={"0 0 44 44"}
      aria-hidden
    >
      <polygon
        points={shapes[props.sides]}
        fill={"currentColor"}
        opacity={0.12}
        stroke={"currentColor"}
        strokeWidth={2}
        strokeLinejoin={"round"}
      />
      <text
        x={22}
        y={props.sides === 4 ? 32 : 27}
        textAnchor={"middle"}
        fontSize={props.sides === 100 ? 10 : 12}
        fontWeight={700}
        fill={"currentColor"}
      >
        {props.sides === 100 ? "%" : props.sides}
      </text>
    </svg>
  );
}

function ChatDicePicker(
  props: ChatRollPickerProps & { done: (roll: Roll) => void }
) {
  const { context, roller, done } = props;
  const [counts, setCounts] = useState<Record<number, number>>({ 6: 2 });
  const [modifier, setModifier] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const built =
    DIE_SIDES.filter((sides) => counts[sides])
      .map((sides) => `${counts[sides]}d${sides}`)
      .join("+") +
    (modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "");
  const notation = text ?? built;
  const parsed = parseMixedDiceNotation(notation);

  const roll = () => {
    if (!parsed || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    rollChatCustomDice(notation, context, roller)
      .then(done)
      .catch((rollError: unknown) =>
        setError(
          rollError instanceof Error ? rollError.message : "Could not roll."
        )
      )
      .finally(() => setBusy(false));
  };

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
          gap: 1,
        }}
      >
        {DIE_SIDES.map((sides) => (
          <Card
            key={sides}
            variant={"outlined"}
            sx={{
              p: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              borderColor: counts[sides] ? "primary.main" : undefined,
            }}
          >
            <ButtonBase
              onClick={() => {
                setText(null);
                setCounts((state) => ({ ...state, [sides]: (state[sides] ?? 0) + 1 }));
              }}
              aria-label={`Add a d${sides}`}
              sx={{
                borderRadius: 1,
                color: counts[sides] ? "primary.main" : "text.primary",
              }}
            >
              <DieShape sides={sides} />
            </ButtonBase>
            <Stack direction={"row"} alignItems={"center"}>
              <IconButton
                size={"small"}
                aria-label={`Remove a d${sides}`}
                disabled={!counts[sides]}
                onClick={() => {
                  setText(null);
                  setCounts((state) => ({
                    ...state,
                    [sides]: Math.max(0, (state[sides] ?? 0) - 1),
                  }));
                }}
              >
                <MinusIcon fontSize={"small"} />
              </IconButton>
              <Typography sx={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>
                {counts[sides] ?? 0}
              </Typography>
              <IconButton
                size={"small"}
                aria-label={`Add a d${sides}`}
                onClick={() => {
                  setText(null);
                  setCounts((state) => ({
                    ...state,
                    [sides]: (state[sides] ?? 0) + 1,
                  }));
                }}
              >
                <PlusIcon fontSize={"small"} />
              </IconButton>
            </Stack>
          </Card>
        ))}
        <Card
          variant={"outlined"}
          sx={{
            p: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography
            variant={"caption"}
            color={"text.secondary"}
            sx={{ mt: 1 }}
          >
            Modifier
          </Typography>
          <Stack direction={"row"} alignItems={"center"}>
            <IconButton
              size={"small"}
              aria-label={"Lower modifier"}
              onClick={() => {
                setText(null);
                setModifier((value) => value - 1);
              }}
            >
              <MinusIcon fontSize={"small"} />
            </IconButton>
            <Typography
              sx={{ minWidth: 24, textAlign: "center", fontWeight: 700 }}
            >
              {modifier >= 0 ? `+${modifier}` : modifier}
            </Typography>
            <IconButton
              size={"small"}
              aria-label={"Raise modifier"}
              onClick={() => {
                setText(null);
                setModifier((value) => value + 1);
              }}
            >
              <PlusIcon fontSize={"small"} />
            </IconButton>
          </Stack>
        </Card>
      </Box>
      <TextField
        size={"small"}
        label={"Or type it"}
        helperText={parsed || !notation ? "Try 2d6+1d8+2" : "Try 2d6+1d8+2"}
        error={!parsed}
        value={notation}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && parsed) {
            roll();
          }
        }}
      />
      {error && <Typography color={"error"}>{error}</Typography>}
      <Button
        variant={"contained"}
        size={"large"}
        disabled={!parsed || busy}
        onClick={roll}
      >
        Roll {notation || "dice"}
      </Button>
    </Stack>
  );
}
