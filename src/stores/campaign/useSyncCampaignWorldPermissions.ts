/**
 * World guide sync is intentionally a no-op on the Supabase backend.
 *
 * Campaign GMs of campaigns using a world manage it through the database
 * access rules (decision #12: private.is_world_gm), so no client write adds
 * or removes guides when campaigns link or unlink worlds. The previous
 * Firebase behaviour auto-added every co-op member as a guide, which would
 * now promote players to world owners (full GM access) and must not run.
 *
 * Guides remain extra world owners managed by hand through
 * stores.worlds.updateWorldGuide (backed by add/remove_world_guide); the
 * database refuses to remove the last owner.
 */
export function useSyncCampaignWorldPermissions() {}
