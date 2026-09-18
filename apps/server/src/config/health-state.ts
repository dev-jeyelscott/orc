/**
 * Tracks whether the last known-good canonical file write successfully
 * projected into PostgreSQL. Roadmap invariant #4 (section 7): a DB
 * projection failure after a successful file write must mark configuration
 * out-of-sync and block new Runs rather than rolling the canonical file back
 * to match stale DB state. This is process-local operational state, not
 * operator-managed configuration, so it intentionally does not live in
 * `.orc/`.
 */

export interface ConfigOutOfSyncState {
  reason: string;
  resourceType: string;
  resourceId: string;
  occurredAt: string;
}

let outOfSync: ConfigOutOfSyncState | null = null;

/** Marks configuration projection as out-of-sync after a file write whose DB sync failed. */
export function markConfigOutOfSync(state: Omit<ConfigOutOfSyncState, "occurredAt">): void {
  outOfSync = { ...state, occurredAt: new Date().toISOString() };
}

/** Clears out-of-sync state once an explicit sync reconciles the projection. */
export function clearConfigOutOfSync(): void {
  outOfSync = null;
}

export function getConfigOutOfSyncState(): ConfigOutOfSyncState | null {
  return outOfSync;
}
