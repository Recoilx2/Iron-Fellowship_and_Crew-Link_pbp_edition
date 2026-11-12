import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Test harness for the Docker-based behavior tests (`*.live.test.ts`).
 *
 * The harness talks to one copy of the local stack started from the Compose
 * template (`supabase/docker-compose.yml`), and signs in as different people
 * through it: an owner, GMs, players and outsiders. People are created with
 * the service key through the Auth Admin API with confirmed emails, so no
 * mail server is involved; each person gets their own client, so sessions
 * never clash.
 *
 * Live tests read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
 * `SUPABASE_SERVICE_ROLE_KEY` from the environment (in CI these come from
 * the generated per-copy env file) and skip when they are missing, so the
 * plain `npm test` run stays green without Docker.
 */

export interface LiveStackConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function liveStackConfig(): LiveStackConfig | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

export function adminClient(config: LiveStackConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function personClient(config: LiveStackConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
}

export interface LivePerson {
  tag: string;
  email: string;
  password: string;
  userId: string;
  client: SupabaseClient;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createPerson(
  config: LiveStackConfig,
  tag: string
): Promise<LivePerson> {
  const email = `${tag}-${Date.now()}-${randomToken().slice(0, 8)}@example.com`;
  const password = `pw-${randomToken()}`;
  const { data, error } = await adminClient(config).auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: tag },
  });
  if (error || !data.user) {
    throw new Error(`could not create ${tag}: ${error?.message}`);
  }
  const client = personClient(config);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    throw new Error(`could not sign in ${tag}: ${signInError.message}`);
  }
  return { tag, email, password, userId: data.user.id, client };
}

export async function deletePerson(
  config: LiveStackConfig,
  userId: string
): Promise<void> {
  const { error } = await adminClient(config).auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`could not delete test person: ${error.message}`);
  }
}

export function randomCampaignId(): string {
  return crypto.randomUUID();
}

export type MembershipRole = "gm" | "player";

export async function grantMembership(
  config: LiveStackConfig,
  campaignId: string,
  userId: string,
  role: MembershipRole
): Promise<void> {
  const { error } = await adminClient(config)
    .from("campaign_members")
    .insert({ campaign_id: campaignId, user_id: userId, role });
  if (error) {
    throw new Error(`could not grant ${role}: ${error.message}`);
  }
}

/**
 * Polls until `observe` returns a non-null value or the timeout elapses.
 * Live updates arrive within hundreds of milliseconds, but CI runners are
 * slow, so callers pass generous timeouts.
 */
export async function waitFor<T>(
  observe: () => T | null,
  timeoutMs = 30000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  for (;;) {
    last = observe();
    if (last !== null) return last;
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for the expected live state");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
