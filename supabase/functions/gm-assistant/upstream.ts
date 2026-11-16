/**
 * Upstream model calls for the GM assistant function (spec #10): the
 * list-models call that feeds the model picker, filtered by the operator's
 * allow-list, and the host helper that tells GMs where their material
 * goes. Split out of `handler.ts` (ticket #151).
 *
 * The API key is only ever sent here, upstream; it never appears in a
 * response, an error or a log.
 */
import type { GmAssistantEnv, UpstreamFetch } from "./env.ts";
import { defaultContextTokens, parseAllowedModels } from "./env.ts";
import { errorName } from "./http.ts";

export interface AssistantModel {
  id: string;
  contextTokens: number;
}

export async function fetchUpstreamModels(
  env: GmAssistantEnv,
  fetchImpl: UpstreamFetch,
): Promise<{ ok: true; models: AssistantModel[] } | { ok: false; detail: string }> {
  const fallback = defaultContextTokens(env.contextTokens);
  const allowList = parseAllowedModels(env.allowedModels);
  let response: Response;
  try {
    const headers = new Headers();
    if (env.apiKey.trim()) {
      headers.set("Authorization", `Bearer ${env.apiKey}`);
    }
    response = await fetchImpl(
      `${env.endpoint.replace(/\/+$/, "")}/models`,
      { headers },
    );
  } catch (error) {
    return {
      ok: false,
      detail: `models request failed (${errorName(error)})`,
    };
  }
  if (!response.ok) {
    return { ok: false, detail: `models upstream status ${response.status}` };
  }
  let data: Array<Record<string, unknown>> = [];
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const list = (parsed as { data?: unknown }).data;
    data = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  } catch {
    return { ok: false, detail: "models upstream body was not JSON" };
  }
  const models: AssistantModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry.id !== "string" || !entry.id) continue;
    if (allowList && !allowList.includes(entry.id)) continue;
    const reported =
      typeof entry.context_length === "number" && entry.context_length > 0
        ? Math.trunc(entry.context_length)
        : typeof entry.contextLength === "number" && entry.contextLength > 0
          ? Math.trunc(entry.contextLength)
          : fallback;
    models.push({ id: entry.id, contextTokens: reported });
  }
  return { ok: true, models };
}

/**
 * Host (and port) of the configured endpoint, for telling GMs where their
 * material goes. Never userinfo, path, query or key; null when unset or
 * unparseable.
 */
export function endpointHostOf(endpoint: string): string | null {
  if (!endpoint.trim()) return null;
  try {
    return new URL(endpoint.trim()).host || null;
  } catch {
    return null;
  }
}
