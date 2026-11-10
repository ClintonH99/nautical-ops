import { seaMilesAdapter } from './seaMilesAdapter';
import { watchDutiesAdapter } from './watchDutiesAdapter';
import { restAdapter } from './restAdapter';
import { watchKeepingAdapter, watchRulesAdapter, watchDeviceCopy } from './watchKeepingAdapter';
import { crewLeaveAdapter, crewLeaveDeviceCopy } from './crewLeaveAdapter';
import { checklistsAdapter, checklistDeviceCopy } from './checklistsAdapter';
import { inventoryAdapter, inventoryDeviceCopy } from './inventoryAdapter';
import { vesselRecordAdapter, vesselRecordDeviceCopy } from './vesselRecordAdapter';
import { boundedCheck } from './boundedCheck';
import { maintenanceAdapter, maintenanceDeviceCopy } from './maintenanceAdapter';
import { create } from 'zustand';
import type { User } from '../types';
import type { OfflineStatus } from './runtime';
import { useAuthStore } from '../store';
import { useBrowserSessionLease } from '../services/browserSessionLease';
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_AUTH_STORAGE_KEY,
} from '../services/supabase';
import { getCurrentDeviceFingerprint, registerCurrentDevice } from '../services/deviceAccess';
import { OfflineError, scopeKey, verifyOfflinePermit, requireOfflineAccess } from './access';
import type { OfflineScope, VerifiedOfflinePermit } from './access';
import { OfflineOutbox } from './outbox';
import type { RecordValue } from './outbox';
import { openOfflineStore } from './indexedDb.web';
import type { BrowserOfflineStore } from './indexedDb.web';
import { notesAdapter } from './notesAdapter';
import { shoppingAdapter, shoppingDeviceCopy } from './shoppingAdapter';
import type { OfflineFeature } from './access';
import { tasksAdapter, taskDeviceCopy } from './tasksAdapter';
import { publicationsAdapter, publicationDeviceCopy } from './publicationsAdapter';
import { yardJobsAdapter, yardJobDeviceCopy } from './yardJobsAdapter';
import { tripsAdapter, tripDeviceCopy } from './tripsAdapter';
import { contractorsAdapter, contractorDeviceCopy } from './contractorsAdapter';
const adapters = {
  seaMiles: seaMilesAdapter(),
  seaMilesReview: seaMilesAdapter(true),
  watchDuties: watchDutiesAdapter('watchDuties'),
  watchDutyRules: watchDutiesAdapter('watchDutyRules'),
  watchDutyChecks: watchDutiesAdapter('watchDutyChecks'),
  watchAssignments: watchDutiesAdapter('watchAssignments'),

  restEntries: restAdapter(false),
  restReview: restAdapter(true),
  watchKeeping: watchKeepingAdapter,
  watchKeepingRules: watchRulesAdapter,
  crewLeave: crewLeaveAdapter,
  preDepartureChecklists: checklistsAdapter,
  inventory: inventoryAdapter,
  pumpOutLogs: vesselRecordAdapter('pumpOutLogs'),
  generalWasteLogs: vesselRecordAdapter('generalWasteLogs'),
  uniforms: vesselRecordAdapter('uniforms'),

  notes: notesAdapter,
  shoppingLists: shoppingAdapter,
  tasks: tasksAdapter,
  contractors: contractorsAdapter,
  trips: tripsAdapter,
  maintenanceLogs: maintenanceAdapter,
  yardJobs: yardJobsAdapter,
  rules: publicationsAdapter,
  safetyEquipment: publicationsAdapter,
  musterStations: publicationsAdapter,
};
const readFunctions = {
  seaMiles: 'read_web_offline_sea_miles',
  seaMilesReview: 'read_web_offline_sea_miles_review',
  watchDuties: 'read_web_offline_watch_duties',
  watchDutyRules: 'read_web_offline_watch_duty_rules',
  watchDutyChecks: 'read_web_offline_watch_duty_checks',
  watchAssignments: 'read_web_offline_watch_assignments',

  restEntries: 'read_web_offline_rest_entries',
  restReview: 'read_web_offline_rest_review',
  watchKeeping: 'read_web_offline_watch_keeping',
  watchKeepingRules: 'read_web_offline_watch_rules',
  crewLeave: 'read_web_offline_crew_leave',
  preDepartureChecklists: 'read_web_offline_checklists',
  inventory: 'read_web_offline_inventory_items',
  pumpOutLogs: 'read_web_offline_pump_out_logs',
  generalWasteLogs: 'read_web_offline_general_waste_logs',
  uniforms: 'read_web_offline_uniforms',

  notes: 'read_web_offline_notes',
  shoppingLists: 'read_web_offline_shopping',
  tasks: 'read_web_offline_tasks',
  contractors: 'read_web_offline_contractors',
  musterStations: 'read_web_offline_muster_stations',
  safetyEquipment: 'read_web_offline_safety_equipment',
  trips: 'read_web_offline_trips',
  maintenanceLogs: 'read_web_offline_maintenance_logs',
  yardJobs: 'read_web_offline_yard_jobs',
  rules: 'read_web_offline_rules',
};
const syncFunctions = {
  seaMiles: 'sync_web_offline_sea_miles',
  seaMilesReview: 'sync_web_offline_sea_miles',
  watchDuties: 'sync_web_offline_watch_duties',
  watchDutyRules: 'sync_web_offline_watch_duty_rules',
  watchDutyChecks: 'sync_web_offline_watch_duty_checks',
  watchAssignments: 'sync_web_offline_watch_assignments',

  restEntries: 'sync_web_offline_rest_entries',
  restReview: 'sync_web_offline_rest_entries',
  watchKeeping: 'sync_web_offline_watch_keeping',
  watchKeepingRules: 'sync_web_offline_watch_rules',
  crewLeave: 'sync_web_offline_crew_leave',
  preDepartureChecklists: 'sync_web_offline_checklist',
  inventory: 'sync_web_offline_inventory_item',
  pumpOutLogs: 'sync_web_offline_pump_out_log',
  generalWasteLogs: 'sync_web_offline_general_waste_log',
  uniforms: 'sync_web_offline_uniform',

  notes: 'sync_web_offline_note',
  shoppingLists: 'sync_web_offline_shopping',
  tasks: 'sync_web_offline_task',
  contractors: 'sync_web_offline_contractor',
  musterStations: 'sync_web_offline_muster_stations',
  safetyEquipment: 'sync_web_offline_safety_equipment',
  trips: 'sync_web_offline_trip',
  maintenanceLogs: 'sync_web_offline_maintenance_log',
  yardJobs: 'sync_web_offline_yard_job',
  rules: 'sync_web_offline_rules',
};
type SupportedFeature = keyof typeof adapters;

export const webOfflineEnabled = process.env.EXPO_PUBLIC_WEB_OFFLINE === 'true';
export const useOfflineStatus = create<OfflineStatus>(() => ({
  enabled: webOfflineEnabled,
  ready: false,
  saving: 0,
  shellState: 'preparing',
  disconnected: typeof navigator !== 'undefined' && !navigator.onLine,
  pending: 0,
  issue: null,
  expiresAt: null,
  conflicts: [],
  recoverable: 0,
}));
// Synchronous start lets callers show saving before their first storage await.
export function beginDeviceSave(): () => void {
  if (!webOfflineEnabled) return () => {};
  useOfflineStatus.setState((s) => ({ saving: s.saving + 1 }));
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    useOfflineStatus.setState((s) => ({ saving: Math.max(0, s.saving - 1) }));
  };
}
type Active = {
  scope: OfflineScope;
  permit: VerifiedOfflinePermit | null;
  store: BrowserOfflineStore;
  box: OfflineOutbox;
  revoked: boolean;
};
let active: Active | null = null;
let generation = 0;
let syncFlight: Promise<void> | null = null;
let preparing: Promise<void> | null = null;
let preparationKey: string | null = null;
const noteListeners = new Set<() => void>();
export function subscribeOfflineNotes(listener: () => void) {
  noteListeners.add(listener);
  return () => {
    noteListeners.delete(listener);
  };
}
const notifyNotes = () => {
  for (const listener of noteListeners) listener();
};
export const useOfflineRoute = create<{ name: string | null }>(() => ({ name: null }));
export function setOfflineRoute(name: string | null) {
  useOfflineRoute.setState({ name });
}
const keys = (): Record<string, JsonWebKey> => {
  const parsed = JSON.parse(process.env.EXPO_PUBLIC_WEB_OFFLINE_KEYS || '{}');
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => !value || typeof value !== 'object' || 'd' in value)
  )
    throw new OfflineError('INVALID_PUBLIC_KEYS');
  return parsed;
};
const grantKey = (scope: OfflineScope) => 'nautical-offline-permit:' + scopeKey(scope);
function blocked(a: Active): boolean {
  const auth = useAuthStore.getState();
  const lease = useBrowserSessionLease.getState();
  return (
    a.revoked ||
    auth.user?.id !== a.scope.userId ||
    auth.user?.vesselId !== a.scope.vesselId ||
    auth.captainPaymentRequired ||
    auth.crewPaymentRequired ||
    (lease.userId === a.scope.userId && ['limited', 'revoked'].includes(lease.status))
  );
}
function context(a: Active) {
  return {
    scope: a.scope,
    permit: a.permit,
    nowMs: Date.now(),
    highestObservedMs: 0,
    blocked: active !== a || blocked(a),
  };
}
function sameActive(a: Active) {
  if (active !== a || blocked(a)) throw new OfflineError('SCOPE_CHANGED');
}
export async function checkOfflineAccess(): Promise<boolean> {
  const a = active;
  if (!a) return false;
  try {
    await a.store.update(a.scope, (state) => {
      const c = context(a);
      // Keep the observed watermark even at expiry. Never delete pending edits.
      state.highestObservedMs = Math.max(state.highestObservedMs, c.nowMs);
    });
    const state = await a.store.read(a.scope);
    requireOfflineAccess(
      { ...context(a), highestObservedMs: state.highestObservedMs },
      'notes',
      'read'
    );
    const recoverable = await a.store.recoverable(a.scope);
    sameActive(a);
    useOfflineStatus.setState({
      ready: true,
      expiresAt: a.permit!.claims.exp * 1000,
      pending: state.changes.length,
      recoverable,
      recoveryCopies: (state.recoveryCopies ?? []).filter((copy) => {
        const adapter = adapters[copy.feature as SupportedFeature];
        return (
          !!a.permit?.claims.permissions[copy.feature]?.includes('read') &&
          !!adapter?.authorizeRead(a.scope, copy.value)
        );
      }).length,
      conflicts: state.changes
        .filter((change) => change.state === 'conflict')
        .map((change) => ({
          id: change.id,
          canFork: ![
            'watchKeepingRules',
            'restEntries',
            'restReview',
            'watchDutyRules',
            'watchDutyChecks',
            'watchDuties',
            'watchAssignments',
            'seaMiles',
            'seaMilesReview',
          ].includes(change.feature),
          title: String(
            change.value.title ??
              change.value.watch_title ??
              change.value.company_name ??
              change.value.job_title ??
              change.value.equipment ??
              change.value.label ??
              change.value.description_of_garbage ??
              change.value.description ??
              'Saved record'
          ),
        })),
    });
    return true;
  } catch {
    if (active === a)
      useOfflineStatus.setState({
        ready: false,
        conflicts: [],
        recoverable: 0,
        issue: 'Reconnect to verify offline access. Your pending edits are kept on this device.',
      });
    return false;
  }
}
async function refreshPermit(a: Active) {
  sameActive(a);
  const { data, error } = await boundedCheck(supabase.auth.getSession());
  sameActive(a);
  if (error || !data.session?.access_token) throw new OfflineError('ONLINE_CHECK_REQUIRED');
  const device = await boundedCheck(registerCurrentDevice());
  sameActive(a);
  if (device.state === 'session_revoked' || device.state === 'limit_reached') {
    a.revoked = true;
    localStorage.removeItem(grantKey(a.scope));
    throw new OfflineError('ACCESS_BLOCKED');
  }
  if (device.state !== 'allowed') throw new OfflineError('ONLINE_CHECK_UNAVAILABLE');
  const response = await fetch(SUPABASE_URL + '/functions/v1/web-offline-access', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + data.session.access_token,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vesselId: a.scope.vesselId, deviceId: a.scope.deviceId }),
    signal: AbortSignal.timeout(15000),
  });
  sameActive(a);
  if ([401, 403].includes(response.status)) {
    a.revoked = true;
    localStorage.removeItem(grantKey(a.scope));
    throw new OfflineError('ACCESS_BLOCKED');
  }
  if (!response.ok) throw new OfflineError('ONLINE_CHECK_UNAVAILABLE');
  const { token } = await response.json();
  const permit = await verifyOfflinePermit(token, keys(), a.scope);
  sameActive(a);
  a.permit = permit;
  localStorage.setItem(grantKey(a.scope), token);
}
async function refreshNotes(a: Active) {
  sameActive(a);
  // Only the display name is cached. Invite codes and vessel administration stay online.
  const label = await supabase
    .from('vessels')
    .select('id,name')
    .eq('id', a.scope.vesselId)
    .single();
  sameActive(a);
  if (label.error) throw label.error;
  if (label.data?.id !== a.scope.vesselId || typeof label.data.name !== 'string')
    throw new OfflineError('INVALID_SNAPSHOT');
  await a.store.update(a.scope, (state) => {
    sameActive(a);
    state.vesselLabel = label.data.name;
  });
  const colours = await supabase
    .from('vessel_trip_colors')
    .select('guest_trip_color,boss_trip_color,delivery_trip_color,yard_period_color')
    .eq('vessel_id', a.scope.vesselId)
    .maybeSingle();
  sameActive(a);
  if (colours.error) throw colours.error;
  await a.store.update(a.scope, (state) => {
    sameActive(a);
    state.tripColors = colours.data;
  });
  const folders = await supabase.rpc('read_web_offline_shipyard_folders', {
    p_vessel_id: a.scope.vesselId,
    p_device_id: a.scope.deviceId,
  });
  sameActive(a);
  if (folders.error) throw folders.error;
  if (
    !Array.isArray(folders.data?.folders) ||
    !Array.isArray(folders.data?.assignments) ||
    folders.data.folders.some((folder: RecordValue) => folder.vessel_id !== a.scope.vesselId)
  )
    throw new OfflineError('INVALID_SNAPSHOT');
  await a.store.update(a.scope, (state) => {
    sameActive(a);
    state.shipyardFolders = folders.data;
  });
  const roster = await supabase.rpc('read_web_offline_crew_roster', {
    p_vessel_id: a.scope.vesselId,
    p_device_id: a.scope.deviceId,
  });
  sameActive(a);
  if (roster.error) throw roster.error;
  if (
    !Array.isArray(roster.data) ||
    roster.data.some(
      (m: RecordValue) =>
        m.vessel_id !== a.scope.vesselId ||
        typeof m.id !== 'string' ||
        typeof m.name !== 'string' ||
        typeof m.position !== 'string'
    )
  )
    throw new OfflineError('INVALID_SNAPSHOT');
  await a.store.update(a.scope, (state) => {
    sameActive(a);
    state.crewRoster = roster.data;
  });
  const restContext = await supabase.rpc('read_web_offline_rest_context', {
    p_vessel_id: a.scope.vesselId,
    p_device_id: a.scope.deviceId,
  });
  sameActive(a);
  if (restContext.error) throw restContext.error;
  if (typeof restContext.data?.hasSignature !== 'boolean')
    throw new OfflineError('INVALID_SNAPSHOT');
  await a.store.update(a.scope, (state) => {
    sameActive(a);
    state.restSignature = restContext.data.hasSignature;
  });
  const seaContext = await supabase.rpc('read_web_offline_sea_context', {
    p_vessel_id: a.scope.vesselId,
    p_device_id: a.scope.deviceId,
  });
  sameActive(a);
  if (seaContext.error) throw seaContext.error;
  const sc = seaContext.data;
  if (
    !sc ||
    !Array.isArray(sc.folders) ||
    !Array.isArray(sc.assignments) ||
    typeof sc.canSubmit !== 'boolean' ||
    typeof sc.hasSignature !== 'boolean' ||
    typeof sc.reviewRevision !== 'string'
  )
    throw new OfflineError('INVALID_SNAPSHOT');
  await a.store.update(a.scope, (state) => {
    sameActive(a);
    state.seaMileContext = sc;
  });
  for (const feature of Object.keys(adapters) as SupportedFeature[]) {
    if (!a.permit?.claims.permissions[feature]?.includes('read')) continue;
    sameActive(a);
    const { data, error } = await supabase.rpc(readFunctions[feature], {
      p_vessel_id: a.scope.vesselId,
      p_device_id: a.scope.deviceId,
    });
    sameActive(a);
    if (error) {
      if (error.code === '42501') a.revoked = true;
      throw error;
    }
    if (!Array.isArray(data)) throw new OfflineError('INVALID_SNAPSHOT');
    await a.box.replaceSnapshot(
      feature,
      data.map((row) => ({ recordId: row.value.id, value: row.value, revision: row.revision }))
    );
  }
  sameActive(a);
  notifyNotes();
}
export async function syncOffline(): Promise<void> {
  if (syncFlight) return syncFlight;
  const a = active;
  if (!a || !navigator.onLine) return;
  const flight = (async () => {
    try {
      await refreshPermit(a);
      const outcome = await a.box.sync({
        protocol: 'offline-mutation-v1',
        revalidate: async () => {
          sameActive(a);
          return true;
        },
        apply: async (scope, operation) => {
          if (!(operation.feature in adapters)) return { status: 'forbidden' };
          const { data, error } = await supabase.rpc(
            syncFunctions[operation.feature as SupportedFeature],
            { p_vessel_id: scope.vesselId, p_device_id: scope.deviceId, p_operation: operation }
          );
          if (error) return { status: error.code === '42501' ? 'forbidden' : 'retry' };
          return data;
        },
      });
      sameActive(a);
      await refreshNotes(a);
      sameActive(a);
      useOfflineStatus.setState({
        disconnected: false,
        issue:
          outcome.stopped === 'CONFLICT'
            ? 'An online record changed. Your device copy is kept for review.'
            : outcome.stopped
              ? 'Some edits are waiting to sync.'
              : null,
      });
    } catch (error) {
      if (active === a)
        useOfflineStatus.setState({
          disconnected: true,
          issue: a.revoked
            ? 'Access could not be verified. Reconnect and sign in again.'
            : error instanceof OfflineError && error.code === 'INVALID_PUBLIC_KEYS'
              ? 'Offline configuration is unavailable.'
              : 'Offline. Changes stay on this device until they can sync.',
        });
    } finally {
      if (active === a) await checkOfflineAccess();
    }
  })();
  syncFlight = flight;
  try {
    await flight;
  } finally {
    if (syncFlight === flight) syncFlight = null;
  }
}
async function initializeOffline(user: User | null): Promise<void> {
  const current = ++generation;
  syncFlight = null;
  active?.store.close();
  active = null;
  useOfflineStatus.setState({ partitionKey: undefined });
  useOfflineStatus.setState({
    ready: false,
    pending: 0,
    expiresAt: null,
    issue: null,
    conflicts: [],
    recoverable: 0,
    recoveryCopies: 0,
    recoveryVersion: 0,
  });
  if (!webOfflineEnabled || !user?.vesselId) return;
  try {
    const raw = JSON.parse(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY) || 'null');
    if (raw?.user?.id !== user.id || typeof raw.access_token !== 'string') return;
    const encoded = raw.access_token.split('.')[1];
    const claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    const scope: OfflineScope = {
      origin: location.origin,
      projectId: new URL(SUPABASE_URL).hostname.split('.')[0],
      userId: user.id,
      vesselId: user.vesselId,
      deviceId: await getCurrentDeviceFingerprint(),
      sessionId: claims.session_id,
    };
    scopeKey(scope);
    const store = await openOfflineStore();
    if (current !== generation) {
      store.close();
      return;
    }
    const a = {} as Active;
    Object.assign(a, {
      scope,
      store,
      permit: null,
      revoked: false,
      box: new OfflineOutbox({ store, context: () => context(a), adapters }),
    });
    active = a;
    useOfflineStatus.setState({ partitionKey: scopeKey(a.scope) });
    const token = localStorage.getItem(grantKey(scope));
    if (token) {
      try {
        a.permit = await verifyOfflinePermit(token, keys(), scope);
      } catch {
        /* Never trust an unverifiable cached grant. */
      }
    }
    if (current !== generation) return;
    const cachedReady = await checkOfflineAccess();
    if (navigator.onLine) {
      // A device may have Wi-Fi without internet. Cached access must not wait
      // for a stalled token refresh or network request to render saved records.
      if (cachedReady) void syncOffline();
      else await syncOffline();
    }
  } catch {
    if (current === generation)
      useOfflineStatus.setState({
        ready: false,
        issue: 'Connect to the internet to prepare offline access on this browser.',
      });
  }
}
export function prepareOffline(user: User | null): Promise<void> {
  const key = user ? `${user.id}:${user.vesselId}` : null;
  if (preparing && preparationKey === key) return preparing;
  if (
    active &&
    preparationKey === key &&
    active.scope.userId === user?.id &&
    active.scope.vesselId === user?.vesselId
  )
    return Promise.resolve();
  preparationKey = key;
  const flight = initializeOffline(user);
  preparing = flight;
  void flight.finally(() => {
    if (preparing === flight) preparing = null;
  });
  return flight;
}
export async function offlineNotesContext(): Promise<Active> {
  // A screen may mount before the parent boundary effect. Join initialization
  // for the current account, not an earlier signed-out/account-switch promise.
  const user = useAuthStore.getState().user;
  await prepareOffline(user);
  const a = active;
  if (!a || !(await checkOfflineAccess())) throw new OfflineError('ONLINE_CHECK_REQUIRED');
  sameActive(a);
  return a;
}
export async function readOfflineNotes(): Promise<RecordValue[]> {
  const a = await offlineNotesContext();
  return (await a.box.list('notes')).map((row) => ({
    ...row.value,
    offlineLocalVersion: row.localVersion,
  }));
}
export async function saveOfflineNote(
  value: RecordValue,
  kind: 'create' | 'update',
  expectedLocalVersion: number
) {
  return saveOfflineRecord('notes', value, kind, expectedLocalVersion);
}
export async function saveOfflineRecord(
  feature: SupportedFeature,
  value: RecordValue,
  kind: 'create' | 'update',
  expectedLocalVersion: number
) {
  const finish = beginDeviceSave();
  try {
    const a = await offlineNotesContext();
    const result = await a.box.save({
      feature,
      recordId: value.id as string,
      value,
      kind,
      expectedLocalVersion,
    });
    notifyNotes();
    await checkOfflineAccess();
    if (navigator.onLine) void syncOffline();
    return { ...value, offlineLocalVersion: result.localVersion };
  } finally {
    finish();
  }
}
export async function keepBothNoteCopies(operationId: string): Promise<void> {
  const a = await offlineNotesContext();
  const change = (await a.store.read(a.scope)).changes.find(
    (item) => item.id === operationId && item.state === 'conflict'
  );
  if (!change) throw new OfflineError('CONFLICT_CHANGED');
  if (
    [
      'watchKeepingRules',
      'restEntries',
      'restReview',
      'watchDutyRules',
      'watchDutyChecks',
      'watchDuties',
      'watchAssignments',
      'seaMiles',
      'seaMilesReview',
    ].includes(change.feature)
  )
    throw new OfflineError('RECONCILE_FIRST');
  const latest = await a.box.read(change.feature, change.recordId);
  if (!latest) throw new OfflineError('CONFLICT_CHANGED');
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const copy =
    change.feature === 'notes'
      ? {
          ...latest.value,
          id,
          title: String(latest.value.title) + ' (device copy)',
          created_at: now,
          updated_at: now,
        }
      : change.feature === 'watchKeeping'
        ? watchDeviceCopy(latest.value, id, a.scope.userId)
        : change.feature === 'crewLeave'
          ? crewLeaveDeviceCopy(latest.value, id, a.scope.userId)
          : change.feature === 'preDepartureChecklists'
            ? checklistDeviceCopy(latest.value, id, a.scope.userId)
            : change.feature === 'inventory'
              ? inventoryDeviceCopy(latest.value, id)
              : change.feature === 'uniforms' ||
                  change.feature === 'pumpOutLogs' ||
                  change.feature === 'generalWasteLogs'
                ? vesselRecordDeviceCopy(
                    change.feature,
                    latest.value,
                    id,
                    a.scope.userId,
                    useAuthStore.getState().user?.name ?? ''
                  )
                : change.feature === 'maintenanceLogs'
                  ? maintenanceDeviceCopy(latest.value, id)
                  : change.feature === 'tasks'
                    ? taskDeviceCopy(latest.value, id, a.scope.userId)
                    : change.feature === 'yardJobs'
                      ? yardJobDeviceCopy(latest.value, id, a.scope.userId)
                      : change.feature === 'trips'
                        ? tripDeviceCopy(latest.value, id, a.scope.userId)
                        : change.feature === 'contractors'
                          ? contractorDeviceCopy(latest.value, id, a.scope.userId)
                          : change.feature === 'shoppingLists'
                            ? shoppingDeviceCopy(latest.value, id, a.scope.userId)
                            : publicationDeviceCopy(latest.value, id, a.scope.userId);
  await a.box.forkConflict(operationId, id, copy);
  notifyNotes();
  await checkOfflineAccess();
  if (navigator.onLine) await syncOffline();
}
export async function recoverSavedNotes(): Promise<void> {
  const a = active;
  if (!a || !navigator.onLine) throw new OfflineError('ONLINE_CHECK_REQUIRED');
  await refreshPermit(a);
  sameActive(a);
  const moved = await a.store.recover(
    a.scope,
    (change) => {
      sameActive(a);
      const adapter = adapters[change.feature as SupportedFeature];
      try {
        requireOfflineAccess(context(a), change.feature as OfflineFeature, 'read');
        requireOfflineAccess(context(a), change.feature as OfflineFeature, change.kind);
      } catch {
        return false;
      }
      return (
        !!adapter && adapter.validate(change.value) && adapter.authorizeRead(a.scope, change.value)
      );
    },
    {
      draft: (feature) => {
        sameActive(a);
        if (feature !== 'inventory') return false;
        try {
          for (const action of ['read', 'create', 'update'] as const)
            requireOfflineAccess(context(a), feature, action);
          return true;
        } catch {
          return false;
        }
      },
      copy: (feature, value) => {
        sameActive(a);
        try {
          requireOfflineAccess(context(a), feature, 'read');
        } catch {
          return false;
        }
        return adapters[feature as SupportedFeature]?.authorizeRead(a.scope, value) === true;
      },
    }
  );
  sameActive(a);
  if (moved) useOfflineStatus.setState((s) => ({ recoveryVersion: (s.recoveryVersion ?? 0) + 1 }));
  notifyNotes();
  await checkOfflineAccess();
  await syncOffline();
}

export type OfflineConflictReview = {
  partition: string;
  operationId: string;
  feature: SupportedFeature;
  localVersion: number;
  local: RecordValue;
  online: { value: RecordValue; revision: string };
};
async function onlineConflictRow(a: Active, feature: SupportedFeature, recordId: string) {
  sameActive(a);
  requireOfflineAccess(context(a), feature, 'read');
  const { data, error } = await boundedCheck(
    supabase.rpc(readFunctions[feature], {
      p_vessel_id: a.scope.vesselId,
      p_device_id: a.scope.deviceId,
    })
  );
  sameActive(a);
  if (error) throw error;
  if (!Array.isArray(data)) throw new OfflineError('INVALID_SNAPSHOT');
  const row = data.find((r) => r.value?.id === recordId);
  if (
    !row ||
    typeof row.revision !== 'string' ||
    !adapters[feature].validate(row.value) ||
    !adapters[feature].authorizeRead(a.scope, row.value)
  )
    throw new OfflineError('ACTION_NOT_ALLOWED');
  return { value: row.value as RecordValue, revision: row.revision as string };
}
export async function reviewOfflineConflict(operationId: string): Promise<OfflineConflictReview> {
  const a = await offlineNotesContext();
  if (!navigator.onLine) throw new OfflineError('ONLINE_CHECK_REQUIRED');
  await refreshPermit(a);
  const change = (await a.store.read(a.scope)).changes.find(
    (c) => c.id === operationId && c.state === 'conflict'
  );
  if (!change || !(change.feature in adapters)) throw new OfflineError('CONFLICT_CHANGED');
  const local = await a.box.read(change.feature, change.recordId);
  if (!local) throw new OfflineError('CONFLICT_CHANGED');
  const online = await onlineConflictRow(a, change.feature as SupportedFeature, change.recordId);
  return {
    partition: scopeKey(a.scope),
    operationId,
    feature: change.feature as SupportedFeature,
    localVersion: local.localVersion,
    local: local.value,
    online,
  };
}
export async function acceptReviewedOnlineVersion(review: OfflineConflictReview): Promise<void> {
  const a = await offlineNotesContext();
  if (!navigator.onLine || review.partition !== scopeKey(a.scope))
    throw new OfflineError('SCOPE_CHANGED');
  await refreshPermit(a);
  const online = await onlineConflictRow(a, review.feature, String(review.local.id));
  if (online.revision !== review.online.revision) throw new OfflineError('CONFLICT_CHANGED');
  await a.box.useOnlineVersion({
    operationId: review.operationId,
    expectedLocalVersion: review.localVersion,
    online,
  });
  notifyNotes();
  await checkOfflineAccess();
  await syncOffline();
}
export async function readOfflineRecoveryCopies(): Promise<{ id: string; value: RecordValue }[]> {
  const a = await offlineNotesContext(),
    state = await a.store.read(a.scope);
  sameActive(a);
  return (state.recoveryCopies ?? [])
    .filter((copy) => {
      const adapter = adapters[copy.feature as SupportedFeature];
      try {
        requireOfflineAccess(
          { ...context(a), highestObservedMs: state.highestObservedMs },
          copy.feature,
          'read'
        );
      } catch {
        return false;
      }
      return !!adapter?.authorizeRead(a.scope, copy.value);
    })
    .map((copy) => ({ id: copy.id, value: copy.value }));
}
