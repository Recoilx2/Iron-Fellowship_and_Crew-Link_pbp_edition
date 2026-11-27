import {
  DATASWORN_SCHEMA_VERSION,
  Datasworn,
} from "@datasworn-community/core";
import Ajv from "ajv";
import dataswornSchema from "@datasworn-community/core/json/datasworn.schema.json";
import { logError } from "functions/errorReference";
import { RulesetBranding } from "config/branding.config";
import { AskTheOracle } from "config/system.config";
import { MechanicsConfig, MechanicsOverride } from "config/mechanics.config";
import { Themes } from "providers/ThemeProvider/themes/theme.types";

/** Where nginx serves a copy's read-only ruleset volume. */
export const MOUNTED_RULESETS_PATH = "/config/rulesets";
export const MOUNTED_MANIFEST_PATH = `${MOUNTED_RULESETS_PATH}/manifest.json`;

export interface MountedPackageRef {
  id: string;
  path: string;
  name: string;
  type: "ruleset" | "expansion";
  replacesBase?: boolean;
  isHomebrew?: boolean;
  note?: string;
  licenseInfo?: {
    license: string;
    licenseUrl: string;
    url?: string;
    author: string;
  };
}

export interface MountedManifest {
  version: 1;
  ruleset?: MountedPackageRef;
  expansions: MountedPackageRef[];
}

export interface MountedPackage {
  ref: MountedPackageRef;
  data: Datasworn.Ruleset | Datasworn.Expansion;
}

export interface MountedRulesets {
  manifest: MountedManifest;
  packages: MountedPackage[];
}

/**
 * Optional extension fields on a mounted Datasworn ruleset. Datasworn
 * allows additional properties, so a package can carry its own branding and
 * mechanics overrides without a second config file.
 */
export const BRANDING_KEY = "x-branding";
export const MECHANICS_KEY = "x-mechanics";

export type MountedRulesetMechanics = MechanicsOverride;

const EMPTY_MANIFEST: MountedManifest = { version: 1, expansions: [] };

// The Datasworn schema is draft-07. It is already a dependency of the site,
// so validate against the published artifact rather than re-describing it.
// `markdown` is a custom format for prose: the schema's string type is all
// that can be checked here.
const ajv = new Ajv({ allErrors: true, logger: false });
ajv.addFormat("markdown", () => true);
const isValidDataswornPackage = ajv.compile(dataswornSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Only root-relative paths inside the mounted rulesets directory are allowed.
 * A synthetic base is enough to catch absolute URLs, encoded traversal and
 * other paths that would escape the mount: every accepted path must survive
 * URL parsing unchanged and stay under the prefix.
 */
function mountedPackageUrl(path: unknown): URL {
  assert(typeof path === "string", "package path must be a string");
  assert(
    path.startsWith(`${MOUNTED_RULESETS_PATH}/`),
    `package path must start with ${MOUNTED_RULESETS_PATH}/`,
  );
  assert(
    !/\\|\.\.|%|[?#]/.test(path),
    `package path must not contain traversal or URL syntax: ${path}`,
  );

  const base = "http://site.invalid";
  const url = new URL(path, base);
  assert(
    url.origin === base &&
      url.pathname === path &&
      url.pathname.startsWith(`${MOUNTED_RULESETS_PATH}/`),
    `package path is not same-origin and inside the mount: ${path}`,
  );
  return url;
}

function parseRef(value: unknown, label: string): MountedPackageRef {
  assert(isRecord(value), `${label} must be an object`);
  const { id, path, name, type } = value;
  assert(
    typeof id === "string" && /^[a-z][a-z0-9_]*$/.test(id),
    `${label} has an invalid id`,
  );
  assert(typeof path === "string" && path.length > 0, `${label} has no path`);
  assert(typeof name === "string" && name.length > 0, `${label} has no name`);
  assert(
    type === "ruleset" || type === "expansion",
    `${label} has an invalid type`,
  );

  const ref: MountedPackageRef = { id, path, name, type };
  if (value.replacesBase !== undefined) {
    assert(
      typeof value.replacesBase === "boolean",
      `${label} has an invalid replacesBase`,
    );
    ref.replacesBase = value.replacesBase;
  }
  if (value.isHomebrew !== undefined) {
    assert(
      typeof value.isHomebrew === "boolean",
      `${label} has an invalid isHomebrew`,
    );
    ref.isHomebrew = value.isHomebrew;
  }
  if (value.note !== undefined) {
    assert(typeof value.note === "string", `${label} has an invalid note`);
    ref.note = value.note;
  }
  if (value.licenseInfo !== undefined) {
    assert(
      isRecord(value.licenseInfo) &&
        typeof value.licenseInfo.license === "string" &&
        typeof value.licenseInfo.licenseUrl === "string" &&
        typeof value.licenseInfo.author === "string" &&
        (value.licenseInfo.url === undefined ||
          typeof value.licenseInfo.url === "string"),
      `${label} has invalid licenseInfo`,
    );
    ref.licenseInfo = {
      license: value.licenseInfo.license,
      licenseUrl: value.licenseInfo.licenseUrl,
      author: value.licenseInfo.author,
      ...(value.licenseInfo.url === undefined
        ? {}
        : { url: value.licenseInfo.url }),
    };
  }
  return ref;
}

/** Same-origin asset paths only: the mount, or the site's built-in assets. */
function brandingAssetPath(value: unknown, label: string): string {
  assert(
    typeof value === "string" && value.startsWith("/"),
    `${label} must be a root-relative path`,
  );
  assert(
    !/[\\? #%]/.test(value) && !value.includes(".."),
    `${label} must not contain traversal or URL syntax: ${value}`,
  );
  if (value.startsWith(`${MOUNTED_RULESETS_PATH}/`)) {
    return mountedPackageUrl(value).pathname;
  }
  assert(
    /^\/(assets|theme)\//.test(value),
    `${label} must point inside the mount or the built-in assets`,
  );
  return value;
}

function parseBranding(value: unknown): RulesetBranding | undefined {
  if (value === undefined) return undefined;
  assert(isRecord(value), `${BRANDING_KEY} must be an object`);
  const branding: RulesetBranding = {};
  for (const key of ["appName", "title", "description"] as const) {
    const text = value[key];
    if (text !== undefined) {
      assert(
        typeof text === "string" && text.trim().length > 0,
        `${BRANDING_KEY}.${key} must be a non-empty string`,
      );
      branding[key] = text;
    }
  }
  if (value.faviconPath !== undefined) {
    branding.faviconPath = brandingAssetPath(
      value.faviconPath,
      `${BRANDING_KEY}.faviconPath`,
    );
  }
  if (value.openGraphPath !== undefined) {
    branding.openGraphPath = brandingAssetPath(
      value.openGraphPath,
      `${BRANDING_KEY}.openGraphPath`,
    );
  }
  if (value.theme !== undefined) {
    assert(
      Object.values(Themes).includes(value.theme as Themes),
      `${BRANDING_KEY}.theme is not a known theme`,
    );
    branding.theme = value.theme as Themes;
  }
  return branding;
}

function parseMechanics(value: unknown): MountedRulesetMechanics | undefined {
  if (value === undefined) return undefined;
  assert(isRecord(value), `${MECHANICS_KEY} must be an object`);
  const mechanics: MountedRulesetMechanics = {};
  if (value.actionTotalCap !== undefined) {
    assert(
      typeof value.actionTotalCap === "number" &&
        Number.isInteger(value.actionTotalCap) &&
        value.actionTotalCap > 0,
      `${MECHANICS_KEY}.actionTotalCap must be a positive integer`,
    );
    mechanics.actionTotalCap = value.actionTotalCap;
  }
  if (value.momentumBurn !== undefined) {
    assert(
      isRecord(value.momentumBurn),
      `${MECHANICS_KEY}.momentumBurn must be an object`,
    );
    const burn: Record<string, unknown> = {};
    for (const key of ["enabled", "liftOnTie", "negativeMomentumCancels"]) {
      const setting = value.momentumBurn[key];
      if (setting !== undefined) {
        assert(
          typeof setting === "boolean",
          `${MECHANICS_KEY}.momentumBurn.${key} must be a boolean`,
        );
        burn[key] = setting;
      }
    }
    for (const key of ["min", "max", "startingValue"]) {
      const setting = value.momentumBurn[key];
      if (setting !== undefined) {
        assert(
          typeof setting === "number" && Number.isFinite(setting),
          `${MECHANICS_KEY}.momentumBurn.${key} must be a number`,
        );
        burn[key] = setting;
      }
    }
    assert(
      (burn.min === undefined || burn.max === undefined) ||
        (burn.min as number) < (burn.max as number),
      `${MECHANICS_KEY}.momentumBurn.min must be below max`,
    );
    mechanics.momentumBurn = burn as unknown as MechanicsConfig["momentumBurn"];
  }
  if (value.progressTracks !== undefined) {
    assert(
      Array.isArray(value.progressTracks) &&
        value.progressTracks.length > 0 &&
        value.progressTracks.every(
          (track) => typeof track === "string" && track.trim().length > 0,
        ),
      `${MECHANICS_KEY}.progressTracks must be a non-empty list of labels`,
    );
    mechanics.progressTracks = [...(value.progressTracks as string[])];
  }
  if (value.oracleThresholds !== undefined) {
    assert(
      isRecord(value.oracleThresholds),
      `${MECHANICS_KEY}.oracleThresholds must be an object`,
    );
    const thresholds: Partial<Record<AskTheOracle, string>> = {};
    for (const [key, oracleId] of Object.entries(value.oracleThresholds)) {
      assert(
        Object.values(AskTheOracle).includes(key as AskTheOracle) &&
          typeof oracleId === "string" &&
          oracleId.trim().length > 0,
        `${MECHANICS_KEY}.oracleThresholds has an invalid entry: ${key}`,
      );
      thresholds[key as AskTheOracle] = oracleId;
    }
    mechanics.oracleThresholds = thresholds;
  }
  return mechanics;
}

/** Validated branding carried by a mounted ruleset package, if any. */
export function parseRulesetBranding(data: unknown): RulesetBranding | undefined {
  if (!isRecord(data)) return undefined;
  try {
    return parseBranding(data[BRANDING_KEY]);
  } catch (e) {
    logSkipped(e);
    return undefined;
  }
}

/** Validated mechanics carried by a mounted ruleset package, if any. */
export function parseRulesetMechanics(
  data: unknown,
): MountedRulesetMechanics | undefined {
  if (!isRecord(data)) return undefined;
  try {
    return parseMechanics(data[MECHANICS_KEY]);
  } catch (e) {
    logSkipped(e);
    return undefined;
  }
}

function parseManifest(value: unknown): MountedManifest {
  assert(isRecord(value), "manifest must be an object");
  assert(value.version === 1, "manifest version must be 1");
  assert(Array.isArray(value.expansions), "manifest expansions must be an array");

  const ruleset =
    value.ruleset === undefined
      ? undefined
      : parseRef(value.ruleset, "manifest ruleset");
  const expansions = value.expansions.map((entry, index) =>
    parseRef(entry, `manifest expansions[${index}]`),
  );
  return {
    version: 1,
    ...(ruleset ? { ruleset } : {}),
    expansions,
  };
}

function packageValidationError(
  data: unknown,
  ref: MountedPackageRef,
  activeRulesetId: string,
  replacingRulesetId?: string,
): string {
  if (!isRecord(data)) {
    return `${ref.id}: package is not an object`;
  }
  if (!isValidDataswornPackage(data)) {
    return `${ref.id}: ${ajv.errorsText(isValidDataswornPackage.errors, {
      separator: "; ",
    })}`;
  }
  if (data.datasworn_version !== DATASWORN_SCHEMA_VERSION) {
    return `${ref.id}: datasworn_version is ${String(
      data.datasworn_version,
    )}, expected ${DATASWORN_SCHEMA_VERSION}`;
  }
  if (data._id !== ref.id) {
    return `${ref.id}: package _id is ${String(data._id)}`;
  }
  if (data.type !== ref.type) {
    return `${ref.id}: package type is ${String(data.type)}, expected ${ref.type}`;
  }
  if (
    ref.type === "expansion" &&
    data.ruleset !== activeRulesetId &&
    data.ruleset !== replacingRulesetId
  ) {
    return `${ref.id}: expansion ruleset is ${String(
      data.ruleset,
    )}, expected ${activeRulesetId}`;
  }
  return "";
}

function logSkipped(error: unknown): void {
  logError("mountedRulesets", error);
}

/**
 * Reads the manifest and its Datasworn packages from the same-origin mount.
 * A copy with no volume simply has no manifest (404), which is not an error.
 * Anything malformed is logged and skipped so one bad file never stops the
 * site from starting.
 */
export async function loadMountedManifest(
  activeRulesetId: string,
): Promise<MountedRulesets> {
  let manifest: MountedManifest;
  try {
    const response = await fetch(MOUNTED_MANIFEST_PATH);
    if (response.status === 404) {
      return { manifest: EMPTY_MANIFEST, packages: [] };
    }
    if (!response.ok) {
      throw new Error(`manifest request failed with HTTP ${response.status}`);
    }
    manifest = parseManifest(await response.json());
  } catch (e) {
    logSkipped(e);
    return { manifest: EMPTY_MANIFEST, packages: [] };
  }

  const refs = [
    ...(manifest.ruleset ? [manifest.ruleset] : []),
    ...manifest.expansions,
  ];
  // Expansions built for the configured base still load when a package
  // replaces that base (e.g. an Ironsworn expansion under an OSR ruleset).
  const replacingRulesetId = manifest.ruleset?.replacesBase
    ? manifest.ruleset.id
    : undefined;
  const packages: MountedPackage[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const ref of refs) {
    if (seenIds.has(ref.id)) {
      logSkipped(new Error(`duplicate mounted package id skipped: ${ref.id}`));
      continue;
    }
    let url: URL;
    try {
      url = mountedPackageUrl(ref.path);
    } catch (e) {
      logSkipped(e);
      continue;
    }
    if (seenPaths.has(url.pathname)) {
      logSkipped(new Error(`duplicate mounted package path skipped: ${ref.path}`));
      continue;
    }

    try {
      const response = await fetch(url.pathname);
      if (!response.ok) {
        throw new Error(`${ref.path}: HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      const error = packageValidationError(
        data,
        ref,
        activeRulesetId,
        replacingRulesetId,
      );
      if (error) throw new Error(error);
      packages.push({
        ref,
        data: data as Datasworn.Ruleset | Datasworn.Expansion,
      });
      seenIds.add(ref.id);
      seenPaths.add(url.pathname);
    } catch (e) {
      logSkipped(e);
    }
  }

  return { manifest, packages };
}
