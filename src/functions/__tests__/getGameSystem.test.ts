import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GAME_SYSTEMS } from "types/GameSystems.type";

const LOCATION_KEY = "location";

describe("getGameSystem", () => {
  const realLocation = globalThis[LOCATION_KEY as keyof typeof globalThis];

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    if (realLocation === undefined) {
      delete (globalThis as Record<string, unknown>)[LOCATION_KEY];
    } else {
      (globalThis as Record<string, unknown>)[LOCATION_KEY] = realLocation;
    }
    vi.unstubAllEnvs();
  });

  async function loadWithEnv(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        vi.stubEnv(key, "");
      } else {
        vi.stubEnv(key, value);
      }
    }
    const mod = await import("functions/getGameSystem");
    return mod;
  }

  function setHostname(hostname: string) {
    (globalThis as Record<string, unknown>)[LOCATION_KEY] = { hostname };
  }

  it("uses the configured game system instead of the hostname", async () => {
    setHostname("starforged-crew-link.scottbenton.dev");
    const { getGameSystem } = await loadWithEnv({
      VITE_GAME_SYSTEM: GAME_SYSTEMS.IRONSWORN,
    });

    expect(getGameSystem()).toBe(GAME_SYSTEMS.IRONSWORN);
  });

  it("serves starforged when starforged is configured", async () => {
    setHostname("iron-fellowship.scottbenton.dev");
    const { getGameSystem } = await loadWithEnv({
      VITE_GAME_SYSTEM: GAME_SYSTEMS.STARFORGED,
    });

    expect(getGameSystem()).toBe(GAME_SYSTEMS.STARFORGED);
  });

  it("falls back to the hostname when nothing is configured", async () => {
    setHostname("starforged-crew-link.scottbenton.dev");
    const { getGameSystem } = await loadWithEnv({ VITE_GAME_SYSTEM: "" });

    expect(getGameSystem()).toBe(GAME_SYSTEMS.STARFORGED);
  });

  it("ignores an unknown configured value", async () => {
    setHostname("localhost");
    const { getGameSystem } = await loadWithEnv({
      VITE_GAME_SYSTEM: "unknown-system",
    });

    expect(getGameSystem()).toBe(GAME_SYSTEMS.IRONSWORN);
  });

  it("reports whether the game system is configured", async () => {
    const unconfigured = await loadWithEnv({ VITE_GAME_SYSTEM: "" });
    expect(unconfigured.getIsGameSystemConfigured()).toBe(false);

    const configured = await loadWithEnv({
      VITE_GAME_SYSTEM: GAME_SYSTEMS.IRONSWORN,
    });
    expect(configured.getIsGameSystemConfigured()).toBe(true);
  });
});
