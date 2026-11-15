/**
 * Helpers for live tests that exercise the Edge Runtime functions container
 * (GM assistant proxy, ticket #129).
 *
 * The functions container reads its config once at start, so tests that need
 * an upstream model server recreate just the `functions` service with extra
 * environment overrides (the fake endpoint, key and allow-list) through the
 * local `docker compose` project, then restore it afterwards. Nothing here
 * runs without a stack: callers skip when `liveStackConfig()` is null, and
 * Docker is only touched on machines that already run the stack.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ComposeTarget {
  project: string;
  envFile: string;
  composeDir: string;
}

export function supabaseDirFromEnvFile(envFile: string): string {
  return dirname(envFile);
}

/** Parses `KEY=value` lines out of a compose env file. */
export function readEnvFile(envFile: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const index = line.indexOf("=");
    vars[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return vars;
}

/**
 * Finds the compose project whose config file is the template next to the
 * given env file. Throws when Docker is unreachable so the failure is loud
 * instead of silently testing the wrong stack.
 */
export function detectComposeProject(envFile: string): ComposeTarget {
  const composeDir = supabaseDirFromEnvFile(envFile);
  const composeFile = join(composeDir, "docker-compose.yml");
  let output: string;
  try {
    output = execFileSync("docker", ["compose", "ls", "--format", "json"], {
      encoding: "utf8",
      timeout: 30000,
    });
  } catch (error) {
    throw new Error(
      `could not list compose projects: ${error instanceof Error ? error.message : error}`,
    );
  }
  const projects = JSON.parse(output) as Array<{ Name?: string; ConfigFiles?: string }>;
  for (const project of projects) {
    const files = (project.ConfigFiles ?? "").split(",").map((file) => file.trim());
    if (project.Name && files.includes(composeFile)) {
      return { project: project.Name, envFile, composeDir };
    }
  }
  throw new Error(`no compose project found for ${composeFile} (docker compose ls: ${output})`);
}

function composeArgs(target: ComposeTarget, extra: string[]): string[] {
  return [
    "compose",
    "-p",
    target.project,
    "--env-file",
    target.envFile,
    "-f",
    "docker-compose.yml",
    ...extra,
  ];
}

/**
 * Recreates the `functions` service so it picks up `extraEnv` overrides
 * (which win over the env file for compose interpolation). Pass `{}` to
 * restore the pristine env-file config.
 */
export function recreateFunctionsContainer(
  target: ComposeTarget,
  extraEnv: Record<string, string>,
): void {
  try {
    execFileSync("docker", composeArgs(target, ["up", "-d", "functions"]), {
      cwd: target.composeDir,
      env: { ...process.env, ENV_FILE: target.envFile, ...extraEnv },
      stdio: "pipe",
      timeout: 180000,
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(
      `could not recreate functions container: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * Waits until the functions container answers through the gateway again.
 * Unknown function paths always return the placeholder code, so the probe
 * works with and without the assistant configured.
 */
export async function waitForFunctionsReady(
  functionsBaseUrl: string,
  timeoutMs = 120000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${functionsBaseUrl}/smoke-probe`);
      const text = await res.text();
      if (res.status === 404 && text.includes("FUNCTIONS_NOT_CONFIGURED")) {
        return;
      }
    } catch {
      // Not up yet; keep polling.
    }
    if (Date.now() >= deadline) {
      throw new Error(`functions container not ready at ${functionsBaseUrl}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export interface FunctionCallOptions {
  token?: string;
  origin?: string;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface FunctionCallResult {
  status: number;
  headers: Headers;
  text: string;
}

export async function callFunction(
  functionsBaseUrl: string,
  path: string,
  options: FunctionCallOptions = {},
): Promise<FunctionCallResult> {
  const headers = new Headers();
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.origin) headers.set("Origin", options.origin);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(`${functionsBaseUrl}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

export function sseContents(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => (JSON.parse(payload) as { content: string }).content);
}
