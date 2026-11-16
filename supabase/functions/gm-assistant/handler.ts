/**
 * GM assistant edge-function handler (spec #10, ticket #129).
 *
 * Pure web-standard request handler: no Deno or Node APIs, so the same file
 * runs in the Edge Runtime (wired up by `supabase/functions/main/index.ts`)
 * and in the repo's vitest suite with an injected upstream fetch. It proxies
 * to the operator-configured OpenAI-compatible endpoint:
 *
 * - `GET /gm-assistant/models?campaignId=<uuid>` lists the endpoint's models
 *   filtered by `GM_ASSISTANT_ALLOWED_MODELS`, each with an approximate
 *   context size.
 * - `GET /gm-assistant/context-size?campaignId=<uuid>` builds the GM's
 *   saved context server-side (the same code the chat path uses) and
 *   returns per-item sizes plus the references it had to skip, so the
 *   panel can show roughly how big each piece is without ever seeing text
 *   it may not read.
 *   `POST /gm-assistant/context-size` with `{ campaignId, context }` sizes a
 *   preview list of references the same way in one batch (ticket #149), so
 *   the Context tab can show a size beside every candidate before it is
 *   ticked; nothing is saved.
 * - `POST /gm-assistant/chat` takes `{ conversationId, message }`, saves the
 *   GM's message and the streamed reply to `assistant_messages`, and streams
 *   the reply back as server-sent events. An optional
 *   `mode: "outline-revision"` always includes the current outline and asks
 *   for a complete replacement between `<<<OUTLINE-BEGIN>>>` and
 *   `<<<OUTLINE-END>>>` markers, so the client can preview it side by side.
 *
 * Assistant context (ticket #132): the GM picks references (the outline,
 * world entries with an optional GM-only part, notes, channels with a post
 * count) saved per GM per campaign in `assistant_settings`. The server
 * builds the actual context text from those references at request time,
 * reading every row through PostgREST with the caller's JWT so the
 * row-level security rules stay the only gate: a reference the GM can no
 * longer read (a deleted entry, or a direct message they are not in) reads
 * as missing and is skipped, never leaked. A GM-only part is included only
 * when its toggle is on. Anything context-like the browser sends is
 * ignored: the request body carries only the conversation and the message.
 * Note text is stored as Yjs updates (the note server's format, base64
 * beside each note); the function decodes it to plain text, reusing that
 * format instead of a second copy of the text. Sizes are characters
 * converted to approximate tokens (four characters per token); exact
 * per-model tokenising is not needed, and the same function sizes both the
 * context-size answer and the chat text.
 *
 * Security: the caller's JWT is verified in code (the gateway's VERIFY_JWT
 * flag is off) and GM membership is checked before anything else. Every
 * database read and write goes through PostgREST with the caller's JWT, so
 * the row-level security rules stay the only gate; the service role is never
 * used. The API key never appears in a response or log. Errors carry only a
 * generic message plus a correlation ID.
 */

/** Deployment config, built from the environment by the runtime wiring. */
export interface GmAssistantEnv {
  /** Base URL of the OpenAI-compatible endpoint; blank means not set up. */
  endpoint: string;
  /** Server-side API key; never returned, logged or forwarded to browsers. */
  apiKey: string;
  /** Raw comma-separated allow-list; blank means every upstream model. */
  allowedModels: string;
  /** Raw default context size; blank or invalid means 8192. */
  contextTokens: string;
  /** HS256 secret the stack signs access tokens with. */
  jwtSecret: string;
  /** PostgREST base URL (inside the stack network, e.g. http://api-gw:8000). */
  supabaseUrl: string;
  /** Anon key, sent as the PostgREST `apikey` header beside the caller JWT. */
  anonKey: string;
  /** The site's own origin; the only origin CORS ever echoes. */
  siteUrl: string;
  /** Game system of this copy (`ironsworn` or `starforged`). */
  gameSystem: string;
}

export type UpstreamFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Handler options; `heartbeatMs` is a test seam, production uses the default. */
export interface GmAssistantHandlerOptions {
  /**
   * Milliseconds between SSE comment heartbeats (`: ping`) while a reply
   * streams. Heartbeats let the runtime notice a hung-up browser even when
   * the upstream sends nothing, and they defeat proxy idle timeouts on slow
   * models. Browsers and the repo's SSE parsers ignore comment lines.
   */
  heartbeatMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 3000;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DEFAULT_CONTEXT_TOKENS = 8192;

/** Largest preview body accepted: 100 references x 5 kinds is well under it. */
const MAX_PREVIEW_BODY_BYTES = 64 * 1024;

function mintReference(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32])
    .join("");
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface VerifiedCaller {
  sub: string;
}

async function verifyCaller(
  req: Request,
  env: GmAssistantEnv,
): Promise<VerifiedCaller | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let headerJson: { alg?: string };
  let payload: { role?: string; exp?: number; sub?: string };
  try {
    headerJson = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(headerB64)),
    );
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64)),
    );
  } catch {
    return null;
  }
  if (!headerJson || headerJson.alg !== "HS256") return null;
  if (!env.jwtSecret) return null;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecodeToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  if (!payload || payload.role !== "authenticated") return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return null;
  }
  if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) {
    return null;
  }
  return { sub: payload.sub };
}

function corsHeaders(req: Request, env: GmAssistantEnv): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  if (origin && env.siteUrl && origin === env.siteUrl) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function errorResponse(
  req: Request,
  env: GmAssistantEnv,
  status: number,
  code: string,
  message: string,
  ref: string,
  detailForLog?: string,
): Response {
  if (detailForLog) {
    console.error(`[gm-assistant] ${ref} ${code}: ${detailForLog}`);
  }
  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "application/json");
  return Response.json({ code, message, ref }, { status, headers });
}

function parseAllowedModels(raw: string): string[] | null {
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return ids.length > 0 ? ids : null;
}

function defaultContextTokens(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONTEXT_TOKENS;
}

function gameSystemLabel(gameSystem: string): string {
  const normalized = gameSystem.trim().toLowerCase();
  if (normalized === "ironsworn") return "Ironsworn";
  if (normalized === "starforged") return "Starforged";
  return gameSystem.trim() || "Ironsworn";
}

export function systemPrompt(gameSystem: string): string {
  const label = gameSystemLabel(gameSystem);
  return (
    `You are the GM assistant for an ${label} play-by-post campaign. ` +
    `You only draft: suggest scenes, dialogue and ideas the GM may use, ` +
    `change or discard. You never post, change or decide anything yourself; ` +
    `the GM decides what to use.`
  );
}

/**
 * Markers wrapping a complete replacement outline in an outline-revision
 * reply (ticket #133). The server asks the model to put the replacement
 * between these markers on their own lines with nothing else outside, so
 * the client can pull it out reliably; `extractOutlineProposal` does the
 * pulling on both sides of the wire (the browser client duplicates it,
 * like the token estimate).
 */
export const OUTLINE_PROPOSAL_BEGIN = "<<<OUTLINE-BEGIN>>>";
export const OUTLINE_PROPOSAL_END = "<<<OUTLINE-END>>>";

/**
 * Pulls the proposed outline from an assistant reply: the text between
 * the first begin marker and the last end marker, trimmed. Null when the
 * reply carries no complete proposal (a marker missing or nothing
 * between them).
 */
export function extractOutlineProposal(reply: string): string | null {
  const start = reply.indexOf(OUTLINE_PROPOSAL_BEGIN);
  const end = reply.lastIndexOf(OUTLINE_PROPOSAL_END);
  if (start < 0 || end < 0 || end <= start + OUTLINE_PROPOSAL_BEGIN.length) {
    return null;
  }
  const proposed = reply
    .slice(start + OUTLINE_PROPOSAL_BEGIN.length, end)
    .trim();
  return proposed.length > 0 ? proposed : null;
}

/** What the GM asked for: a normal chat turn or a dedicated outline revision. */
export type AssistantRequestMode = "chat" | "outline-revision";

export function outlineRevisionInstruction(): string {
  return (
    `The GM asked to revise the campaign outline. Return the complete ` +
    `replacement outline wrapped between ${OUTLINE_PROPOSAL_BEGIN} and ` +
    `${OUTLINE_PROPOSAL_END} on their own lines, with nothing else outside ` +
    `the markers.`
  );
}

/**
 * Approximate tokens for a character count (ticket #132): four characters
 * per token, rounded up. The client duplicates this exact formula (see
 * `assistantContext.ts`), so the size bar and the server answer agree;
 * exact per-model tokenising is not needed.
 */
export function approximateTokensForChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

const YJS_STRUCTURAL_TOKENS = new Set([
  "body",
  "default",
  "doc",
  "paragraph",
  "heading",
  "text",
  "title",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "mention",
]);

function readVarInt(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let pos = start;
  for (let i = 0; i < 5; i++) {
    if (pos >= bytes.length) return null;
    const byte = bytes[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) return { value, next: pos };
  }
  return null;
}

const PRINTABLE_RUN = /^[\p{L}\p{N}\p{P}\p{S} \t\n\r.,;:!?'"“”‘’—–()\-…]+$/u;

/**
 * Decodes note-server Yjs bytes (base64 of a Yjs update, the format the
 * note server persists beside each note) to plain text. Yjs stores strings
 * as variable-length-prefixed UTF-8 runs, so scanning for those runs
 * recovers plain-text inserts and TipTap text nodes alike in document
 * order, in both Deno and Node with no dependency. Structural type names
 * (`body`, `default`, `paragraph`, ...) are filtered out; pieces are joined
 * without a separator across whitespace and with a newline otherwise.
 * Anything undecodable reads as empty, never as an error.
 */
export function yjsBase64ToPlainText(content: string | null | undefined): string {
  if (!content) return "";
  let bytes: Uint8Array;
  try {
    const binary = atob(content);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return "";
  }
  const pieces: string[] = [];
  const decoder = new TextDecoder();
  let i = 0;
  while (i < bytes.length) {
    const length = readVarInt(bytes, i);
    if (!length || length.value < 2 || length.value > 4000 || length.next + length.value > bytes.length) {
      i++;
      continue;
    }
    const slice = bytes.subarray(length.next, length.next + length.value);
    let text = "";
    try {
      text = decoder.decode(slice);
    } catch {
      i++;
      continue;
    }
    if (!PRINTABLE_RUN.test(text) || YJS_STRUCTURAL_TOKENS.has(text)) {
      i++;
      continue;
    }
    // Runs of binary metadata can alias as short printable strings; a run
    // that is entirely enclosed by an already-kept piece adds nothing.
    if (pieces.some((kept) => kept.includes(text))) {
      i = length.next + length.value;
      continue;
    }
    pieces.push(text);
    i = length.next + length.value;
  }
  let out = "";
  for (const piece of pieces) {
    if (!out) {
      out = piece;
    } else if (/\s$/.test(out) || /^\s/.test(piece)) {
      out += piece;
    } else {
      out += `\n${piece}`;
    }
  }
  return out;
}

interface PostgrestOptions {
  method?: string;
  body?: unknown;
  prefer?: string;
}

async function postgrest(
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

export interface AssistantModel {
  id: string;
  contextTokens: number;
}

async function fetchUpstreamModels(
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
      detail: `models request failed: ${error instanceof Error ? error.message : "network error"}`,
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

async function isCampaignGm(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<boolean> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `campaign_members?campaign_id=eq.${encodeURIComponent(campaignId)}&user_id=eq.${encodeURIComponent(userId)}&select=role`,
    fetchImpl,
  );
  if (status !== 200) return false;
  return rows.some((row) => row.role === "gm");
}

interface ConversationLookup {
  id: string;
  campaignId: string;
}

async function lookupConversation(
  env: GmAssistantEnv,
  callerToken: string,
  conversationId: string,
  fetchImpl: UpstreamFetch,
): Promise<ConversationLookup | null> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,campaign_id`,
    fetchImpl,
  );
  if (status !== 200 || rows.length === 0) return null;
  const row = rows[0] as { id?: unknown; campaign_id?: unknown };
  if (typeof row.id !== "string" || typeof row.campaign_id !== "string") {
    return null;
  }
  return { id: row.id, campaignId: row.campaign_id };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Host (and port) of the configured endpoint, for telling GMs where their
 * material goes. Never userinfo, path, query or key; null when unset or
 * unparseable.
 */
function endpointHostOf(endpoint: string): string | null {
  if (!endpoint.trim()) return null;
  try {
    return new URL(endpoint.trim()).host || null;
  } catch {
    return null;
  }
}

async function readHistory(
  env: GmAssistantEnv,
  callerToken: string,
  conversationId: string,
  fetchImpl: UpstreamFetch,
): Promise<ChatMessage[] | null> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&select=role,content&order=created_at.desc,id.desc&limit=100`,
    fetchImpl,
  );
  if (status !== 200) return null;
  const history: ChatMessage[] = [];
  // Newest 100 come back newest first; the model wants oldest first.
  for (const row of [...rows].reverse()) {
    if (
      (row.role === "user" || row.role === "assistant") &&
      typeof row.content === "string"
    ) {
      history.push({ role: row.role, content: row.content });
    }
  }
  return history;
}

async function readSavedModel(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<string | null> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_settings?campaign_id=eq.${encodeURIComponent(campaignId)}&gm_id=eq.${encodeURIComponent(userId)}&select=model`,
    fetchImpl,
  );
  if (status !== 200 || rows.length === 0) return null;
  const model = (rows[0] as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

export interface AssistantItemReference {
  id: string;
  includeGmParts: boolean;
}

export interface AssistantChannelReference {
  id: string;
  postCount: number;
}

export interface AssistantContextChoice {
  includeOutline: boolean;
  lore: AssistantItemReference[];
  npcs: AssistantItemReference[];
  locations: AssistantItemReference[];
  notes: string[];
  channels: AssistantChannelReference[];
}

export interface AssistantContextItem {
  key: string;
  label: string;
  chars: number;
  tokens: number;
}

export interface AssistantUnavailableReference {
  key: string;
  reason: string;
}

export interface BuiltAssistantContext {
  /** Sections in checklist order, joined with blank lines for the model. */
  text: string;
  items: AssistantContextItem[];
  totalChars: number;
  totalTokens: number;
  unavailable: AssistantUnavailableReference[];
}

function normalizeItemReference(entry: unknown): AssistantItemReference | null {
  if (!entry || typeof entry !== "object") return null;
  const { id, includeGmParts } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  return { id, includeGmParts: includeGmParts === true };
}

function normalizeChannelReference(entry: unknown): AssistantChannelReference | null {
  if (!entry || typeof entry !== "object") return null;
  const { id, postCount } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  const count = typeof postCount === "number" && Number.isFinite(postCount)
    ? Math.trunc(postCount)
    : 5;
  return { id, postCount: Math.min(50, Math.max(1, count)) };
}

function normalizeContextChoice(raw: unknown): AssistantContextChoice {
  const empty: AssistantContextChoice = {
    includeOutline: false,
    lore: [],
    npcs: [],
    locations: [],
    notes: [],
    channels: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const record = raw as Record<string, unknown>;
  const listOf = (value: unknown, normalize: (entry: unknown) => { id: string } | null) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: Array<{ id: string }> = [];
    for (const entry of value.slice(0, 100)) {
      const normalized = normalize(entry);
      if (normalized && !seen.has(normalized.id)) {
        seen.add(normalized.id);
        out.push(normalized as { id: string });
      }
    }
    return out;
  };
  return {
    includeOutline: record.includeOutline === true,
    lore: listOf(record.lore, normalizeItemReference) as AssistantItemReference[],
    npcs: listOf(record.npcs, normalizeItemReference) as AssistantItemReference[],
    locations: listOf(record.locations, normalizeItemReference) as AssistantItemReference[],
    notes: (Array.isArray(record.notes) ? record.notes : [])
      .filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 100),
    channels: listOf(record.channels, normalizeChannelReference) as AssistantChannelReference[],
  };
}

async function readSavedContext(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  fetchImpl: UpstreamFetch,
): Promise<AssistantContextChoice> {
  const { status, rows } = await postgrest(
    env,
    callerToken,
    `assistant_settings?campaign_id=eq.${encodeURIComponent(campaignId)}&gm_id=eq.${encodeURIComponent(userId)}&select=context`,
    fetchImpl,
  );
  if (status !== 200 || rows.length === 0) {
    return normalizeContextChoice(null);
  }
  return normalizeContextChoice((rows[0] as { context?: unknown }).context);
}

function pushSection(
  sections: Array<{ key: string; label: string; text: string }>,
  key: string,
  label: string,
  lines: Array<string | null | undefined>,
): void {
  const text = lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0).join("\n").trim();
  if (!text) return;
  sections.push({ key, label, text: `${label}\n${text}` });
}

function gmDetailLines(details: Record<string, unknown>, fields: Array<{ column: string; label: string }>): string[] {
  const lines: string[] = [];
  for (const { column, label } of fields) {
    const value = details[column];
    if (typeof value === "string" && value.trim()) {
      lines.push(`${label}: ${value.trim()}`);
    } else if (value && typeof value === "object" && Object.keys(value).length > 0) {
      lines.push(`${label}: ${JSON.stringify(value)}`);
    }
  }
  return lines;
}

/**
 * Builds the assistant context text from the GM's saved references, every
 * read through PostgREST with the caller's JWT so the access rules decide.
 * A reference that reads back nothing (deleted, or a direct message the
 * caller is not in) is skipped and reported in `unavailable`, never
 * leaked; a GM-only part is read only when its toggle is on. World entries
 * must belong to the campaign's own world (a campaign with no world has
 * none, so world references are ignored) and channels to the campaign,
 * otherwise they read as unavailable too.
 */
async function buildAssistantContext(
  env: GmAssistantEnv,
  callerToken: string,
  userId: string,
  campaignId: string,
  choice: AssistantContextChoice,
  fetchImpl: UpstreamFetch,
): Promise<BuiltAssistantContext> {
  void userId;
  const sections: Array<{ key: string; label: string; text: string }> = [];
  const unavailable: AssistantUnavailableReference[] = [];

  const readRows = async (path: string): Promise<Array<Record<string, unknown>>> => {
    const { status, rows } = await postgrest(env, callerToken, path, fetchImpl);
    return status === 200 ? rows : [];
  };

  const readNoteText = async (contentsTable: string, noteId: string): Promise<string> => {
    const rows = await readRows(
      `${contentsTable}?note_id=eq.${encodeURIComponent(noteId)}&select=content`,
    );
    const content = (rows[0] as { content?: unknown } | undefined)?.content;
    return yjsBase64ToPlainText(typeof content === "string" ? content : null);
  };

  const campaignRows = await readRows(
    `campaigns?id=eq.${encodeURIComponent(campaignId)}&select=world_id`,
  );
  const worldId = (campaignRows[0] as { world_id?: unknown } | undefined)?.world_id;
  const campaignWorldId = typeof worldId === "string" && UUID_PATTERN.test(worldId) ? worldId : null;

  /**
   * The one place a world item is looked up, so chat and `/context-size`
   * (both built here) cannot drift. A campaign with no world has no world
   * items: nothing is queried. Otherwise the read is filtered to the
   * campaign's own world and the row is checked again.
   */
  const readWorldItem = async (
    table: "world_lore" | "world_npcs" | "world_locations",
    id: string,
    columns: string,
  ): Promise<Record<string, unknown> | null> => {
    if (!campaignWorldId) return null;
    const rows = await readRows(
      `${table}?id=eq.${encodeURIComponent(id)}&world_id=eq.${encodeURIComponent(campaignWorldId)}&select=id,${columns},world_id`,
    );
    const row = rows[0];
    if (!row || typeof row.id !== "string" || row.world_id !== campaignWorldId) return null;
    return row;
  };

  if (choice.includeOutline) {
    const outlineRows = await readRows(
      `campaign_notes?campaign_id=eq.${encodeURIComponent(campaignId)}&kind=eq.outline&select=id,title`,
    );
    const outline = outlineRows[0] as { id?: unknown; title?: unknown } | undefined;
    if (outline && typeof outline.id === "string") {
      const text = await readNoteText("campaign_note_contents", outline.id);
      pushSection(sections, "outline", "Campaign outline", [text || null]);
      if (sections.at(-1)?.key !== "outline") {
        unavailable.push({ key: "outline", reason: "empty" });
      }
    } else {
      unavailable.push({ key: "outline", reason: "not found" });
    }
  }

  const readWorldItemNotes = async (
    kind: "lore" | "npc" | "location",
    itemId: string,
    includeGmParts: boolean,
  ): Promise<{ publicText: string; gmText: string }> => {
    const column = kind === "lore" ? "lore_id" : kind === "npc" ? "npc_id" : "location_id";
    const noteRows = await readRows(
      `world_notes?${column}=eq.${encodeURIComponent(itemId)}&select=id,gm_only`,
    );
    let publicText = "";
    let gmText = "";
    for (const note of noteRows) {
      if (typeof note.id !== "string") continue;
      const text = await readNoteText("world_note_contents", note.id);
      if (!text) continue;
      if (note.gm_only === true) {
        if (includeGmParts) gmText += (gmText ? "\n" : "") + text;
      } else {
        publicText += (publicText ? "\n" : "") + text;
      }
    }
    return { publicText, gmText };
  };

  const idsOf = (rows: Array<Record<string, unknown>>, column: string): string[] => [
    ...new Set(
      rows
        .map((row) => row[column])
        .filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)),
    ),
  ];
  const namesById = async (
    table: string,
    nameColumn: string,
    ids: string[],
  ): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const rows = await readRows(
      `${table}?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,${nameColumn}`,
    );
    for (const row of rows) {
      const name = row[nameColumn];
      if (typeof row.id === "string" && typeof name === "string" && name.trim()) {
        map.set(row.id, name.trim());
      }
    }
    return map;
  };
  let roster: { gmIds: Set<string>; playerNumber: Map<string, number> } | null = null;
  /**
   * Who spoke each recent post: the NPC or character voice. Otherwise a
   * neutral label for the member: "GM", or "Player N" numbered by the
   * campaign's stable member order. Account display names may be real
   * names, so they are never sent to the model endpoint. A GM speaking as
   * an NPC or character carries a "(GM)" suffix, judged by the current GM
   * roster. A member who cannot be found reads as "Someone".
   */
  const readSpeakerNames = async (posts: Array<Record<string, unknown>>) => {
    if (roster === null) {
      const members = await readRows(
        `campaign_members?campaign_id=eq.${encodeURIComponent(campaignId)}&select=user_id,role&order=created_at.asc,user_id.asc`,
      );
      const gmIds = new Set<string>();
      const playerNumber = new Map<string, number>();
      for (const member of members) {
        if (typeof member.user_id !== "string") continue;
        if (member.role === "gm") gmIds.add(member.user_id);
        else if (!playerNumber.has(member.user_id)) playerNumber.set(member.user_id, playerNumber.size + 1);
      }
      roster = { gmIds, playerNumber };
    }
    const [characters, npcs] = await Promise.all([
      namesById("characters", "name", idsOf(posts, "speaker_character_id")),
      namesById("world_npcs", "name", idsOf(posts, "speaker_npc_id")),
    ]);
    const { gmIds, playerNumber } = roster;
    return {
      speakerOf: (post: Record<string, unknown>): string => {
        const author = typeof post.author_id === "string" ? post.author_id : "";
        const isGm = gmIds.has(author);
        const voice =
          (typeof post.speaker_npc_id === "string" ? npcs.get(post.speaker_npc_id) : undefined) ??
          (typeof post.speaker_character_id === "string"
            ? characters.get(post.speaker_character_id)
            : undefined);
        if (voice) return isGm ? `${voice} (GM)` : voice;
        if (isGm) return "GM";
        const number = playerNumber.get(author);
        return number ? `Player ${number}` : "Someone";
      },
    };
  };

  for (const ref of choice.lore) {
    const row = (await readWorldItem("world_lore", ref.id, "name,tags")) as { name?: unknown; tags?: unknown } | null;
    if (!row) {
      unavailable.push({ key: `lore:${ref.id}`, reason: "not found" });
      continue;
    }
    const { publicText, gmText } = await readWorldItemNotes("lore", ref.id, ref.includeGmParts);
    const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [];
    pushSection(sections, `lore:${ref.id}`, `Lore: ${typeof row.name === "string" ? row.name : "Untitled"}`, [
      tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
      publicText || null,
      gmText ? `GM-only:\n${gmText}` : null,
    ]);
    if (sections.at(-1)?.key !== `lore:${ref.id}`) {
      unavailable.push({ key: `lore:${ref.id}`, reason: "empty" });
    }
  }

  for (const ref of choice.npcs) {
    const row = (await readWorldItem("world_npcs", ref.id, "name")) as { name?: unknown } | null;
    if (!row) {
      unavailable.push({ key: `npc:${ref.id}`, reason: "not found" });
      continue;
    }
    const details = ref.includeGmParts
      ? ((await readRows(`world_npc_gm_details?npc_id=eq.${encodeURIComponent(ref.id)}&select=goal,role,descriptor,disposition,activity,first_look,revealed_aspect`))[0] as Record<string, unknown> | undefined)
      : undefined;
    const { publicText, gmText } = await readWorldItemNotes("npc", ref.id, ref.includeGmParts);
    pushSection(sections, `npc:${ref.id}`, `NPC: ${typeof row.name === "string" ? row.name : "Untitled"}`, [
      ...(details
        ? gmDetailLines(details, [
            { column: "role", label: "Role" },
            { column: "descriptor", label: "Descriptor" },
            { column: "goal", label: "Goal" },
            { column: "disposition", label: "Disposition" },
            { column: "activity", label: "Activity" },
            { column: "first_look", label: "First look" },
            { column: "revealed_aspect", label: "Revealed aspect" },
          ])
        : []),
      publicText || null,
      gmText ? `GM-only notes:\n${gmText}` : null,
    ]);
    if (sections.at(-1)?.key !== `npc:${ref.id}`) {
      unavailable.push({ key: `npc:${ref.id}`, reason: "empty" });
    }
  }

  for (const ref of choice.locations) {
    const row = (await readWorldItem("world_locations", ref.id, "name")) as { name?: unknown } | null;
    if (!row) {
      unavailable.push({ key: `location:${ref.id}`, reason: "not found" });
      continue;
    }
    const details = ref.includeGmParts
      ? ((await readRows(`world_location_gm_details?location_id=eq.${encodeURIComponent(ref.id)}&select=fields,descriptor,trouble,location_features`))[0] as Record<string, unknown> | undefined)
      : undefined;
    const { publicText, gmText } = await readWorldItemNotes("location", ref.id, ref.includeGmParts);
    pushSection(sections, `location:${ref.id}`, `Location: ${typeof row.name === "string" ? row.name : "Untitled"}`, [
      ...(details
        ? gmDetailLines(details, [
            { column: "descriptor", label: "Descriptor" },
            { column: "trouble", label: "Trouble" },
            { column: "location_features", label: "Features" },
            { column: "fields", label: "Details" },
          ])
        : []),
      publicText || null,
      gmText ? `GM-only notes:\n${gmText}` : null,
    ]);
    if (sections.at(-1)?.key !== `location:${ref.id}`) {
      unavailable.push({ key: `location:${ref.id}`, reason: "empty" });
    }
  }

  for (const noteId of choice.notes) {
    const rows = await readRows(
      `campaign_notes?id=eq.${encodeURIComponent(noteId)}&campaign_id=eq.${encodeURIComponent(campaignId)}&select=id,title`,
    );
    const row = rows[0] as { id?: unknown; title?: unknown } | undefined;
    if (!row || typeof row.id !== "string") {
      unavailable.push({ key: `note:${noteId}`, reason: "not found" });
      continue;
    }
    const text = await readNoteText("campaign_note_contents", noteId);
    pushSection(sections, `note:${noteId}`, `Note: ${typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Untitled"}`, [
      text || null,
    ]);
    if (sections.at(-1)?.key !== `note:${noteId}`) {
      unavailable.push({ key: `note:${noteId}`, reason: "empty" });
    }
  }

  for (const ref of choice.channels) {
    const rows = await readRows(
      `chat_channels?id=eq.${encodeURIComponent(ref.id)}&select=id,name,campaign_id`,
    );
    const row = rows[0] as { id?: unknown; name?: unknown; campaign_id?: unknown } | undefined;
    if (!row || typeof row.id !== "string" || row.campaign_id !== campaignId) {
      unavailable.push({ key: `channel:${ref.id}`, reason: "not found" });
      continue;
    }
    const posts = await readRows(
      `chat_posts?channel_id=eq.${encodeURIComponent(ref.id)}&select=text,created_at,author_id,speaker_character_id,speaker_npc_id&order=created_at.desc&limit=${ref.postCount}`,
    );
    const readable = posts.filter(
      (post) => typeof post.text === "string" && (post.text as string).trim().length > 0,
    );
    const names = await readSpeakerNames(readable);
    const lines = readable
      .map((post) => `${names.speakerOf(post)}: ${(post.text as string).trim()}`)
      .reverse();
    if (lines.length === 0) {
      unavailable.push({ key: `channel:${ref.id}`, reason: "empty" });
      continue;
    }
    pushSection(
      sections,
      `channel:${ref.id}`,
      `Channel: ${typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled"} (last ${lines.length})`,
      lines,
    );
  }

  const items: AssistantContextItem[] = sections.map((section) => ({
    key: section.key,
    label: section.label.split("\n")[0],
    chars: section.text.length,
    tokens: approximateTokensForChars(section.text.length),
  }));
  const totalChars = items.reduce((sum, item) => sum + item.chars, 0);
  return {
    text: sections.map((section) => section.text).join("\n\n"),
    items,
    totalChars,
    totalTokens: approximateTokensForChars(totalChars),
    unavailable,
  };
}

async function saveMessage(
  env: GmAssistantEnv,
  callerToken: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  stoppedPartway: boolean,
  fetchImpl: UpstreamFetch,
): Promise<boolean> {
  const { status } = await postgrest(
    env,
    callerToken,
    "assistant_messages?select=id",
    fetchImpl,
    {
      method: "POST",
      prefer: "return=representation",
      body: {
        conversation_id: conversationId,
        role,
        content,
        stopped_partway: stoppedPartway,
      },
    },
  );
  return status === 200 || status === 201;
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ content })}\n\n`;
}

async function handleModels(
  req: Request,
  env: GmAssistantEnv,
  caller: VerifiedCaller,
  callerToken: string,
  fetchImpl: UpstreamFetch,
): Promise<Response> {
  const campaignId = new URL(req.url).searchParams.get("campaignId") ?? "";
  if (!UUID_PATTERN.test(campaignId)) {
    return errorResponse(
      req,
      env,
      400,
      "INVALID_REQUEST",
      "That request was not valid.",
      mintReference(),
    );
  }
  let gm = false;
  try {
    gm = await isCampaignGm(env, callerToken, caller.sub, campaignId, fetchImpl);
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `gm check failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
  if (!gm) {
    return errorResponse(
      req,
      env,
      403,
      "FORBIDDEN",
      "Only the campaign's GMs can use the assistant.",
      mintReference(),
    );
  }
  if (!env.endpoint.trim()) {
    return errorResponse(
      req,
      env,
      503,
      "NOT_SET_UP",
      "The GM assistant is not set up on this server.",
      mintReference(),
    );
  }
  const result = await fetchUpstreamModels(env, fetchImpl);
  if (!result.ok) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, result.detail);
  }
  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "application/json");
  return Response.json(
    {
      endpointHost: endpointHostOf(env.endpoint),
      models: result.models.map((model) => ({
        id: model.id,
        context_tokens: model.contextTokens,
      })),
    },
    { headers },
  );
}

async function handleContextSize(
  req: Request,
  env: GmAssistantEnv,
  caller: VerifiedCaller,
  callerToken: string,
  fetchImpl: UpstreamFetch,
): Promise<Response> {
  // POST sizes a preview list of references in one batch (the Context tab's
  // candidates); GET sizes the GM's saved context.
  let campaignId = new URL(req.url).searchParams.get("campaignId") ?? "";
  let preview: AssistantContextChoice | null = null;
  if (req.method === "POST") {
    const tooLarge = () =>
      errorResponse(req, env, 413, "PAYLOAD_TOO_LARGE", "That request was too large.", mintReference());
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PREVIEW_BODY_BYTES) return tooLarge();
    let body: unknown;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_PREVIEW_BODY_BYTES) return tooLarge();
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    campaignId = typeof record?.campaignId === "string" ? record.campaignId : "";
    preview = record ? normalizeContextChoice(record.context) : null;
  }
  if (!UUID_PATTERN.test(campaignId) || (req.method === "POST" && !preview)) {
    return errorResponse(
      req,
      env,
      400,
      "INVALID_REQUEST",
      "That request was not valid.",
      mintReference(),
    );
  }
  let gm = false;
  try {
    gm = await isCampaignGm(env, callerToken, caller.sub, campaignId, fetchImpl);
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `gm check failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
  if (!gm) {
    return errorResponse(
      req,
      env,
      403,
      "FORBIDDEN",
      "Only the campaign's GMs can use the assistant.",
      mintReference(),
    );
  }
  // The same code the chat path uses, so the sizes always match the text
  // the model would receive. Every reference it cannot read is skipped and
  // reported, never leaked.
  try {
    const choice =
      preview ?? (await readSavedContext(env, callerToken, caller.sub, campaignId, fetchImpl));
    const built = await buildAssistantContext(env, callerToken, caller.sub, campaignId, choice, fetchImpl);
    const instructionChars = systemPrompt(env.gameSystem).length;
    const headers = corsHeaders(req, env);
    headers.set("Content-Type", "application/json");
    return Response.json(
      {
        items: built.items,
        totalChars: built.totalChars,
        totalTokens: built.totalTokens,
        instructionChars,
        instructionTokens: approximateTokensForChars(instructionChars),
        unavailable: built.unavailable,
      },
      { headers },
    );
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `context build failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

interface ChatRequestBody {
  conversationId: string;
  message: string;
  mode: AssistantRequestMode;
}

function parseChatBody(body: unknown): ChatRequestBody | null {
  if (!body || typeof body !== "object") return null;
  const { conversationId, message, mode } = body as Record<string, unknown>;
  if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) {
    return null;
  }
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 20000) return null;
  if (mode !== undefined && mode !== "chat" && mode !== "outline-revision") {
    return null;
  }
  return {
    conversationId,
    message: trimmed,
    mode: mode === "outline-revision" ? "outline-revision" : "chat",
  };
}

async function handleChat(
  req: Request,
  env: GmAssistantEnv,
  caller: VerifiedCaller,
  callerToken: string,
  fetchImpl: UpstreamFetch,
  options?: GmAssistantHandlerOptions,
): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await req.text());
  } catch {
    parsed = null;
  }
  const chat = parseChatBody(parsed);
  if (!chat) {
    return errorResponse(
      req,
      env,
      400,
      "INVALID_REQUEST",
      "That request was not valid.",
      mintReference(),
    );
  }
  // The conversation lookup runs with the caller's JWT, so anyone who is
  // not the owning GM of its campaign sees nothing and gets the same
  // answer as for a conversation that does not exist. Only after that
  // ownership check does the not-set-up answer come back.
  const conversation = await lookupConversation(
    env,
    callerToken,
    chat.conversationId,
    fetchImpl,
  );
  if (!conversation) {
    return errorResponse(
      req,
      env,
      404,
      "CONVERSATION_NOT_FOUND",
      "That conversation was not found.",
      mintReference(),
    );
  }
  if (!env.endpoint.trim()) {
    return errorResponse(
      req,
      env,
      503,
      "NOT_SET_UP",
      "The GM assistant is not set up on this server.",
      mintReference(),
    );
  }
  const history = await readHistory(env, callerToken, conversation.id, fetchImpl);
  if (!history) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "history read failed");
  }
  const savedModel = await readSavedModel(
    env,
    callerToken,
    caller.sub,
    conversation.campaignId,
    fetchImpl,
  );
  const modelsResult = await fetchUpstreamModels(env, fetchImpl);
  if (!modelsResult.ok) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, modelsResult.detail);
  }
  const available = modelsResult.models;
  const chosen =
    (savedModel && available.some((model) => model.id === savedModel)
      ? savedModel
      : null) ?? available[0]?.id;
  if (!chosen) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "no usable model");
  }
  const userSaved = await saveMessage(
    env,
    callerToken,
    conversation.id,
    "user",
    chat.message,
    false,
    fetchImpl,
  );
  if (!userSaved) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "user message save failed");
  }

  // The context is built here, on the server, from the GM's saved
  // references at request time. The request body carries no context text:
  // parseChatBody drops every other field, so anything context-like the
  // browser sends never reaches the model. An outline revision always
  // includes the current outline, whatever the saved choice says: the
  // server reads it and asks for a complete marked replacement.
  let built: BuiltAssistantContext;
  try {
    const choice = await readSavedContext(env, callerToken, caller.sub, conversation.campaignId, fetchImpl);
    if (chat.mode === "outline-revision") {
      choice.includeOutline = true;
    }
    built = await buildAssistantContext(env, callerToken, caller.sub, conversation.campaignId, choice, fetchImpl);
  } catch (error) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `context build failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  const outgoing = [
    { role: "system", content: systemPrompt(env.gameSystem) },
    ...(built.text
      ? [{ role: "system", content: `Campaign context chosen by the GM:\n\n${built.text}` }]
      : []),
    ...(chat.mode === "outline-revision"
      ? [{ role: "system", content: outlineRevisionInstruction() }]
      : []),
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: chat.message },
  ];

  const upstreamAbort = new AbortController();
  const onClientAbort = (): void => upstreamAbort.abort();
  if (req.signal.aborted) {
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, "client gone before upstream start");
  }
  req.signal.addEventListener("abort", onClientAbort, { once: true });

  let upstream: Response;
  try {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (env.apiKey.trim()) {
      headers.set("Authorization", `Bearer ${env.apiKey}`);
    }
    upstream = await fetchImpl(
      `${env.endpoint.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ model: chosen, messages: outgoing, stream: true }),
        signal: upstreamAbort.signal,
      },
    );
  } catch (error) {
    req.signal.removeEventListener("abort", onClientAbort);
    // The client is gone or the network failed: keep the partial reply (if
    // any text arrived it is saved by the stream finalizer; here nothing
    // arrived yet) and report the generic failure.
    const ref = mintReference();
    return errorResponse(
      req,
      env,
      502,
      "UPSTREAM_ERROR",
      "The assistant request failed.",
      ref,
      `upstream chat failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }
  if (!upstream.ok || !upstream.body) {
    req.signal.removeEventListener("abort", onClientAbort);
    upstreamAbort.abort();
    const ref = mintReference();
    return errorResponse(req, env, 502, "UPSTREAM_ERROR", "The assistant request failed.", ref, `upstream chat status ${upstream.status}`);
  }

  const headers = corsHeaders(req, env);
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");

  let settled = false;
  const finish = (reply: string, stopped: boolean): Promise<void> => {
    if (settled) return Promise.resolve();
    settled = true;
    req.signal.removeEventListener("abort", onClientAbort);
    // An empty reply carries nothing to keep (and the table requires
    // non-blank content), so only non-empty replies are stored.
    if (!reply) return Promise.resolve();
    return saveMessage(
      env,
      callerToken,
      conversation.id,
      "assistant",
      reply,
      stopped,
      fetchImpl,
    ).then(
      (saved) => {
        if (!saved) {
          console.error(`[gm-assistant] reply save failed for ${conversation.id}`);
        }
      },
      () => undefined,
    );
  };

  const rawHeartbeat = options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeatMs =
    Number.isFinite(rawHeartbeat) && rawHeartbeat > 0
      ? rawHeartbeat
      : DEFAULT_HEARTBEAT_MS;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };
  // Assigned when the stream starts; lets `cancel()` unblock a parked
  // `reader.read()` even where aborting the upstream fetch is not enough.
  let cancelReader: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const reader = upstream.body!.getReader();
      cancelReader = (): void => {
        reader.cancel().catch(() => undefined);
      };
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let clientGone = false;
      // The runtime only learns that the browser hung up when the function
      // next writes, so a stalled upstream would leave this stream parked in
      // `reader.read()` forever. Heartbeat comments force a write every few
      // seconds: after a hang-up the write fails (or the runtime cancels the
      // stream), `cancel()` aborts the upstream, and the partial reply is
      // saved as stopped.
      const onAbort = (): void => {
        clientGone = true;
        upstreamAbort.abort();
        stopHeartbeat();
        cancelReader?.();
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
      heartbeat = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          onAbort();
        }
      }, heartbeatMs);
      // Test runners (Node) hold the process for active intervals; the
      // Edge Runtime has no `unref`, so this is a no-op there.
      (heartbeat as unknown as { unref?: () => void }).unref?.();
      const enqueue = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          clientGone = true;
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsedLine = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: unknown } }>;
              };
              const content = parsedLine.choices?.[0]?.delta?.content;
              if (typeof content === "string" && content) {
                reply += content;
                if (!clientGone) enqueue(sseChunk(content));
              }
            } catch {
              continue;
            }
          }
          if (clientGone) break;
        }
        buffer += decoder.decode();
      } catch {
        clientGone = true;
      } finally {
        stopHeartbeat();
        cancelReader = undefined;
        req.signal.removeEventListener("abort", onAbort);
        try {
          if (!clientGone) enqueue("data: [DONE]\n\n");
          controller.close();
        } catch {
          clientGone = true;
        }
        await finish(reply, clientGone || req.signal.aborted);
      }
    },
    cancel() {
      // Fires when the runtime drops the response stream (browser hang-up
      // noticed on a heartbeat write). Abort the upstream so the fake (and
      // the live test) observes the hang-up and the partial reply is kept.
      stopHeartbeat();
      upstreamAbort.abort();
      cancelReader?.();
    },
  });

  return new Response(stream, { headers });
}

/**
 * Builds the GM assistant request handler. `fetchImpl` performs both the
 * PostgREST calls (with the caller's JWT) and the upstream model calls
 * (with the server-side key); tests inject a fake, the runtime passes fetch.
 */
export function createGmAssistantHandler(
  env: GmAssistantEnv,
  fetchImpl: UpstreamFetch = fetch,
  options?: GmAssistantHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      if (url.pathname === "/gm-assistant/models" || url.pathname === "/gm-assistant/chat" || url.pathname === "/gm-assistant/context-size") {
        const headers = corsHeaders(req, env);
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        headers.set("Access-Control-Max-Age", "86400");
        return new Response(null, { status: 204, headers });
      }
      return new Response(null, { status: 404 });
    }
    const callerToken = (() => {
      const header = req.headers.get("authorization");
      const match = header ? /^Bearer (.+)$/.exec(header.trim()) : null;
      return match ? match[1] : null;
    })();
    const caller = await verifyCaller(req, env);
    if (!caller || !callerToken) {
      return errorResponse(
        req,
        env,
        401,
        "UNAUTHORIZED",
        "Sign in again and retry.",
        mintReference(),
      );
    }
    if (req.method === "GET" && url.pathname === "/gm-assistant/models") {
      return handleModels(req, env, caller, callerToken, fetchImpl);
    }
    if (
      (req.method === "GET" || req.method === "POST") &&
      url.pathname === "/gm-assistant/context-size"
    ) {
      return handleContextSize(req, env, caller, callerToken, fetchImpl);
    }
    if (req.method === "POST" && url.pathname === "/gm-assistant/chat") {
      return handleChat(req, env, caller, callerToken, fetchImpl, options);
    }
    const headers = corsHeaders(req, env);
    headers.set("Content-Type", "application/json");
    return Response.json(
      {
        code: "FUNCTIONS_NOT_CONFIGURED",
        message: "No server functions are deployed yet",
      },
      { status: 404, headers },
    );
  };
}
