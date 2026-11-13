import { GAME_SYSTEMS } from "types/GameSystems.type";

const PROD_HOSTNAME_IRONSWORN = "iron-fellowship.scottbenton.dev";
const PROD_HOSTNAME_STARFORGED = "starforged-crew-link.scottbenton.dev";
const BETA_HOSTNAME_IRONSWORN = "beta.iron-fellowship.scottbenton.dev";
const BETA_HOSTNAME_STARFORGED = "beta.starforged-crew-link.scottbenton.dev";

const prodHostnames = [
  PROD_HOSTNAME_IRONSWORN,
  PROD_HOSTNAME_STARFORGED,
  BETA_HOSTNAME_IRONSWORN,
  BETA_HOSTNAME_STARFORGED,
];

const ironswornHostNames = [PROD_HOSTNAME_IRONSWORN, BETA_HOSTNAME_IRONSWORN];
const starforgedHostNames = [
  PROD_HOSTNAME_STARFORGED,
  BETA_HOSTNAME_STARFORGED,
];

const DEV_HOSTNAME_START_IRONSWORN = "iron-fellowship-dev";
const DEV_HOSTNAME_START_STARFORGED = "crew-link-dev";

function getConfiguredGameSystem(): GAME_SYSTEMS | undefined {
  const configured = import.meta.env.VITE_GAME_SYSTEM;
  if (
    configured === GAME_SYSTEMS.IRONSWORN ||
    configured === GAME_SYSTEMS.STARFORGED
  ) {
    return configured;
  }
  return undefined;
}

/**
 * Whether the site container baked a game system in at build time. When set,
 * configuration wins and the hostname-based choice (plus the local-storage
 * override) is disabled.
 */
export function getIsGameSystemConfigured() {
  return getConfiguredGameSystem() !== undefined;
}

function currentHostname(): string {
  // Tests run in node, where no location exists; treat that as an
  // unrecognized host so callers fall back to their defaults.
  return typeof location === "undefined" ? "" : location.hostname;
}

export function getGameSystem() {
  // One deployment runs one game system: the site container is built for it
  // (see supabase/site/). Hostnames only decide in local development, where
  // no system is configured.
  const configured = getConfiguredGameSystem();
  if (configured) {
    return configured;
  }

  let system: GAME_SYSTEMS = GAME_SYSTEMS.IRONSWORN;
  const hostname = currentHostname();
  if (ironswornHostNames.includes(hostname)) {
    system = GAME_SYSTEMS.IRONSWORN;
  } else if (starforgedHostNames.includes(hostname)) {
    system = GAME_SYSTEMS.STARFORGED;
  } else if (hostname.startsWith(DEV_HOSTNAME_START_IRONSWORN)) {
    system = GAME_SYSTEMS.IRONSWORN;
  } else if (hostname.startsWith(DEV_HOSTNAME_START_STARFORGED)) {
    system = GAME_SYSTEMS.STARFORGED;
  }
  return system;
}

export function getIsProdEnvironment() {
  return prodHostnames.includes(currentHostname());
}

export function getIsLocalEnvironment() {
  return currentHostname() === "localhost";
}
