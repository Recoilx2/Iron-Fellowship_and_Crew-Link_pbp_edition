import { getCharacterForExport } from "api-calls/character/getCharacterForExport";
import { getCharacterAssetsForExport } from "api-calls/assets/getCharacterAssetsForExport";
import {
  CharacterTrackExportRecord,
  getCharacterTracksForExport,
} from "api-calls/tracks/getCharacterTracksForExport";
import { ExportAbortedError } from "services/export/zipBundle";
import {
  buildUniqueExportPath,
  createExportFilenameTracker,
  ExportFilenameTracker,
} from "services/export/exportFilename";
import type { Exporter, ExportFile } from "services/export/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportAbortedError();
}

function serializeTrackForExport(
  track: CharacterTrackExportRecord
): Record<string, unknown> {
  const { data, createdDate } = track;

  return createdDate != null
    ? { ...data, createdDate: createdDate.toISOString() }
    : { ...data };
}

export interface CharacterExporterParams {
  characterId: string;
  filenameTracker?: ExportFilenameTracker;
}

/**
 * Produces a zip sub-tree for a single character:
 *
 *   characters/<characterName>.json
 *
 * The profile-image *binary* is never included; only the filename string
 * already present on the character document is kept.
 *
 * Character Notes (from the /notes Firestore collection) are NOT exported
 * here — they belong to a separate exporter.
 *
 * Access check: the character's `uid` field must match `userId`. Characters
 * are owned resources and are not granularly shared, so a mismatch is a
 * hard failure.
 */
export class CharacterExporter implements Exporter {
  readonly stage = "Character";

  private readonly characterId: string;

  private readonly filenameTracker: ExportFilenameTracker;

  constructor(params: CharacterExporterParams) {
    this.characterId = params.characterId;
    this.filenameTracker =
      params.filenameTracker ?? createExportFilenameTracker();
  }

  async count(signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    return 1;
  }

  async *run(signal?: AbortSignal): AsyncIterable<ExportFile> {
    throwIfAborted(signal);

    const characterPromise = getCharacterForExport(this.characterId);
    const tracksPromise = getCharacterTracksForExport(this.characterId);
    const assetsPromise = getCharacterAssetsForExport(this.characterId);

    const result = await characterPromise;
    throwIfAborted(signal);

    if (!result) {
      throw new Error(`Character ${this.characterId} not found.`);
    }

    const { data: doc } = result;

    // -- character.json -------------------------------------------------------
    // Omit the binary image; keep just the filename string for reference.
    const characterJson: Record<string, unknown> = {
      id: this.characterId,
      uid: doc.uid,
      name: doc.name,
      stats: doc.stats,
      momentum: doc.momentum,
    };

    if (doc.campaignId != null) characterJson.campaignId = doc.campaignId;
    if (doc.worldId != null) characterJson.worldId = doc.worldId;
    if (doc.conditionMeters != null)
      characterJson.conditionMeters = doc.conditionMeters;
    if (doc.initiativeStatus != null)
      characterJson.initiativeStatus = doc.initiativeStatus;
    if (doc.specialTracks != null)
      characterJson.specialTracks = doc.specialTracks;
    if (doc.experience != null) characterJson.experience = doc.experience;
    if (doc.debilities != null) characterJson.debilities = doc.debilities;
    if (doc.adds != null) characterJson.adds = doc.adds;
    if (doc.customTracks != null) characterJson.customTracks = doc.customTracks;
    if (doc.expansionIds != null) characterJson.expansionIds = doc.expansionIds;
    if (doc.theme != null) characterJson.theme = doc.theme;

    // Keep only the filename string, not the position/scale metadata, to
    // make it clear no binary was included.
    if (doc.profileImage?.filename) {
      characterJson.profileImageFilename = doc.profileImage.filename;
    }

    const tracks = await tracksPromise;
    throwIfAborted(signal);

    const tracksRecord: Record<string, unknown> = {};
    tracks.forEach((track) => {
      tracksRecord[track.id] = {
        ...serializeTrackForExport(track),
        id: track.id,
      };
    });

    const assets = await assetsPromise;
    throwIfAborted(signal);

    const assetsRecord: Record<string, unknown> = {};
    assets.forEach((asset) => {
      assetsRecord[asset.id] = { ...asset.data, id: asset.id };
    });

    yield {
      path: buildUniqueExportPath({
        directory: "characters",
        name: doc.name,
        fallbackId: this.characterId,
        extension: "json",
        tracker: this.filenameTracker,
      }),
      contents: JSON.stringify(
        {
          ...characterJson,
          tracks: tracksRecord,
          assets: assetsRecord,
        },
        null,
        2
      ),
    };
    throwIfAborted(signal);
  }
}
