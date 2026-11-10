import type { Partition } from './outbox';
import type { OfflineFeature, OfflineAction } from './access';
/** Empty snapshots are valid; a missing snapshot or supporting context is not. */
export function offlineRecordsReady(
  state: Partition,
  permissions: Partial<Record<OfflineFeature, readonly OfflineAction[]>>,
  features: readonly OfflineFeature[]
): boolean {
  return (
    Object.hasOwn(state, 'tripColors') &&
    !!state.shipyardFolders &&
    Array.isArray(state.crewRoster) &&
    typeof state.restSignature === 'boolean' &&
    !!state.seaMileContext &&
    !!state.documentContext &&
    !!state.fuelContext &&
    features.every((f) => !permissions[f]?.includes('read') || state.snapshots?.[f] === true)
  );
}
export function isOfflineStorageFailure(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (('code' in error &&
      [
        'LOCAL_STORAGE_UNAVAILABLE',
        'LOCAL_SAVE_FAILED',
        'LOCAL_DATA_NEEDS_REVIEW',
        'CLOSE_OTHER_TABS',
      ].includes(String(error.code))) ||
      ('name' in error &&
        ['QuotaExceededError', 'InvalidStateError', 'UnknownError'].includes(String(error.name))))
  );
}
export const OFFLINE_STORAGE_MESSAGE =
  'Device storage is unavailable or full. This save has not been confirmed. Keep your editor open, free browser/device space, then retry. Do not clear site data: it contains your saved offline edits.';
