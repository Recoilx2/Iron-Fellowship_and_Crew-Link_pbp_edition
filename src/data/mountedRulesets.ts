import {
  DATASWORN_SCHEMA_VERSION,
  Datasworn,
} from "@datasworn-community/core";
import Ajv from "ajv";
import dataswornSchema from "@datasworn-community/core/json/datasworn.schema.json";
import { logError } from "functions/errorReference";

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
  if (ref.type === "expansion" && data.ruleset !== activeRulesetId) {
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
  const packages: MountedPackage[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const ref of refs) {
    if (seenIds.has(ref.id)) {
      logSkipped(new Error(`duplicate mounted package id skipped: ${ref.id}`));
      continue;
    }
    if (ref.type === "ruleset" && ref.replacesBase) {
      // TODO(#218): a replacing ruleset needs async bootstrap before defaults
      // are read, plus generalised branding/mechanics (wayfinder #208). This
      // ticket is additive only, so ignore the entry here.
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
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${ref.path}: HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      const error = packageValidationError(data, ref, activeRulesetId);
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
