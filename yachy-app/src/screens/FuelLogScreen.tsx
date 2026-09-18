/**
 * Fuel Log Screen
 * List of fuel log entries with Add, Edit, Delete, and selective PDF export.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import fuelLogsService from '../services/fuelLogs';
import { fuelManagementService } from '../services/fuelManagement';
import vesselService from '../services/vessel';
import { FuelLog, FuelLogAllocationSnapshot, FuelVolumeUnit } from '../types';
import {
  Button,
  Input,
  ButtonTagCard,
  ButtonTagRow,
  LoadingSpinner,
  PageHeader,
  ExportButton,
  ExportBar,
  FuelVoidReasonModal,
} from '../components';
import { exportFuelLogPdf } from '../utils/vesselLogsPdf';
import { fromLitres } from '../utils/fuelUnits';

const EMPTY_ALLOCATION_SNAPSHOT: FuelLogAllocationSnapshot = {
  displayUnit: 'LITRES',
  allocationsByLogId: {},
};

function formatCurrency(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currencyCode || 'USD'} ${value.toFixed(2)}`;
  }
}

function volumeLabel(log: FuelLog): string {
  if (log.volumeUnit === 'LITRES') return 'L';
  if (log.volumeUnit === 'US_GALLONS') return 'US gal';
  return 'gal (legacy)';
}

function priceLabel(log: FuelLog): string {
  if (log.volumeUnit === 'LITRES') return 'Per Litre';
  if (log.volumeUnit === 'US_GALLONS') return 'Per US Gallon';
  return 'Per Gallon';
}

function displayUnitLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

export const FuelLogScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [storedLogs, setStoredLogs] = useState<FuelLog[]>([]);
  const [loadedVesselId, setLoadedVesselId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState<{ vesselId: string; message: string } | null>(null);
  const [storedAllocationSnapshot, setStoredAllocationSnapshot] =
    useState<FuelLogAllocationSnapshot>(EMPTY_ALLOCATION_SNAPSHOT);
  const [voidTarget, setVoidTarget] = useState<FuelLog | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const loadGeneration = useRef(0);
  const requestedVesselId = useRef<string | null>(null);

  const vesselId = user?.vesselId ?? null;
  const canManageSetup = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const logs = loadedVesselId === vesselId ? storedLogs : [];
  const allocationSnapshot =
    loadedVesselId === vesselId ? storedAllocationSnapshot : EMPTY_ALLOCATION_SNAPSHOT;
  const currentLoadError = loadError?.vesselId === vesselId ? loadError.message : null;
  const waitingForCurrentVessel = loadedVesselId !== vesselId && !currentLoadError;

  const filteredLogs = searchQuery.trim()
    ? logs.filter((log) => {
        const q = searchQuery.toLowerCase().trim();
        return (
          log.logDate?.toLowerCase().includes(q) ||
          log.logTime?.toLowerCase().includes(q) ||
          log.locationOfRefueling?.toLowerCase().includes(q) ||
          (allocationSnapshot.allocationsByLogId[log.id] ?? []).some((allocation) =>
            allocation.tankName.toLowerCase().includes(q)
          )
        );
      })
    : logs;

  const loadLogs = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedVesselId.current = null;
      setStoredLogs([]);
      setStoredAllocationSnapshot(EMPTY_ALLOCATION_SNAPSHOT);
      setLoadedVesselId(null);
      setLoadError(null);
      setVoidTarget(null);
      setVoidReason('');
      setVoiding(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (requestedVesselId.current !== vesselId) {
      requestedVesselId.current = vesselId;
      setStoredLogs([]);
      setStoredAllocationSnapshot(EMPTY_ALLOCATION_SNAPSHOT);
      setLoadedVesselId(null);
      setLoadError(null);
      setSelectedIds(new Set());
      setExpandedId(null);
      setVoidTarget(null);
      setVoidReason('');
      setVoiding(false);
      setLoading(true);
    }
    try {
      const data = await fuelLogsService.getByVessel(vesselId);
      const nextAllocationSnapshot = await fuelManagementService.getFuelLogAllocationSnapshot(
        vesselId,
        data.map((log) => log.id)
      );
      if (generation !== loadGeneration.current) return;
      setStoredLogs(data);
      setStoredAllocationSnapshot(nextAllocationSnapshot);
      setLoadedVesselId(vesselId);
      setLoadError(null);
      setSelectedIds(new Set());
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel logs error:', e);
      setLoadError({
        vesselId,
        message:
          'Fuel receipts could not be refreshed. Existing data is retained, but new entries and corrections are paused until refresh succeeds.',
      });
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadLogs();
      return () => {
        loadGeneration.current += 1;
      };
    }, [loadLogs])
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = filteredLogs.length > 0 && filteredLogs.every((l) => selectedIds.has(l.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredLogs.map((l) => l.id)));
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadLogs();
  };
  const onAdd = () => navigation.navigate('AddEditFuelLog', {});
  const onEdit = (log: FuelLog) => navigation.navigate('AddEditFuelLog', { logId: log.id });

  const confirmLegacyVoid = async () => {
    if (
      !voidTarget ||
      !vesselId ||
      !voidReason.trim() ||
      voiding ||
      !canManageSetup ||
      currentLoadError ||
      voidTarget.vesselId !== vesselId ||
      voidTarget.currentInventoryOperationId
    ) {
      return;
    }
    const targetVesselId = vesselId;
    const target = voidTarget;
    setVoiding(true);
    try {
      await fuelManagementService.voidFuelLog(target.id, {
        expectedRevision: target.inventoryRevision ?? 0,
        reason: voidReason.trim(),
      });
      if (requestedVesselId.current !== targetVesselId) return;
      setVoidTarget(null);
      setVoidReason('');
      await loadLogs();
      Alert.alert(
        'Receipt voided',
        'The report-only receipt remains in the audit history. Calculated tank balances were not changed.'
      );
    } catch (error) {
      if (requestedVesselId.current !== targetVesselId) return;
      console.error('Void legacy fuel receipt error:', error);
      Alert.alert(
        'Could not void receipt',
        error instanceof Error ? error.message : 'Refresh the receipts and try again.'
      );
    } finally {
      if (requestedVesselId.current === targetVesselId) setVoiding(false);
    }
  };

  const onExportPdf = async () => {
    const toExport = logs.filter((l) => selectedIds.has(l.id));
    if (toExport.length === 0) {
      Alert.alert('Nothing selected', 'Select at least one entry to export.');
      return;
    }
    setExportingPdf(true);
    try {
      let vesselName = 'Vessel';
      if (vesselId) {
        const vessel = await vesselService.getVessel(vesselId);
        if (vessel?.name) vesselName = vessel.name;
      }
      await exportFuelLogPdf(toExport, vesselName, allocationSnapshot);
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Export failed', 'Could not generate PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to view fuel logs.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Fuel Receipts"
        actions={
          <ExportButton
            active={exportMode}
            onPress={() => {
              if (exportMode) setSelectedIds(new Set());
              setExportMode(!exportMode);
            }}
          />
        }
      />
      {exportMode && (
        <ExportBar
          count={selectedIds.size}
          onConfirm={onExportPdf}
          exporting={exportingPdf}
          hint="Tap logs to select"
        />
      )}
      <View style={styles.actionBar}>
        <Button
          title="Add Receipt"
          onPress={onAdd}
          variant="primary"
          style={styles.actionBtn}
          disabled={!!currentLoadError}
        />
        <Button
          title="Tank Inventory"
          onPress={() => navigation.navigate('FuelInventory')}
          variant="outline"
          style={styles.actionBtn}
        />
      </View>
      <Text style={[styles.auditHint, { color: themeColors.textSecondary }]}>
        Posted receipts remain in the audit history. Corrections are recorded separately.
      </Text>
      <TouchableOpacity
        style={styles.setupLink}
        onPress={() => navigation.navigate('FuelSetup')}
        accessibilityRole="button"
      >
        <Text style={[styles.setupLinkText, { color: themeColors.accent }]}>
          {canManageSetup ? 'Edit Vessel Fuel Setup' : 'View Vessel Fuel Setup'}
        </Text>
        <Text style={[styles.setupLinkChevron, { color: themeColors.accent }]}>›</Text>
      </TouchableOpacity>

      {currentLoadError ? (
        <View
          style={[
            styles.loadError,
            { backgroundColor: themeColors.surface, borderColor: COLORS.warning },
          ]}
        >
          <Text style={[styles.loadErrorText, { color: themeColors.textPrimary }]}>
            {currentLoadError}
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={loadLogs}>
            <Text style={[styles.loadErrorAction, { color: themeColors.accent }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {logs.length > 0 && !loading && (
        <>
          <View style={styles.searchRow}>
            <Input
              variant="search"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by date, time, location…"
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
          {exportMode && (
            <TouchableOpacity onPress={toggleSelectAll} style={styles.selectAllRow}>
              <Text style={[styles.selectAllText, { color: themeColors.accent }]}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {loading || waitingForCurrentVessel ? (
        <View style={styles.loader}>
          <LoadingSpinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.listContent,
            filteredLogs.length === 0 && styles.emptyContent,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
        >
          {filteredLogs.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: themeColors.surface }]}>
              <Text style={styles.emptyIcon}>⛽</Text>
              <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
                {currentLoadError && logs.length === 0
                  ? 'Could not load receipts'
                  : logs.length === 0
                    ? 'No entries yet'
                    : 'No matching entries'}
              </Text>
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
                {currentLoadError && logs.length === 0
                  ? 'Retry when your connection is available. Nautical Ops will not treat a load failure as an empty audit log.'
                  : logs.length === 0
                    ? 'Tap "Add Receipt" to record your first bunkering entry.'
                    : 'Try a different search term.'}
              </Text>
            </View>
          ) : (
            filteredLogs.map((log) => {
              const selected = selectedIds.has(log.id);
              const tankAllocations = allocationSnapshot.allocationsByLogId[log.id] ?? [];
              return (
                <ButtonTagCard
                  key={log.id}
                  headerTitle={log.locationOfRefueling ?? ''}
                  showCheckbox={exportMode}
                  checked={selected}
                  onToggleSelect={() => toggleSelect(log.id)}
                  selected={exportMode && selected}
                  onEdit={
                    canManageSetup && !currentLoadError && !log.currentInventoryOperationId
                      ? () => onEdit(log)
                      : undefined
                  }
                  onDelete={
                    canManageSetup &&
                    !exportMode &&
                    !currentLoadError &&
                    !log.currentInventoryOperationId
                      ? () => {
                          setVoidReason('');
                          setVoidTarget(log);
                        }
                      : undefined
                  }
                  footer={log.createdByName ? `Logged by ${log.createdByName}` : undefined}
                  collapsible={!exportMode}
                  expanded={expandedId === log.id}
                  onToggleExpand={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  summary={
                    <ButtonTagRow
                      label="Date"
                      value={[log.logDate, log.logTime].filter(Boolean).join('  ·  ')}
                    />
                  }
                >
                  <ButtonTagRow label="Time" value={log.logTime ?? ''} />
                  <View style={[styles.statsRow, { backgroundColor: themeColors.background }]}>
                    <View style={styles.statBox}>
                      <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                        Amount
                      </Text>
                      <Text style={[styles.statValue, { color: themeColors.textPrimary }]}>
                        {log.amountOfFuel} {volumeLabel(log)}
                      </Text>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
                    <View style={styles.statBox}>
                      <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                        {priceLabel(log)}
                      </Text>
                      <Text style={[styles.statValue, { color: themeColors.textPrimary }]}>
                        {formatCurrency(log.pricePerVolumeUnit, log.currencyCode)}
                      </Text>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
                    <View style={styles.statBox}>
                      <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                        Total
                      </Text>
                      <Text
                        style={[styles.statValue, styles.totalValue, { color: themeColors.accent }]}
                      >
                        {formatCurrency(log.totalPrice, log.currencyCode)}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.allocations,
                      {
                        backgroundColor: themeColors.control,
                        borderColor: themeColors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.allocationsTitle, { color: themeColors.textSecondary }]}>
                      Tank allocation
                    </Text>
                    {tankAllocations.length > 0 ? (
                      tankAllocations.map((allocation) => (
                        <View key={allocation.fuelTankId} style={styles.allocationRow}>
                          <Text
                            style={[styles.allocationTankName, { color: themeColors.textPrimary }]}
                          >
                            {allocation.tankName}
                          </Text>
                          <Text
                            style={[styles.allocationAmount, { color: themeColors.textPrimary }]}
                          >
                            {formatVolume(
                              fromLitres(allocation.amountLitres, allocationSnapshot.displayUnit)
                            )}{' '}
                            {displayUnitLabel(allocationSnapshot.displayUnit)}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={[styles.unallocatedText, { color: themeColors.textSecondary }]}>
                        {log.volumeUnit === null
                          ? 'Legacy entry — no tank allocation recorded.'
                          : 'No tank allocation recorded.'}
                      </Text>
                    )}
                  </View>
                  <ButtonTagRow label="Comment" value={log.comment ?? ''} />
                </ButtonTagCard>
              );
            })
          )}
        </ScrollView>
      )}
      <FuelVoidReasonModal
        visible={!!voidTarget && voidTarget.vesselId === vesselId}
        title="Void this report-only receipt?"
        description="This does not delete history or change calculated tank balances. Nautical Ops records your name, time and reason in the legacy audit trail."
        reason={voidReason}
        onChangeReason={setVoidReason}
        onCancel={() => {
          setVoidTarget(null);
          setVoidReason('');
        }}
        onConfirm={confirmLegacyVoid}
        submitting={voiding}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  actionBar: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  actionBtn: { flex: 1 },
  setupLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  setupLinkText: { fontSize: FONTS.sm, fontWeight: '600' },
  setupLinkChevron: { fontSize: 20, marginLeft: 2 },
  auditHint: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    fontSize: FONTS.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  loadError: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  loadErrorText: { flex: 1, fontSize: FONTS.sm, lineHeight: 19 },
  loadErrorAction: { fontSize: FONTS.sm, fontWeight: '700' },
  searchRow: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  searchInput: {},
  selectAllRow: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  selectAllText: { fontSize: FONTS.sm, fontWeight: '600' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  emptyState: {
    borderRadius: 12,
    padding: SPACING.xl,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  statsRow: {
    flexDirection: 'row',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, marginVertical: 2 },
  statLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  statValue: { fontSize: FONTS.base, fontWeight: '600' },
  totalValue: { fontWeight: '700' },
  allocations: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  allocationsTitle: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  allocationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
    paddingVertical: 3,
  },
  allocationTankName: { flex: 1, fontSize: FONTS.base },
  allocationAmount: { fontSize: FONTS.base, fontWeight: '600', textAlign: 'right' },
  unallocatedText: { fontSize: FONTS.sm, lineHeight: 20 },
});
