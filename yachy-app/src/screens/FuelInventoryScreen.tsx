import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, LoadingSpinner, PageHeader } from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import type {
  FuelInventoryLedgerPosting,
  FuelInventoryOperation,
  FuelInventorySnapshot,
  FuelVolumeUnit,
} from '../types';
import {
  formatFuelEventDateTime,
  fuelOperationAuditLabel,
  fuelOperationAmountLitres,
  fuelOperationPostingBreakdown,
} from '../utils/fuelInventoryPresentation';
import { fromLitres } from '../utils/fuelUnits';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function unitLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

const HIDDEN_MANUAL_INVENTORY_KINDS = new Set(['OPENING', 'SOUNDING', 'CONSUMPTION', 'ADJUSTMENT']);

function isHiddenManualInventoryRecord(record: FuelInventoryOperation): boolean {
  return HIDDEN_MANUAL_INVENTORY_KINDS.has(record.kind);
}

function historyKind(record: FuelInventoryOperation): string {
  return record.kind;
}

function historyLabel(kind: string): string {
  const labels: Record<string, string> = {
    OPENING: 'Opening level',
    REFUEL: 'Fuel received',
    TRANSFER: 'Tank transfer',
    SOUNDING: 'Tank sounding',
    CONSUMPTION: 'Fuel consumed',
    ADJUSTMENT: 'Manual adjustment',
    REVERSAL: 'Record change',
  };
  return labels[kind] ?? 'Fuel activity';
}

function historyIcon(kind: string): keyof typeof Ionicons.glyphMap {
  const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
    OPENING: 'flag-outline',
    REFUEL: 'add-circle-outline',
    TRANSFER: 'swap-horizontal-outline',
    SOUNDING: 'analytics-outline',
    CONSUMPTION: 'remove-circle-outline',
    ADJUSTMENT: 'options-outline',
    REVERSAL: 'return-up-back-outline',
  };
  return icons[kind] ?? 'water-outline';
}

function postingTankName(posting: FuelInventoryLedgerPosting | undefined): string {
  return posting?.tankName ?? '';
}

function historyTitle(record: FuelInventoryOperation): string {
  const kind = historyKind(record);
  const metadata = record.metadata;
  const postings = record.postings;
  if (kind === 'TRANSFER' && postings.length >= 2) {
    const source = postings.find((item) => item.amountLitres < 0);
    const destination = postings.find((item) => item.amountLitres > 0);
    const sourceName = source ? postingTankName(source) : '';
    const destinationName = destination ? postingTankName(destination) : '';
    if (sourceName && destinationName) return `${sourceName} → ${destinationName}`;
  }
  if ((kind === 'OPENING' || kind === 'REFUEL') && postings.length > 1) {
    return `${postings.length} tanks`;
  }
  return (
    asString(metadata.summary || metadata.tankName) ||
    postingTankName(postings[0]) ||
    historyLabel(kind)
  );
}

function historyAmount(record: FuelInventoryOperation, unit: FuelVolumeUnit): string {
  const amount = fuelOperationAmountLitres(record);
  if (amount == null || !Number.isFinite(amount)) return '';
  const converted = fromLitres(amount, unit);
  const rendered = `${record.kind === 'ADJUSTMENT' && converted > 0 ? '+' : ''}${formatVolume(
    converted
  )} ${unitLabel(unit)}`;
  return record.kind === 'SOUNDING' ? `${rendered} measured` : rendered;
}

function HistoryCard({
  record,
  unit,
  canManage,
  onEdit,
  onDelete,
}: {
  record: FuelInventoryOperation;
  unit: FuelVolumeUnit;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const themeColors = useThemeColors();
  const kind = historyKind(record);
  const occurredAt = record.effectiveAt;
  const recordedAt = record.recordedAt;
  const actor = record.createdByName;
  const metadata = record.metadata;
  const reason = asString(metadata.reason || metadata.notes || metadata.location);
  const amendmentReason = asString(metadata.amendment_reason || metadata.amendmentReason);
  const amount = historyAmount(record, unit);
  const postingBreakdown = fuelOperationPostingBreakdown(record);
  const isCurrent = record.status === 'POSTED';

  return (
    <View
      style={[
        styles.historyCard,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border },
      ]}
    >
      <View style={[styles.historyIcon, { backgroundColor: themeColors.accentSoft }]}>
        <Ionicons name={historyIcon(kind)} size={20} color={themeColors.accent} />
      </View>
      <View style={styles.historyCopy}>
        <View style={styles.historyHeading}>
          <View style={styles.historyHeadingCopy}>
            <Text style={[styles.historyKind, { color: themeColors.accent }]}>
              {fuelOperationAuditLabel(record)}
            </Text>
            <Text style={[styles.historyTitle, { color: themeColors.textPrimary }]}>
              {historyTitle(record)}
            </Text>
          </View>
          {amount ? (
            <Text style={[styles.historyAmount, { color: themeColors.textPrimary }]}>{amount}</Text>
          ) : null}
        </View>
        {occurredAt ? (
          <Text style={[styles.historyMeta, { color: themeColors.textSecondary }]}>
            Date and time: {formatFuelEventDateTime(occurredAt, record.utcOffsetMinutes)}
          </Text>
        ) : null}
        {reason ? (
          <Text style={[styles.historyReason, { color: themeColors.textPrimary }]}>{reason}</Text>
        ) : null}
        {postingBreakdown.length > 0 ? (
          <View style={[styles.postingBreakdown, { borderColor: themeColors.border }]}>
            {postingBreakdown.map((posting) => (
              <View key={posting.tankId} style={styles.postingRow}>
                <Text style={[styles.postingTank, { color: themeColors.textSecondary }]}>
                  {posting.tankName}
                </Text>
                <Text style={[styles.postingAmount, { color: themeColors.textPrimary }]}>
                  {formatVolume(fromLitres(posting.amountLitres, unit))} {unitLabel(unit)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {amendmentReason && amendmentReason !== 'Edited by user' ? (
          <Text style={[styles.historyReason, { color: themeColors.textPrimary }]}>
            Edit reason: {amendmentReason}
          </Text>
        ) : null}
        {record.voided && record.voidReason && record.voidReason !== 'Deleted by user' ? (
          <Text style={[styles.historyReason, { color: COLORS.danger }]}>
            {record.status === 'REPLACED' ? 'Edit reason' : 'Deletion reason'}: {record.voidReason}
          </Text>
        ) : null}
        {recordedAt || actor ? (
          <Text style={[styles.historyAudit, { color: themeColors.textMuted }]}>
            {[
              actor ? `Recorded by ${actor}` : '',
              recordedAt ? formatFuelEventDateTime(recordedAt, null) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        {record.voidedAt || record.voidedByName ? (
          <Text style={[styles.historyAudit, { color: themeColors.textMuted }]}>
            {[
              record.voidedByName
                ? `${record.status === 'REPLACED' ? 'Edited' : 'Deleted'} by ${record.voidedByName}`
                : '',
              record.voidedAt ? formatFuelEventDateTime(record.voidedAt, null) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        {canManage && isCurrent ? (
          <View style={styles.historyActions}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onEdit}
              style={[styles.historyAction, { borderColor: themeColors.border }]}
            >
              <Ionicons name="create-outline" size={16} color={themeColors.accent} />
              <Text style={[styles.historyActionText, { color: themeColors.accent }]}>Edit</Text>
            </TouchableOpacity>
            {record.kind !== 'OPENING' ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onDelete}
                style={[styles.historyAction, { borderColor: COLORS.danger }]}
              >
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                <Text style={[styles.historyActionText, { color: COLORS.danger }]}>Delete</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ActionCard({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const themeColors = useThemeColors();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      activeOpacity={0.75}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionCard,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border },
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: themeColors.accentSoft }]}>
        <Ionicons name={icon} size={22} color={themeColors.accent} />
      </View>
      <Text style={[styles.actionLabel, { color: themeColors.textPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export const FuelInventoryScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canManage = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedVesselId, setLoadedVesselId] = useState<string | null>(null);
  const [storedSnapshot, setStoredSnapshot] = useState<FuelInventorySnapshot | null>(null);
  const [storedHistory, setStoredHistory] = useState<FuelInventoryOperation[]>([]);
  const [storedNextBeforeSequence, setStoredNextBeforeSequence] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<{ vesselId: string; message: string } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FuelInventoryOperation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadGeneration = useRef(0);
  const currentVesselId = useRef(vesselId);
  currentVesselId.current = vesselId;

  useEffect(() => {
    setDeleteTarget(null);
    setDeleting(false);
  }, [vesselId]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadingOlder(false);
    setHistoryLoadError(null);
    if (!vesselId) {
      setLoadedVesselId(null);
      setStoredSnapshot(null);
      setStoredHistory([]);
      setStoredNextBeforeSequence(null);
      setLoadError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [nextSnapshot, nextHistory] = await Promise.all([
        fuelManagementService.getInventorySnapshot(vesselId),
        fuelManagementService.getInventoryHistory(vesselId),
      ]);
      if (generation !== loadGeneration.current) return;
      setStoredSnapshot(nextSnapshot);
      setStoredHistory(nextHistory.operations);
      setStoredNextBeforeSequence(nextHistory.nextBeforeSequence);
      setLoadedVesselId(vesselId);
      setLoadError(null);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel inventory error:', error);
      setLoadError({
        vesselId,
        message:
          'Fuel inventory could not be refreshed. Existing figures are retained, but recording and changes are paused until the data refreshes.',
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
      load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load])
  );

  const snapshot = loadedVesselId === vesselId ? storedSnapshot : null;
  const history =
    loadedVesselId === vesselId
      ? storedHistory.filter((record) => !isHiddenManualInventoryRecord(record))
      : [];
  const nextBeforeSequence = loadedVesselId === vesselId ? storedNextBeforeSequence : null;
  const currentLoadError = loadError?.vesselId === vesselId ? loadError.message : null;
  const waitingForCurrentVessel = loadedVesselId !== vesselId && !currentLoadError;

  const unit = snapshot?.displayUnit ?? 'LITRES';
  const inventoryReady = !!snapshot?.allTanksInitialized;
  const reportOnlyMode = snapshot?.status === 'NOT_ACTIVATED';
  const totalPercentage = useMemo(() => {
    if (!snapshot || !inventoryReady || snapshot.totalCapacityLitres <= 0) return 0;
    return Math.max(
      0,
      Math.min(100, ((snapshot.totalBalanceLitres ?? 0) / snapshot.totalCapacityLitres) * 100)
    );
  }, [inventoryReady, snapshot]);

  const usableTankCount = snapshot?.tanks.filter((item) => item.initialized).length ?? 0;

  const loadOlderHistory = async () => {
    if (
      !vesselId ||
      !nextBeforeSequence ||
      loadingOlder ||
      currentLoadError ||
      loadedVesselId !== vesselId
    ) {
      return;
    }
    const generation = loadGeneration.current;
    setLoadingOlder(true);
    setHistoryLoadError(null);
    try {
      const nextPage = await fuelManagementService.getInventoryHistory(vesselId, {
        beforeRecordedSequence: nextBeforeSequence,
      });
      if (generation !== loadGeneration.current) return;
      setStoredHistory((current) => {
        const existingIds = new Set(current.map((record) => record.id));
        return [...current, ...nextPage.operations.filter((record) => !existingIds.has(record.id))];
      });
      setStoredNextBeforeSequence(nextPage.nextBeforeSequence);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load older fuel inventory history error:', error);
      setHistoryLoadError('Older fuel activity could not be loaded. Please try again.');
    } finally {
      if (generation === loadGeneration.current) setLoadingOlder(false);
    }
  };

  const openFuelReceipt = () => {
    const configuredTankCount = snapshot?.tanks.length ?? 0;
    if (configuredTankCount > 0 || canManage) {
      navigation.navigate('AddEditFuelLog', {});
      return;
    }
    Alert.alert(
      'Fuel setup required',
      'Ask an HOD or Captain MOV to configure a vessel fuel tank.'
    );
  };

  const openFuelTransfer = () => {
    if (reportOnlyMode) {
      if ((snapshot?.tanks.length ?? 0) >= 2) {
        navigation.navigate('FuelTransfer');
      } else {
        Alert.alert(
          'Two tanks required',
          'Configure at least two vessel fuel tanks before recording a report-only transfer.',
          canManage
            ? [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Fuel Setup', onPress: () => navigation.navigate('FuelSetup') },
              ]
            : [{ text: 'OK' }]
        );
      }
      return;
    }
    if (usableTankCount >= 2) {
      navigation.navigate('FuelTransfer');
      return;
    }
    Alert.alert(
      'Fuel transfer unavailable',
      'At least two tanks with current quantities are required to calculate a fuel transfer.'
    );
  };

  const editOperation = (record: FuelInventoryOperation) => {
    if (record.kind === 'REFUEL' && record.sourceFuelLogId) {
      navigation.navigate('AddEditFuelLog', {
        logId: record.sourceFuelLogId,
        correctionOperationId: record.id,
      });
    } else if (record.kind === 'TRANSFER' && record.sourceTransferId) {
      navigation.navigate('FuelTransfer', {
        transferId: record.sourceTransferId,
        correctionOperationId: record.id,
      });
    } else {
      Alert.alert('Edit unavailable', 'Refresh the fuel history and try again.');
    }
  };

  const confirmDelete = async () => {
    if (
      !deleteTarget ||
      !vesselId ||
      deleteTarget.vesselId !== vesselId ||
      deleting ||
      !canManage ||
      currentLoadError
    ) {
      return;
    }
    const target = deleteTarget;
    const targetVesselId = vesselId;
    const actionReason = 'Deleted by user';
    setDeleting(true);
    try {
      if (target.kind === 'REFUEL' && target.sourceFuelLogId) {
        await fuelManagementService.voidFuelLog(target.sourceFuelLogId, {
          expectedRevision: target.revisionNo,
          reason: actionReason,
        });
      } else if (target.kind === 'TRANSFER' && target.sourceTransferId) {
        await fuelManagementService.deleteTransfer(target.sourceTransferId, {
          expectedRevision: target.revisionNo,
          reason: actionReason,
        });
      } else if (
        target.kind === 'SOUNDING' ||
        target.kind === 'CONSUMPTION' ||
        target.kind === 'ADJUSTMENT'
      ) {
        await fuelManagementService.voidInventoryEntry({
          operationId: target.id,
          expectedRevision: target.revisionNo,
          reason: actionReason,
        });
      } else {
        throw new Error('This fuel record cannot be deleted here.');
      }
      if (currentVesselId.current !== targetVesselId) return;
      setDeleteTarget(null);
      await load();
      Alert.alert(target.kind === 'TRANSFER' ? 'Fuel transfer deleted.' : 'Fuel record deleted.');
    } catch (error) {
      if (currentVesselId.current !== targetVesselId) return;
      if (__DEV__) console.warn('Update fuel inventory operation warning:', error);
      Alert.alert(
        target.kind === 'TRANSFER'
          ? 'Could not delete fuel transfer'
          : 'Could not delete fuel record',
        error instanceof Error ? error.message : 'Refresh the fuel history and try again.'
      );
    } finally {
      if (currentVesselId.current === targetVesselId) setDeleting(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to view its fuel inventory.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Fuel" />
      {loading || waitingForCurrentVessel ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : currentLoadError && loadedVesselId !== vesselId ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.warning} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Could not load fuel inventory
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            No inventory data is being shown for this vessel until a verified refresh succeeds.
          </Text>
          <Button title="Retry" onPress={load} style={styles.centerAction} />
        </View>
      ) : !snapshot || snapshot.tanks.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[COLORS.primary]}
              tintColor={themeColors.accent}
            />
          }
        >
          {currentLoadError ? (
            <View
              style={[
                styles.loadErrorCard,
                { backgroundColor: themeColors.surface, borderColor: COLORS.warning },
              ]}
            >
              <Ionicons name="cloud-offline-outline" size={22} color={COLORS.warning} />
              <Text style={[styles.loadErrorText, { color: themeColors.textPrimary }]}>
                {currentLoadError}
              </Text>
              <TouchableOpacity accessibilityRole="button" onPress={load}>
                <Text style={[styles.loadErrorAction, { color: themeColors.accent }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={[styles.emptyActivity, { backgroundColor: themeColors.surface }]}>
            <Ionicons name="water-outline" size={48} color={themeColors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
              No fuel tanks
            </Text>
            <Text style={[styles.message, { color: themeColors.textSecondary }]}>
              {canManage
                ? 'Configure the vessel tanks before recording fuel inventory.'
                : 'An HOD or Captain MOV must configure the vessel tanks first.'}
            </Text>
            <Button
              title={canManage ? 'Set Up Fuel Tanks' : 'View Fuel Setup'}
              onPress={() => navigation.navigate('FuelSetup')}
              style={styles.centerAction}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[COLORS.primary]}
              tintColor={themeColors.accent}
            />
          }
        >
          {currentLoadError ? (
            <View
              style={[
                styles.loadErrorCard,
                { backgroundColor: themeColors.surface, borderColor: COLORS.warning },
              ]}
            >
              <Ionicons name="cloud-offline-outline" size={22} color={COLORS.warning} />
              <Text style={[styles.loadErrorText, { color: themeColors.textPrimary }]}>
                {currentLoadError}
              </Text>
              <TouchableOpacity accessibilityRole="button" onPress={load}>
                <Text style={[styles.loadErrorAction, { color: themeColors.accent }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={[styles.totalCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.eyebrow, { color: themeColors.textSecondary }]}>
              Calculated fuel on board
            </Text>
            <Text style={[styles.totalValue, { color: themeColors.textPrimary }]}>
              {inventoryReady
                ? `${formatVolume(fromLitres(snapshot.totalBalanceLitres ?? 0, unit))} ${unitLabel(unit)}`
                : 'Not available'}
            </Text>
            <Text style={[styles.totalCapacity, { color: themeColors.textSecondary }]}>
              {inventoryReady
                ? `of ${formatVolume(fromLitres(snapshot.totalCapacityLitres, unit))} ${unitLabel(unit)} capacity`
                : 'Initialize every tank to calculate a vessel total.'}
            </Text>
            <View style={[styles.progressTrack, { backgroundColor: themeColors.surfaceAlt }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${totalPercentage}%`, backgroundColor: themeColors.controlSelected },
                ]}
              />
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Tank levels</Text>
          <View style={styles.tankList}>
            {snapshot.tanks.map((item) => {
              const balance = item.balanceLitres;
              const capacity = item.tank.capacityLitres;
              const percentage =
                item.initialized && balance != null && capacity > 0
                  ? Math.max(0, Math.min(100, (balance / capacity) * 100))
                  : 0;
              return (
                <View
                  key={item.tank.id}
                  style={[
                    styles.tankCard,
                    { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                  ]}
                >
                  <View style={styles.tankHeading}>
                    <View style={styles.tankNameWrap}>
                      <Text style={[styles.tankName, { color: themeColors.textPrimary }]}>
                        {item.tank.name}
                      </Text>
                      {item.tank.location ? (
                        <Text style={[styles.tankLocation, { color: themeColors.textSecondary }]}>
                          {item.tank.location}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.tankBalance, { color: themeColors.textPrimary }]}>
                      {item.initialized && balance != null
                        ? `${formatVolume(fromLitres(balance, unit))} ${unitLabel(unit)}`
                        : 'Unknown'}
                    </Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: themeColors.surfaceAlt }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${percentage}%`, backgroundColor: themeColors.controlSelected },
                      ]}
                    />
                  </View>
                  <View style={styles.tankMetaRow}>
                    <Text style={[styles.tankMeta, { color: themeColors.textSecondary }]}>
                      Capacity {formatVolume(fromLitres(capacity, unit))} {unitLabel(unit)}
                    </Text>
                    {item.initialized && item.remainingCapacityLitres != null ? (
                      <Text style={[styles.tankMeta, { color: themeColors.textSecondary }]}>
                        {formatVolume(fromLitres(item.remainingCapacityLitres, unit))}{' '}
                        {unitLabel(unit)} free
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Record</Text>
          <View style={styles.actionGrid}>
            <ActionCard
              icon="add-circle-outline"
              label="Receive Fuel"
              onPress={openFuelReceipt}
              disabled={!!currentLoadError}
            />
            <ActionCard
              icon="swap-horizontal-outline"
              label="Transfer Fuel"
              onPress={openFuelTransfer}
              disabled={!!currentLoadError}
            />
            <ActionCard
              icon="time-outline"
              label="Fueling History"
              onPress={() => navigation.navigate('FuelHistory')}
            />
            <ActionCard
              icon="settings-outline"
              label={canManage ? 'Fuel Setup' : 'View Setup'}
              onPress={() => navigation.navigate('FuelSetup')}
            />
          </View>

          <View style={styles.historyHeader}>
            <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
              Activity history
            </Text>
          </View>
          {history.length === 0 ? (
            <View style={[styles.emptyActivity, { backgroundColor: themeColors.surface }]}>
              <Ionicons name="time-outline" size={32} color={themeColors.textSecondary} />
              <Text style={[styles.emptyActivityTitle, { color: themeColors.textPrimary }]}>
                No inventory activity yet
              </Text>
              <Text style={[styles.message, { color: themeColors.textSecondary }]}>
                Tank transfers will appear here.
              </Text>
            </View>
          ) : (
            history.map((record, index) => (
              <HistoryCard
                key={record.id || `history-${index}`}
                record={record}
                unit={unit}
                canManage={canManage && !currentLoadError}
                onEdit={() => editOperation(record)}
                onDelete={() => setDeleteTarget(record)}
              />
            ))
          )}
          {historyLoadError ? (
            <Text style={[styles.historyLoadError, { color: COLORS.danger }]}>
              {historyLoadError}
            </Text>
          ) : null}
          {nextBeforeSequence ? (
            <Button
              title="Load Older Activity"
              variant="outline"
              onPress={loadOlderHistory}
              loading={loadingOlder}
              disabled={loadingOlder || !!currentLoadError}
              style={styles.loadOlderButton}
            />
          ) : null}
        </ScrollView>
      )}
      <Modal
        visible={!!deleteTarget && deleteTarget.vesselId === vesselId}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setDeleteTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !deleting && setDeleteTarget(null)}
          />
          <View style={[styles.modalCard, { backgroundColor: themeColors.surface }]}>
            <View style={styles.modalIcon}>
              <Ionicons name="warning-outline" size={26} color={COLORS.danger} />
            </View>
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              {deleteTarget?.kind === 'TRANSFER'
                ? 'Delete this fuel transfer?'
                : 'Delete this fuel record?'}
            </Text>
            <Text style={[styles.modalText, { color: themeColors.textSecondary }]}>
              {deleteTarget?.kind === 'TRANSFER'
                ? 'This will remove the transfer and recalculate both affected tank balances.'
                : 'This will remove the record from the app and recalculate any affected tank balances.'}
            </Text>
            <View style={styles.modalButtons}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setDeleteTarget(null)}
                disabled={deleting}
                style={styles.modalButton}
              />
              <Button
                title={deleteTarget?.kind === 'TRANSFER' ? 'Delete Transfer' : 'Delete Record'}
                variant="danger"
                onPress={confirmDelete}
                loading={deleting}
                disabled={deleting}
                style={styles.modalButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  centerAction: { marginTop: SPACING.lg, minWidth: 200 },
  message: { fontSize: FONTS.base, lineHeight: 22, textAlign: 'center' },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  warningCard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  warningCopy: { flex: 1 },
  loadErrorCard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  loadErrorText: { flex: 1, fontSize: FONTS.sm, lineHeight: 19 },
  loadErrorAction: { fontSize: FONTS.sm, fontWeight: '700' },
  warningTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.xs },
  warningText: { fontSize: FONTS.sm, lineHeight: 20 },
  warningAction: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm },
  warningActionText: { fontSize: FONTS.sm, fontWeight: '700' },
  managerHint: { fontSize: FONTS.xs, marginTop: SPACING.sm, lineHeight: 18 },
  totalCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  eyebrow: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalValue: { fontSize: 34, fontWeight: '800', marginTop: SPACING.xs },
  totalCapacity: { fontSize: FONTS.sm, marginTop: 2, marginBottom: SPACING.md },
  progressTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  sectionTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.md },
  tankList: { gap: SPACING.md, marginBottom: SPACING.xl },
  tankCard: { borderWidth: 1, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  tankHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  tankNameWrap: { flex: 1 },
  tankName: { fontSize: FONTS.base, fontWeight: '700' },
  tankLocation: { fontSize: FONTS.sm, marginTop: 2 },
  tankBalance: { fontSize: FONTS.lg, fontWeight: '800', textAlign: 'right' },
  tankMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  tankMeta: { fontSize: FONTS.xs },
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  verificationText: { flex: 1, fontSize: FONTS.xs, lineHeight: 18 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.xl },
  actionCard: {
    width: '48%',
    minHeight: 88,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    justifyContent: 'center',
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  actionLabel: { fontSize: FONTS.sm, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    flexDirection: 'row',
    gap: SPACING.md,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCopy: { flex: 1 },
  historyHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  historyHeadingCopy: { flex: 1 },
  historyKind: {
    fontSize: FONTS.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  historyTitle: { fontSize: FONTS.base, fontWeight: '700', marginTop: 2 },
  historyAmount: { fontSize: FONTS.sm, fontWeight: '700', textAlign: 'right' },
  historyMeta: { fontSize: FONTS.xs, marginTop: SPACING.xs },
  historyReason: { fontSize: FONTS.sm, marginTop: SPACING.xs, lineHeight: 19 },
  postingBreakdown: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: SPACING.sm,
    paddingTop: SPACING.xs,
    gap: 3,
  },
  postingRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.md },
  postingTank: { flex: 1, fontSize: FONTS.xs },
  postingAmount: { fontSize: FONTS.xs, fontWeight: '700', textAlign: 'right' },
  historyAudit: { fontSize: FONTS.xs, marginTop: SPACING.xs },
  historyActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  historyAction: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  historyActionText: { fontSize: FONTS.sm, fontWeight: '700' },
  historyLoadError: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  loadOlderButton: { alignSelf: 'center', minWidth: 210, marginTop: SPACING.md },
  emptyActivity: { borderRadius: BORDER_RADIUS.lg, alignItems: 'center', padding: SPACING.xl },
  emptyActivityTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalCard: { borderRadius: BORDER_RADIUS.xl, padding: SPACING.lg },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(220,38,38,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  modalTitle: { fontSize: FONTS.xl, fontWeight: '800', marginBottom: SPACING.sm },
  modalText: { fontSize: FONTS.sm, lineHeight: 20, marginBottom: SPACING.md },
  modalButtons: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  modalButton: { flex: 1 },
});
