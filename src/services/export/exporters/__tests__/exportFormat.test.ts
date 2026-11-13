import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectAsyncIterable } from "../../__tests__/testUtils";

// Format-comparison goldens for #23: the exporters read through the new
// Supabase-backed data layer, but the files they produce must stay
// byte-identical to the current (Firebase-era) format. These tests pin the
// exact file bytes — path and contents — for one representative fixture per
// exporter, using the real yjsToMarkdown so the embedded markdown is covered
// too. The only accepted delta from the old format is world.json no longer
// carrying `campaignGuides` (that field no longer exists in the data model
// after #21, decision #12).

const mocks = vi.hoisted(() => ({
  getCharacterForExport: vi.fn(),
  getCharacterTracksForExport: vi.fn(),
  getCharacterAssetsForExport: vi.fn(),
  getWorldForExport: vi.fn(),
  countWorldItemsForExport: vi.fn(),
  getAllNPCsForExport: vi.fn(),
  getAllLoreForExport: vi.fn(),
  getAllLocationsForExport: vi.fn(),
  getAllNotesWithContent: vi.fn(),
  getAllLogsForExport: vi.fn(),
}));

vi.mock("api-calls/character/getCharacterForExport", () => ({
  getCharacterForExport: mocks.getCharacterForExport,
}));
vi.mock("api-calls/tracks/getCharacterTracksForExport", () => ({
  getCharacterTracksForExport: mocks.getCharacterTracksForExport,
}));
vi.mock("api-calls/assets/getCharacterAssetsForExport", () => ({
  getCharacterAssetsForExport: mocks.getCharacterAssetsForExport,
}));
vi.mock("api-calls/world/getWorldForExport", () => ({
  getWorldForExport: mocks.getWorldForExport,
}));
vi.mock("api-calls/world/countWorldItemsForExport", () => ({
  countWorldItemsForExport: mocks.countWorldItemsForExport,
}));
vi.mock("api-calls/world/npcs/getAllNPCsForExport", () => ({
  getAllNPCsForExport: mocks.getAllNPCsForExport,
}));
vi.mock("api-calls/world/lore/getAllLoreForExport", () => ({
  getAllLoreForExport: mocks.getAllLoreForExport,
}));
vi.mock("api-calls/world/locations/getAllLocationsForExport", () => ({
  getAllLocationsForExport: mocks.getAllLocationsForExport,
}));
vi.mock("api-calls/notes/getAllNotesWithContent", () => ({
  getAllNotesWithContent: mocks.getAllNotesWithContent,
}));
vi.mock("api-calls/game-log/getAllLogsForExport", () => ({
  getAllLogsForExport: mocks.getAllLogsForExport,
}));

import { CharacterExporter } from "../exportCharacter";
import { WorldExporter } from "../exportWorld";
import { NotesExporter } from "../exportNotes";
import { RollLogExporter } from "../exportRollLog";

describe("export file format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("character file matches the current format byte-for-byte", async () => {
    mocks.getCharacterForExport.mockResolvedValue({
      id: "char-1",
      data: {
        uid: "user-1",
        name: "Del Nar",
        stats: { edge: 2 },
        momentum: 3,
        campaignId: "camp-1",
        profileImage: {
          filename: "portrait.png",
          position: { x: 0, y: 0 },
          scale: 1,
        },
      },
    });
    mocks.getCharacterTracksForExport.mockResolvedValue([
      {
        id: "track-1",
        data: { label: "Vow", value: 4 },
        createdDate: new Date("2026-05-30T05:00:00.000Z"),
      },
    ]);
    mocks.getCharacterAssetsForExport.mockResolvedValue([
      { id: "asset-1", data: { name: "Blade" } },
    ]);

    const exporter = new CharacterExporter({ characterId: "char-1" });
    const files = await collectAsyncIterable(exporter.run());

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("characters/del-nar.json");
    expect(files[0].contents).toBe(
      `{
  "id": "char-1",
  "uid": "user-1",
  "name": "Del Nar",
  "stats": {
    "edge": 2
  },
  "momentum": 3,
  "campaignId": "camp-1",
  "profileImageFilename": "portrait.png",
  "tracks": {
    "track-1": {
      "label": "Vow",
      "value": 4,
      "createdDate": "2026-05-30T05:00:00.000Z",
      "id": "track-1"
    }
  },
  "assets": {
    "asset-1": {
      "name": "Blade",
      "id": "asset-1"
    }
  }
}`
    );
  });

  it("world files match the current format byte-for-byte", async () => {
    mocks.getWorldForExport.mockResolvedValue({
      name: "World",
      settingKey: "starforged",
      ownerIds: ["user-1"],
      newTruths: { truth: { selectedTruthOptionIndex: 1 } },
      worldDescription: null,
    });
    mocks.countWorldItemsForExport.mockResolvedValue({
      npcCount: 1,
      loreCount: 1,
      locationCount: 1,
    });
    mocks.getAllNPCsForExport.mockResolvedValue([
      {
        id: "npc-1",
        doc: { name: "Haven Guard", sharedWithPlayers: true },
        notes: null,
        gmNotes: null,
        gmProperties: { role: "Guide" },
      },
    ]);
    mocks.getAllLoreForExport.mockResolvedValue([
      {
        id: "lore-1",
        doc: { name: "Signal", sharedWithPlayers: true },
        notes: null,
        gmNotes: null,
      },
    ]);
    mocks.getAllLocationsForExport.mockResolvedValue([
      {
        id: "loc-1",
        doc: { name: "Haven", sharedWithPlayers: true },
        notes: null,
        gmNotes: null,
        gmProperties: null,
      },
    ]);

    const exporter = new WorldExporter({ worldId: "world-1", userId: "user-1" });
    const files = await collectAsyncIterable(exporter.run());

    expect(files.map((file) => file.path)).toEqual([
      "world.json",
      "npcs/haven-guard.json",
      "lore/signal.json",
      "locations/haven.json",
    ]);
    expect(files[0].contents).toBe(
      `{
  "id": "world-1",
  "name": "World",
  "settingKey": "starforged",
  "ownerIds": [
    "user-1"
  ],
  "newTruths": {
    "truth": {
      "selectedTruthOptionIndex": 1
    }
  },
  "descriptionMarkdown": ""
}`
    );
    expect(files[1].contents).toBe(
      `{
  "id": "npc-1",
  "name": "Haven Guard",
  "sharedWithPlayers": true,
  "role": "Guide",
  "notesMarkdown": "",
  "gmNotesMarkdown": ""
}`
    );
    expect(files[2].contents).toBe(
      `{
  "id": "lore-1",
  "name": "Signal",
  "sharedWithPlayers": true,
  "notesMarkdown": "",
  "gmNotesMarkdown": ""
}`
    );
    expect(files[3].contents).toBe(
      `{
  "id": "loc-1",
  "name": "Haven",
  "sharedWithPlayers": true,
  "notesMarkdown": "",
  "gmNotesMarkdown": ""
}`
    );
  });

  it("note files match the current format byte-for-byte", async () => {
    mocks.getAllNotesWithContent.mockResolvedValue([
      {
        noteId: "n-1",
        meta: { title: "Alpha", order: 1, shared: true },
        content: null,
      },
    ]);

    const exporter = new NotesExporter({
      campaignId: "camp-1",
      includeUnsharedCampaignNotes: true,
    });
    const files = await collectAsyncIterable(exporter.run());

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("notes/alpha.json");
    expect(files[0].contents).toBe(
      `{
  "id": "n-1",
  "noteId": "n-1",
  "title": "Alpha",
  "shared": true,
  "order": 1,
  "source": "campaign",
  "markdown": ""
}`
    );
  });

  it("roll log file matches the current format byte-for-byte", async () => {
    mocks.getAllLogsForExport.mockResolvedValue([
      {
        id: "log-1",
        roll: {
          type: "oracle",
          rollLabel: "Oracle",
          timestamp: "2026-05-30T04:00:00.000Z",
          characterId: "char-1",
          uid: "user-1",
          gmsOnly: false,
          roll: 42,
          result: "A result",
        },
      },
    ]);

    const exporter = new RollLogExporter({
      campaignId: "camp-1",
      isGM: false,
    });
    const files = await collectAsyncIterable(exporter.run());

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("roll-log.json");
    expect(files[0].contents).toBe(
      `{
  "source": "campaign",
  "ownerId": "camp-1",
  "rolls": [
    {
      "logId": "log-1",
      "type": "oracle",
      "rollLabel": "Oracle",
      "timestamp": "2026-05-30T04:00:00.000Z",
      "characterId": "char-1",
      "uid": "user-1",
      "gmsOnly": false,
      "roll": 42,
      "result": "A result",
      "id": "log-1"
    }
  ]
}`
    );
  });
});
