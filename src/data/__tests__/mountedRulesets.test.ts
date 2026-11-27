import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  loadMountedManifest,
  MOUNTED_MANIFEST_PATH,
  type MountedManifest,
} from "../mountedRulesets";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("functions/errorReference", () => ({ logError }));

const PACKAGE_PATH = "/config/rulesets/mounted_e2e.json";
const source = {
  title: "Mounted Test Expansion",
  url: "https://example.com/mounted-e2e",
  license: "https://creativecommons.org/licenses/by/4.0",
  date: "2026-11-27",
  authors: [{ name: "Stack Template" }],
};

function expansion(overrides: Record<string, unknown> = {}) {
  return {
    _id: "mounted_e2e",
    type: "expansion",
    datasworn_version: "0.3.0",
    ruleset: "classic",
    ...source,
    oracles: {},
    moves: {},
    assets: {},
    ...overrides,
  };
}

function manifest(overrides: Partial<MountedManifest> = {}): MountedManifest {
  return {
    version: 1,
    expansions: [
      {
        id: "mounted_e2e",
        path: PACKAGE_PATH,
        name: "Mounted Test Expansion",
        type: "expansion",
        isHomebrew: true,
      },
    ],
    ...overrides,
  };
}

function stubFetch(responses: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : (input as { url: string }).url;
    if (!(url in responses)) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => structuredClone(responses[url]),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../supabase/site/config/rulesets/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );

describe("loadMountedManifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads valid packages from the mounted manifest", async () => {
    const rulesetData = {
      _id: "mounted_ruleset",
      type: "ruleset",
      datasworn_version: "0.3.0",
      ...source,
      rules: {
        stats: {},
        condition_meters: {},
        special_tracks: {},
        impacts: {},
        tags: {},
      },
      oracles: {},
      moves: {},
      assets: {},
    };
    const fetchMock = stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest({
        ruleset: {
          id: "mounted_ruleset",
          path: "/config/rulesets/mounted_ruleset.json",
          name: "Mounted Ruleset",
          type: "ruleset",
        },
      }),
      "/config/rulesets/mounted_ruleset.json": rulesetData,
      [PACKAGE_PATH]: expansion(),
    });

    const result = await loadMountedManifest("classic");

    expect(result.manifest.version).toBe(1);
    expect(result.packages.map(({ ref }) => ref.id)).toEqual([
      "mounted_ruleset",
      "mounted_e2e",
    ]);
    expect(result.packages[0].data._id).toBe("mounted_ruleset");
    expect(result.packages[1].data._id).toBe("mounted_e2e");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logError).not.toHaveBeenCalled();
  });

  it("treats an absent manifest as an empty mount", async () => {
    stubFetch({});

    const result = await loadMountedManifest("classic");

    expect(result.packages).toEqual([]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("skips a package that fails the Datasworn schema", async () => {
    stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest(),
      [PACKAGE_PATH]: expansion({ title: 42 }),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages).toEqual([]);
    expect(logError).toHaveBeenCalledOnce();
  });

  it("skips a package with the wrong Datasworn version", async () => {
    stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest(),
      [PACKAGE_PATH]: expansion({ datasworn_version: "0.2.0" }),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages).toEqual([]);
    expect(logError).toHaveBeenCalledOnce();
  });

  it("skips traversal and absolute-URL package paths without fetching them", async () => {
    const fetchMock = stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest({
        expansions: [
          {
            id: "traversal",
            path: "/config/rulesets/../secret.json",
            name: "Traversal",
            type: "expansion",
          },
          {
            id: "absolute",
            path: "https://evil.example/config/rulesets/evil.json",
            name: "Absolute",
            type: "expansion",
          },
          {
            id: "encoded",
            path: "/config/rulesets/%2e%2e/secret.json",
            name: "Encoded",
            type: "expansion",
          },
        ],
      }),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(3);
  });

  it("skips duplicate manifest ids", async () => {
    stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest({
        expansions: [
          manifest().expansions[0],
          {
            ...manifest().expansions[0],
            path: "/config/rulesets/duplicate.json",
          },
        ],
      }),
      [PACKAGE_PATH]: expansion(),
      "/config/rulesets/duplicate.json": expansion(),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages.map(({ ref }) => ref.id)).toEqual(["mounted_e2e"]);
    expect(logError).toHaveBeenCalledOnce();
  });

  it("skips a package whose id or ruleset does not match its ref", async () => {
    stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest({
        expansions: [
          manifest().expansions[0],
          {
            id: "other_ruleset",
            path: "/config/rulesets/other_ruleset.json",
            name: "Other Ruleset",
            type: "expansion",
          },
        ],
      }),
      [PACKAGE_PATH]: expansion({ _id: "wrong_id" }),
      "/config/rulesets/other_ruleset.json": expansion({
        _id: "other_ruleset",
        ruleset: "starforged",
      }),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("ignores a replacing ruleset, leaving base replacement to #218", async () => {
    const fetchMock = stubFetch({
      [MOUNTED_MANIFEST_PATH]: manifest({
        ruleset: {
          id: "replacement",
          path: "/config/rulesets/replacement.json",
          name: "Replacement",
          type: "ruleset",
          replacesBase: true,
        },
      }),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages).toEqual([]);
    expect(
      fetchMock.mock.calls.every(([url]) => url !== "/config/rulesets/replacement.json"),
    ).toBe(true);
  });

  it("accepts the Datasworn fixture shipped in the stack template", async () => {
    stubFetch({
      [MOUNTED_MANIFEST_PATH]: fixture("manifest.json"),
      [PACKAGE_PATH]: fixture("mounted_e2e.json"),
    });

    const result = await loadMountedManifest("classic");

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].ref.name).toBe("Mounted Test Expansion");
    expect(result.packages[0].data.type).toBe("expansion");
    expect(logError).not.toHaveBeenCalled();
  });
});
