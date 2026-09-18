/**
 * Fuel Log Screen
 * List of fuel log entries with Add, Edit, Delete, and selective PDF export.
 */

import React, { useState, useCallback } from 'react';
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
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [allocationSnapshot, setAllocationSnapshot] =
    useState<FuelLogAllocationSnapshot>(EMPTY_ALLOCATION_SNAPSHOT);

  const vesselId = user?.vesselId ?? null;
  const canManageSetup = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';

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
    if (!vesselId) return;
    try {
      const [data, nextAllocationSnapshot] = await Promise.all([
        fuelLogsService.getByVessel(vesselId),
        fuelManagementService.getFuelLogAllocationSnapshot(vesselId),
      ]);
      setLogs(data);
      setAllocationSnapshot(nextAllocationSnapshot);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Load fuel logs error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadLogs();
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

  const onDelete = (log: FuelLog) => {
    Alert.alert(
      'Delete entry',
      `Delete fuel log entry for ${log.locationOfRefueling || log.logDate}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await fuelLogsService.delete(log.id);
              loadLogs();
            } catch {
              Alert.alert('Error', 'Could not delete entry.');
            }
          },
        },
      ]
    );
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
        title="Fuel Log"
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
        <Button title="Add Log" onPress={onAdd} variant="primary" style={styles.actionBtn} />
        <Button
          title="Transfers"
          onPress={() => navigation.navigate('FuelTransfers')}
          variant="outline"
          style={styles.actionBtn}
        />
      </View>
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

      {loading ? (
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
                {logs.length === 0 ? 'No entries yet' : 'No matching entries'}
              </Text>
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
                {logs.length === 0
                  ? 'Tap "Add Log" to record your first fuel entry.'
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
                  onEdit={() => onEdit(log)}
                  onDelete={() => onDelete(log)}
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
