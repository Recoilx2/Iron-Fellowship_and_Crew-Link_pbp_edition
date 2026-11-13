import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExportFilenameTracker } from "services/export/exportFilename";
import { collectAsyncIterable } from "../../__tests__/testUtils";

const mocks = vi.hoisted(() => ({
  getCharacterTracksForExport: vi.fn(),
  getCharacterAssetsForExport: vi.fn(),
  getCharacterForExport: vi.fn(),
}));

vi.mock("api-calls/tracks/getCharacterTracksForExport", () => ({
  getCharacterTracksForExport: mocks.getCharacterTracksForExport,
}));
vi.mock("api-calls/assets/getCharacterAssetsForExport", () => ({
  getCharacterAssetsForExport: mocks.getCharacterAssetsForExport,
}));
vi.mock("api-calls/character/getCharacterForExport", () => ({
  getCharacterForExport: mocks.getCharacterForExport,
}));

import { CharacterExporter } from "../exportCharacter";

describe("CharacterExporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCharacterTracksForExport.mockResolvedValue([]);
    mocks.getCharacterAssetsForExport.mockResolvedValue([]);
  });

  it("does not fetch character data just to count one output file", async () => {
    const exporter = new CharacterExporter({ characterId: "char-1" });

    await expect(exporter.count()).resolves.toBe(1);

    expect(mocks.getCharacterForExport).not.toHaveBeenCalled();
    expect(mocks.getCharacterTracksForExport).not.toHaveBeenCalled();
    expect(mocks.getCharacterAssetsForExport).not.toHaveBeenCalled();
  });

  it("exports character, tracks, and assets in one name-based JSON file", async () => {
    mocks.getCharacterForExport.mockResolvedValue({
      id: "char-1",
      data: {
        uid: "user-1",
        name: "Del Nar",
        stats: { edge: 2 },
        momentum: 3,
        profileImage: { filename: "portrait.png", position: { x: 0, y: 0 }, scale: 1 },
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

    const exporter = new CharacterExporter({
      characterId: "char-1",
      filenameTracker: createExportFilenameTracker(),
    });
    const files = await collectAsyncIterable(exporter.run());

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("characters/del-nar.json");
    expect(JSON.parse(String(files[0].contents))).toMatchObject({
      id: "char-1",
      name: "Del Nar",
      profileImageFilename: "portrait.png",
      tracks: {
        "track-1": {
          id: "track-1",
          label: "Vow",
          value: 4,
          createdDate: "2026-05-30T05:00:00.000Z",
        },
      },
      assets: { "asset-1": { id: "asset-1", name: "Blade" } },
    });
  });

  it("exports tracks even when legacy docs are missing createdDate", async () => {
    mocks.getCharacterForExport.mockResolvedValue({
      id: "char-1",
      data: {
        uid: "user-1",
        name: "Legacy",
        stats: {},
        momentum: 0,
      },
    });
    mocks.getCharacterTracksForExport.mockResolvedValue([
      { id: "track-1", data: { label: "Old Track", value: 1 } },
    ]);
    mocks.getCharacterAssetsForExport.mockResolvedValue([]);

    const exporter = new CharacterExporter({ characterId: "char-1" });
    const files = await collectAsyncIterable(exporter.run());

    expect(JSON.parse(String(files[0].contents))).toMatchObject({
      tracks: { "track-1": { id: "track-1", label: "Old Track", value: 1 } },
    });
  });
});
