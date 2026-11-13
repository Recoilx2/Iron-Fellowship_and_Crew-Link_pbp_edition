// PROTOTYPE (#6): throwaway in-memory chat state shared by the layout
// variants. Nothing here talks to the database; reload resets it.
import { useCallback, useMemo, useState } from "react";
import { ROLL_RESULT, ROLL_TYPE, Roll } from "types/DieRolls.type";
import { TrackTypes } from "types/Track.type";

export type ChannelKind = "IC" | "OOC";
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  starting: boolean;
  archived: boolean;
}

export type Speaker =
  | { kind: "character"; characterId: string }
  | { kind: "self" }
  | { kind: "npc"; name: string };

export interface Person {
  uid: string;
  name: string;
  isGM: boolean;
}

export interface Character {
  id: string;
  name: string;
  uid: string;
  colour: string;
}

export interface Post {
  id: string;
  channelId: string;
  authorUid: string;
  speaker: Speaker;
  text: string;
  images: string[];
  roll?: Roll;
  createdAt: Date;
  editedAt?: Date;
  deleted?: boolean;
}

export type RollKind = "move" | "stat" | "progress" | "oracle" | "dice";

export const people: Record<string, Person> = {
  gm: { uid: "gm", name: "Rook", isGM: true },
  me: { uid: "me", name: "Sam", isGM: false },
  jo: { uid: "jo", name: "Jo", isGM: false },
};

export const characters: Record<string, Character> = {
  kira: { id: "kira", name: "Kira Vey", uid: "me", colour: "#8e5b3c" },
  tamsin: { id: "tamsin", name: "Old Tamsin", uid: "me", colour: "#4a6b5d" },
  brannoc: { id: "brannoc", name: "Brannoc", uid: "jo", colour: "#5a4f7a" },
};

export const npcs = ["Warden Elsa", "The Hollow Voice"];

const mapImage =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='300'><rect width='480' height='300' fill='#d9c9a3'/><path d='M20 250 Q120 120 220 200 T460 80' stroke='#6b4f2a' stroke-width='6' fill='none' stroke-dasharray='14 10'/><circle cx='220' cy='200' r='14' fill='#a33'/><text x='240' y='230' font-family='serif' font-size='22' fill='#3b2a14'>The Hollow Shrine</text></svg>`
  );

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

function statRoll(
  label: string,
  moveName: string | undefined,
  action: number,
  c1: number,
  c2: number,
  uid: string,
  characterId: string | null,
  gmsOnly = false
): Roll {
  const result =
    action > c1 && action > c2
      ? ROLL_RESULT.HIT
      : action > c1 || action > c2
        ? ROLL_RESULT.WEAK_HIT
        : ROLL_RESULT.MISS;
  return {
    type: ROLL_TYPE.STAT,
    rollLabel: label,
    moveName,
    action,
    challenge1: c1,
    challenge2: c2,
    result,
    timestamp: new Date(),
    characterId,
    uid,
    gmsOnly,
  };
}

const startingChannels: Channel[] = [
  { id: "ic", name: "The Story", kind: "IC", starting: true, archived: false },
  { id: "ooc", name: "Table Talk", kind: "OOC", starting: true, archived: false },
  {
    id: "shrine",
    name: "Side scene: Hollow Shrine",
    kind: "IC",
    starting: false,
    archived: false,
  },
  { id: "s0", name: "Session 0", kind: "OOC", starting: false, archived: true },
];

const startingPosts: Post[] = [
  {
    id: "p1",
    channelId: "ic",
    authorUid: "gm",
    speaker: { kind: "self" },
    text: "The storm breaks as you reach the ridge. Below, the **Hollow Shrine** sits half-swallowed by the bog, a single lantern burning in its doorway.\n\nWhat do you do?",
    images: [mapImage],
    createdAt: minutesAgo(600),
  },
  {
    id: "p2",
    channelId: "ic",
    authorUid: "jo",
    speaker: { kind: "character", characterId: "brannoc" },
    text: "Brannoc pulls his hood tight. *\"Lanterns don't light themselves.\"* He starts down the slope, keeping to the rocks.",
    images: [],
    createdAt: minutesAgo(420),
  },
  {
    id: "p3",
    channelId: "ic",
    authorUid: "jo",
    speaker: { kind: "character", characterId: "brannoc" },
    text: "Picking a path down without slipping into the mire.",
    images: [],
    roll: statRoll("Edge", "Face Danger", 6, 3, 8, "jo", "brannoc"),
    createdAt: minutesAgo(418),
  },
  {
    id: "p4",
    channelId: "ic",
    authorUid: "gm",
    speaker: { kind: "npc", name: "The Hollow Voice" },
    text: "*Who comes to the drowned door?*",
    images: [],
    createdAt: minutesAgo(300),
  },
  {
    id: "p5",
    channelId: "ic",
    authorUid: "gm",
    speaker: { kind: "self" },
    text: "",
    images: [],
    roll: statRoll("Wits", "Ask the Oracle (GM only)", 3, 7, 9, "gm", null, true),
    createdAt: minutesAgo(299),
  },
  {
    id: "p6",
    channelId: "ic",
    authorUid: "me",
    speaker: { kind: "character", characterId: "kira" },
    text: "Kira answers before anyone can stop her: \"Travellers. Cold ones.\"",
    images: [],
    createdAt: minutesAgo(120),
    editedAt: minutesAgo(110),
  },
  {
    id: "p7",
    channelId: "ic",
    authorUid: "me",
    speaker: { kind: "character", characterId: "kira" },
    text: "",
    images: [],
    roll: {
      type: ROLL_TYPE.ORACLE_TABLE,
      rollLabel: "Action",
      oracleCategoryName: "Ask the Oracle",
      roll: 47,
      result: "Reveal",
      timestamp: new Date(),
      characterId: "kira",
      uid: "me",
      gmsOnly: false,
    },
    createdAt: minutesAgo(60),
  },
  {
    id: "p8",
    channelId: "ic",
    authorUid: "jo",
    speaker: { kind: "character", characterId: "brannoc" },
    text: "",
    images: [],
    deleted: true,
    createdAt: minutesAgo(30),
  },
  {
    id: "o1",
    channelId: "ooc",
    authorUid: "jo",
    speaker: { kind: "self" },
    text: "Can't make Thursday, will post over the weekend 👍",
    images: [],
    createdAt: minutesAgo(200),
  },
  {
    id: "o2",
    channelId: "ooc",
    authorUid: "gm",
    speaker: { kind: "self" },
    text: "No problem. Reminder: Face Danger +edge for the slope, +wits if you're reading the bog.",
    images: [],
    createdAt: minutesAgo(190),
  },
  {
    id: "s1",
    channelId: "shrine",
    authorUid: "me",
    speaker: { kind: "character", characterId: "tamsin" },
    text: "Tamsin stays at the ridge, watching the road behind them.",
    images: [],
    roll: {
      type: ROLL_TYPE.TRACK_PROGRESS,
      rollLabel: "Reach your destination",
      trackProgress: 7,
      challenge1: 4,
      challenge2: 9,
      result: ROLL_RESULT.WEAK_HIT,
      trackType: TrackTypes.Journey,
      timestamp: new Date(),
      characterId: "tamsin",
      uid: "me",
      gmsOnly: false,
    },
    createdAt: minutesAgo(80),
  },
];

const d = (n: number) => 1 + Math.floor(Math.random() * n);

function makeRoll(kind: RollKind, uid: string, characterId: string | null): Roll {
  const base = { timestamp: new Date(), characterId, uid, gmsOnly: false };
  switch (kind) {
    case "move":
      return statRoll("Heart", "Compel", Math.min(10, d(6) + 2), d(10), d(10), uid, characterId);
    case "stat":
      return statRoll("Iron +1", undefined, Math.min(10, d(6) + 3), d(10), d(10), uid, characterId);
    case "progress": {
      const c1 = d(10);
      const c2 = d(10);
      const p = 6;
      return {
        ...base,
        type: ROLL_TYPE.TRACK_PROGRESS,
        rollLabel: "Fulfill your vow: Free the shrine",
        trackProgress: p,
        challenge1: c1,
        challenge2: c2,
        result: p > c1 && p > c2 ? ROLL_RESULT.HIT : p > c1 || p > c2 ? ROLL_RESULT.WEAK_HIT : ROLL_RESULT.MISS,
        trackType: TrackTypes.Vow,
      };
    }
    case "oracle":
      return {
        ...base,
        type: ROLL_TYPE.ORACLE_TABLE,
        rollLabel: "Theme",
        oracleCategoryName: "Ask the Oracle",
        roll: d(100),
        result: ["Secret", "Bond", "Path", "Ruin", "Hope"][d(5) - 1],
      };
    case "dice": {
      const values = [d(6), d(6)];
      return {
        ...base,
        type: ROLL_TYPE.CUSTOM_DICE,
        rollLabel: "2d6",
        notation: "2d6",
        dieSides: 6,
        dieValues: values,
        modifier: 0,
        total: values[0] + values[1],
      };
    }
  }
}

export const rollKindLabels: Record<RollKind, string> = {
  move: "Move",
  stat: "Stat",
  progress: "Progress",
  oracle: "Oracle",
  dice: "Dice",
};

export interface Draft {
  text: string;
  images: string[];
  roll?: Roll;
}
const emptyDraft: Draft = { text: "", images: [] };

export function speakerName(speaker: Speaker, authorUid: string) {
  if (speaker.kind === "character") return characters[speaker.characterId].name;
  if (speaker.kind === "npc") return speaker.name;
  return people[authorUid].name;
}

export function usePrototypeChat() {
  const [viewAsGM, setViewAsGM] = useState(false);
  const myUid = viewAsGM ? "gm" : "me";
  const [channels, setChannels] = useState(startingChannels);
  const [channelId, setChannelId] = useState("ic");
  const [posts, setPosts] = useState(startingPosts);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [speakerByChannel, setSpeakerByChannel] = useState<Record<string, Speaker>>({});

  const channel = channels.find((c) => c.id === channelId) ?? channels[0];

  const mySpeakers: Speaker[] = useMemo(() => {
    if (viewAsGM) {
      return [{ kind: "self" }, ...npcs.map((name) => ({ kind: "npc" as const, name }))];
    }
    return [
      ...Object.values(characters)
        .filter((c) => c.uid === "me")
        .map((c) => ({ kind: "character" as const, characterId: c.id })),
      { kind: "self" },
    ];
  }, [viewAsGM]);

  // Default speaker follows the channel kind: a character in IC, yourself in OOC.
  const defaultSpeaker: Speaker =
    channel.kind === "IC" && !viewAsGM ? mySpeakers[0] : { kind: "self" };
  const speaker = speakerByChannel[`${myUid}:${channel.id}`] ?? defaultSpeaker;
  const setSpeaker = (s: Speaker) =>
    setSpeakerByChannel((m) => ({ ...m, [`${myUid}:${channel.id}`]: s }));

  const draft = drafts[channel.id] ?? emptyDraft;
  const setDraft = useCallback(
    (update: Partial<Draft>) =>
      setDrafts((all) => ({
        ...all,
        [channelId]: { ...(all[channelId] ?? emptyDraft), ...update },
      })),
    [channelId]
  );

  const visiblePosts = posts.filter(
    (p) => p.channelId === channel.id && (viewAsGM || !p.roll?.gmsOnly)
  );

  const characterId = speaker.kind === "character" ? speaker.characterId : null;

  return {
    viewAsGM,
    setViewAsGM,
    myUid,
    channels,
    channel,
    setChannelId,
    createChannel: (name: string, kind: ChannelKind) => {
      const id = `c${Date.now()}`;
      setChannels((cs) => [...cs, { id, name, kind, starting: false, archived: false }]);
      setChannelId(id);
    },
    archiveChannel: (id: string) =>
      setChannels((cs) => cs.map((c) => (c.id === id && !c.starting ? { ...c, archived: true } : c))),
    posts: visiblePosts,
    unreadCount: (id: string) => (id === "ooc" ? 2 : id === "shrine" ? 1 : 0),
    mySpeakers,
    speaker,
    setSpeaker,
    draft,
    setDraft,
    attachFiles: (files: FileList | File[]) => {
      const images = Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .map((f) => URL.createObjectURL(f));
      setDraft({ images: [...draft.images, ...images] });
    },
    removeImage: (url: string) =>
      setDraft({ images: draft.images.filter((i) => i !== url) }),
    attachRoll: (kind: RollKind) => setDraft({ roll: makeRoll(kind, myUid, characterId) }),
    removeRoll: () => setDraft({ roll: undefined }),
    canSend: !!(draft.text.trim() || draft.images.length || draft.roll),
    send: () => {
      if (!(draft.text.trim() || draft.images.length || draft.roll)) return;
      setPosts((ps) => [
        ...ps,
        {
          id: `p${Date.now()}`,
          channelId: channel.id,
          authorUid: myUid,
          speaker,
          text: draft.text,
          images: draft.images,
          roll: draft.roll ? { ...draft.roll, characterId } : undefined,
          createdAt: new Date(),
        },
      ]);
      setDrafts((all) => ({ ...all, [channel.id]: emptyDraft }));
    },
    canEdit: (p: Post) => p.authorUid === myUid && !p.deleted,
    canDelete: (p: Post) => (p.authorUid === myUid || viewAsGM) && !p.deleted,
    editPost: (id: string, text: string) =>
      setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, text, editedAt: new Date() } : p))),
    deletePost: (id: string) =>
      setPosts((ps) =>
        ps.map((p) => (p.id === id ? { ...p, deleted: true, text: "", images: [], roll: undefined } : p))
      ),
  };
}

export type PrototypeChat = ReturnType<typeof usePrototypeChat>;
