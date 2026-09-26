import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Fuel Log Screen
 * List of fuel log entries with Add, Edit, Delete, and selective PDF export.
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
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
} from '../components';
import { exportFuelLogPdf } from '../utils/vesselLogsPdf';
import { fromLitres, storedFuelVolumeUnit, toLitres } from '../utils/fuelUnits';

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
  return 'US gal';
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
  const [storedLogs, setStoredLogs] = useScreenState<FuelLog[]>('storedLogs', []);
  const [loadedVesselId, setLoadedVesselId] = useScreenState<string | null>('loadedVesselId', null);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState<{ vesselId: string; message: string } | null>(null);
  const [storedAllocationSnapshot, setStoredAllocationSnapshot] =
    useScreenState<FuelLogAllocationSnapshot>(
      'storedAllocationSnapshot',
      EMPTY_ALLOCATION_SNAPSHOT
    );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const requestedVesselId = useRef<string | null>(user?.vesselId ?? null);

  const vesselId = user?.vesselId ?? null;
  const canManageSetup = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const logs = loadedVesselId === vesselId ? storedLogs : [];
  const allocationSnapshot =
    loadedVesselId === vesselId ? storedAllocationSnapshot : EMPTY_ALLOCATION_SNAPSHOT;
  const currentLoadError = loadError?.vesselId === vesselId ? loadError.message : null;
  const waitingForCurrentVessel = loadedVesselId !== vesselId && !currentLoadError;

  const receiptSummary = (() => {
    const costs = new Map<string, number>();
    let totalLitres = 0;
    logs.forEach((log) => {
      const currency = log.currencyCode || 'USD';
      totalLitres += toLitres(Number(log.amountOfFuel), storedFuelVolumeUnit(log.volumeUnit));
      costs.set(currency, (costs.get(currency) ?? 0) + Number(log.totalPrice));
    });
    const displayUnit = allocationSnapshot.displayUnit;
    return {
      volume: `${formatVolume(fromLitres(totalLitres, displayUnit))} ${displayUnitLabel(displayUnit)}`,
      cost: [...costs.entries()]
        .map(([currency, value]) => formatCurrency(value, currency))
        .join(' + '),
    };
  })();

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
      setDeletingId(null);
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
      setDeletingId(null);
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
          'Fuel receipts could not be refreshed. Existing data is retained, but new entries and changes are paused until refresh succeeds.',
      });
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [setLoadedVesselId, setLoading, setStoredAllocationSnapshot, setStoredLogs, vesselId]);

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
  const onEdit = (log: FuelLog) =>
    navigation.navigate('AddEditFuelLog', {
      logId: log.id,
      correctionOperationId: log.currentInventoryOperationId ?? undefined,
    });

  const deleteReceipt = async (target: FuelLog) => {
    if (
      !vesselId ||
      deletingId ||
      !canManageSetup ||
      currentLoadError ||
      target.vesselId !== vesselId
    )
      return;
    const targetVesselId = vesselId;
    setDeletingId(target.id);
    try {
      await fuelManagementService.voidFuelLog(target.id, {
        expectedRevision: target.inventoryRevision ?? 0,
        reason: 'Deleted by user',
      });
      if (requestedVesselId.current !== targetVesselId) return;
      await loadLogs();
      Alert.alert('Fuel receipt deleted.');
    } catch (error) {
      if (requestedVesselId.current !== targetVesselId) return;
      if (__DEV__) console.warn('Delete fuel receipt warning:', error);
      Alert.alert(
        'Could not delete fuel receipt',
        error instanceof Error ? error.message : 'Refresh the receipts and try again.'
      );
    } finally {
      if (requestedVesselId.current === targetVesselId) setDeletingId(null);
    }
  };

  const confirmDelete = (target: FuelLog) => {
    Alert.alert('Delete this fuel receipt?', 'This will remove the receipt from the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteReceipt(target) },
    ]);
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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {exportMode && (
          <ExportBar
            count={selectedIds.size}
            onConfirm={onExportPdf}
            exporting={exportingPdf}
            hint="Tap logs to select"
          />
        )}
        {logs.length > 0 && !loading && !waitingForCurrentVessel ? (
          <View
            style={[
              styles.summaryPanel,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <View style={styles.summaryHeader}>
              <Text style={[styles.summaryTitle, { color: themeColors.textPrimary }]}>
                Receipt summary
              </Text>
              <View style={[styles.receiptCount, { backgroundColor: themeColors.controlSelected }]}>
                <Text style={styles.receiptCountText}>
                  {logs.length} {logs.length === 1 ? 'receipt' : 'receipts'}
                </Text>
              </View>
            </View>
            <View style={styles.summaryMetrics}>
              <View
                style={[
                  styles.summaryMetric,
                  { backgroundColor: themeColors.background, borderColor: themeColors.border },
                ]}
              >
                <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                  Total fuel
                </Text>
                <Text style={[styles.summaryValue, { color: themeColors.textPrimary }]}>
                  {receiptSummary.volume || '—'}
                </Text>
              </View>
              <View
                style={[
                  styles.summaryMetric,
                  { backgroundColor: themeColors.background, borderColor: themeColors.border },
                ]}
              >
                <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                  Total cost
                </Text>
                <Text style={[styles.summaryValue, { color: themeColors.accent }]}>
                  {receiptSummary.cost || '—'}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
        <View style={styles.actionBar}>
          <Button
            title="Add Receipt"
            onPress={onAdd}
            variant="primary"
            style={styles.actionBtn}
            disabled={!!currentLoadError}
          />
        </View>

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
          <View style={[styles.listContent, filteredLogs.length === 0 && styles.emptyContent]}>
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
                    headerLeft={
                      <View style={styles.receiptHeaderCopy}>
                        <Text
                          style={[
                            styles.receiptLocation,
                            { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                          ]}
                          numberOfLines={1}
                        >
                          {log.locationOfRefueling || 'Location not recorded'}
                        </Text>
                        <Text style={[styles.receiptDate, { color: themeColors.textSecondary }]}>
                          {log.logDate || 'Date not recorded'}
                          {log.logTime ? `  •  ${log.logTime}` : ''}
                        </Text>
                      </View>
                    }
                    showCheckbox={exportMode}
                    checked={selected}
                    onToggleSelect={() => toggleSelect(log.id)}
                    selected={exportMode && selected}
                    onEdit={canManageSetup && !currentLoadError ? () => onEdit(log) : undefined}
                    onDelete={
                      canManageSetup && !exportMode && !currentLoadError
                        ? () => confirmDelete(log)
                        : undefined
                    }
                    footer={log.createdByName ? `Logged by ${log.createdByName}` : undefined}
                    collapsible={!exportMode}
                    expanded={expandedId === log.id}
                    onToggleExpand={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    summary={
                      <View style={[styles.statsRow, { backgroundColor: themeColors.background }]}>
                        <View style={styles.statBox}>
                          <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                            Fuel received
                          </Text>
                          <Text
                            style={[styles.statValue, { color: themeColors.textPrimary }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                          >
                            {formatVolume(log.amountOfFuel)} {volumeLabel(log)}
                          </Text>
                        </View>
                        <View
                          style={[styles.statDivider, { backgroundColor: themeColors.border }]}
                        />
                        <View style={styles.statBox}>
                          <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                            Price
                          </Text>
                          <Text
                            style={[styles.statValue, { color: themeColors.textPrimary }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                          >
                            {formatCurrency(log.pricePerVolumeUnit, log.currencyCode)}
                          </Text>
                        </View>
                        <View
                          style={[styles.statDivider, { backgroundColor: themeColors.border }]}
                        />
                        <View style={styles.statBox}>
                          <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                            Total
                          </Text>
                          <Text
                            style={[
                              styles.statValue,
                              styles.totalValue,
                              { color: themeColors.accent },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                          >
                            {formatCurrency(log.totalPrice, log.currencyCode)}
                          </Text>
                        </View>
                      </View>
                    }
                  >
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
                              style={[
                                styles.allocationTankName,
                                { color: themeColors.textPrimary },
                              ]}
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
                        <Text
                          style={[styles.unallocatedText, { color: themeColors.textSecondary }]}
                        >
                          {log.volumeUnit === null
                            ? 'No tank allocation was recorded for this earlier receipt.'
                            : 'No tank allocation recorded.'}
                        </Text>
                      )}
                    </View>
                    <ButtonTagRow label="Comment" value={log.comment ?? ''} />
                  </ButtonTagCard>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  summaryPanel: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    padding: SPACING.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  summaryTitle: { fontSize: FONTS.lg, fontWeight: '800' },
  receiptCount: {
    borderRadius: 999,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  receiptCountText: { color: COLORS.white, fontSize: FONTS.xs, fontWeight: '800' },
  summaryMetrics: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  summaryMetric: {
    flex: 1,
    minWidth: 0,
    minHeight: 82,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  summaryValue: {
    fontSize: FONTS.base,
    fontWeight: '800',
    lineHeight: 21,
    textAlign: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  actionBtn: { flex: 1 },
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
  loader: { minHeight: 280, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: SPACING.lg },
  emptyContent: { minHeight: 320, justifyContent: 'center' },
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
  receiptHeaderCopy: { flex: 1, minWidth: 0 },
  receiptLocation: { fontSize: FONTS.lg, fontWeight: '800' },
  receiptDate: { fontSize: FONTS.xs, marginTop: 3 },
  statsRow: {
    flexDirection: 'row',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  statBox: { flex: 1, minWidth: 0, paddingHorizontal: SPACING.xs },
  statDivider: { width: 1, marginVertical: 2 },
  statLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    height: 32,
    lineHeight: 14,
    marginBottom: 2,
  },
  statValue: { fontSize: FONTS.sm, fontWeight: '700', lineHeight: 18, height: 20 },
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
