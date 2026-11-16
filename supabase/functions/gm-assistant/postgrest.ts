/**
 * Every database read and write of the GM assistant function goes through
 * PostgREST with the caller's JWT (spec #10), so the row-level security
 * rules stay the only gate; the service role is never used. Split out of
 * `handler.ts` (ticket #151).
 */
import type { GmAssistantEnv, UpstreamFetch } from "./env.ts";

export interface PostgrestOptions {
  method?: string;
  body?: unknown;
  prefer?: string;
}

export async function postgrest(
  env: GmAssistantEnv,
  callerToken: string,
  path: string,
  fetchImpl: UpstreamFetch,
  options?: PostgrestOptions,
): Promise<{ status: number; rows: Array<Record<string, unknown>> }> {
  const headers = new Headers();
  headers.set("apikey", env.anonKey);
  headers.set("Authorization", `Bearer ${callerToken}`);
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options?.prefer) headers.set("Prefer", options.prefer);
  const response = await fetchImpl(
    `${env.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`,
    {
      method: options?.method ?? "GET",
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  const text = await response.text();
  let rows: Array<Record<string, unknown>> = [];
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      rows = Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : [];
    } catch {
      rows = [];
    }
  }
  return { status: response.status, rows };
}
