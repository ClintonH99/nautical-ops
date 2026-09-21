import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Input, LoadingSpinner, PageHeader } from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import type {
  FuelInventoryLedgerPosting,
  FuelInventoryLegacyAudit,
  FuelInventoryLegacyAuditCursor,
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

const HIDDEN_MANUAL_INVENTORY_KINDS = new Set([
  'OPENING',
  'SOUNDING',
  'CONSUMPTION',
  'ADJUSTMENT',
]);

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
    REVERSAL: 'Correction / reversal',
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

function legacySnapshotSummary(
  record: FuelInventoryLegacyAudit,
  snapshot: Record<string, unknown>
): string {
  const date = asString(snapshot.log_date || snapshot.transfer_date);
  const time = asString(snapshot.log_time || snapshot.transfer_time);
  const location = asString(snapshot.location_of_refueling || snapshot.location);
  const amountValue = Number(
    record.sourceType === 'FUEL_LOG' ? snapshot.amount_of_fuel : snapshot.amount_litres
  );
  const receiptUnit =
    snapshot.volume_unit === 'LITRES'
      ? 'L'
      : snapshot.volume_unit === 'US_GALLONS'
        ? 'US gal'
        : 'US gal (legacy)';
  const amount = Number.isFinite(amountValue)
    ? `${formatVolume(amountValue)} ${record.sourceType === 'FUEL_LOG' ? receiptUnit : 'L'}`
    : '';
  const route =
    record.sourceType === 'FUEL_TRANSFER'
      ? [
          asString(snapshot.source_tank_name) || 'Previous source tank',
          asString(snapshot.destination_tank_name) || 'Previous destination tank',
        ].join(' → ')
      : '';
  return [route, [date, time].filter(Boolean).join(' '), amount, location]
    .filter(Boolean)
    .join(' · ');
}

function LegacyAuditCard({ record }: { record: FuelInventoryLegacyAudit }) {
  const themeColors = useThemeColors();
  const sourceLabel = record.sourceType === 'FUEL_LOG' ? 'Receipt' : 'Transfer';
  const actionLabel = record.action === 'VOID' ? 'Voided' : 'Corrected';
  const before = legacySnapshotSummary(record, record.beforeSnapshot);
  const after = legacySnapshotSummary(record, record.afterSnapshot);
  const revisions =
    record.revisionBefore == null || record.revisionAfter == null
      ? ''
      : `Revision ${record.revisionBefore} → ${record.revisionAfter}`;

  return (
    <View
      style={[
        styles.historyCard,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border },
      ]}
    >
      <View style={[styles.historyIcon, { backgroundColor: themeColors.accentSoft }]}>
        <Ionicons
          name={record.action === 'VOID' ? 'close-circle-outline' : 'create-outline'}
          size={20}
          color={record.action === 'VOID' ? COLORS.danger : themeColors.accent}
        />
      </View>
      <View style={styles.historyCopy}>
        <Text
          style={[
            styles.historyKind,
            { color: record.action === 'VOID' ? COLORS.danger : themeColors.accent },
          ]}
        >
          Report-only {sourceLabel}
        </Text>
        <Text style={[styles.historyTitle, { color: themeColors.textPrimary }]}>{actionLabel}</Text>
        {record.action === 'AMENDMENT' && before ? (
          <Text style={[styles.historyMeta, { color: themeColors.textSecondary }]}>
            Before: {before}
          </Text>
        ) : null}
        {after ? (
          <Text style={[styles.historyMeta, { color: themeColors.textSecondary }]}>
            {record.action === 'AMENDMENT' ? 'After' : 'Record'}: {after}
          </Text>
        ) : null}
        <Text style={[styles.historyReason, { color: themeColors.textPrimary }]}>
          Reason: {record.reason}
        </Text>
        <Text style={[styles.historyAudit, { color: themeColors.textMuted }]}>
          {[
            revisions,
            record.createdByName ? `By ${record.createdByName}` : '',
            record.recordedAt ? formatFuelEventDateTime(record.recordedAt, null) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </View>
  );
}

function LegacyAuditSection({
  records,
  nextCursor,
  loadError,
  loadingOlder,
  disabled,
  onLoadOlder,
}: {
  records: FuelInventoryLegacyAudit[];
  nextCursor: FuelInventoryLegacyAuditCursor | null;
  loadError: string | null;
  loadingOlder: boolean;
  disabled: boolean;
  onLoadOlder: () => void;
}) {
  const themeColors = useThemeColors();
  return (
    <View style={styles.legacyAuditBlock}>
      <View style={styles.legacySection}>
        <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
          Report-only record changes
        </Text>
        <Text style={[styles.legacyHint, { color: themeColors.textSecondary }]}>
          Corrections and voids to receipts or transfers created before inventory activation. These
          records are retained for audit and do not change calculated tank balances.
        </Text>
      </View>
      {records.length === 0 ? (
        <View style={[styles.emptyActivity, { backgroundColor: themeColors.surface }]}>
          <Ionicons name="shield-checkmark-outline" size={30} color={themeColors.textSecondary} />
          <Text style={[styles.emptyActivityTitle, { color: themeColors.textPrimary }]}>
            No report-only changes
          </Text>
        </View>
      ) : (
        records.map((record) => <LegacyAuditCard key={record.id} record={record} />)
      )}
      {loadError ? (
        <Text style={[styles.historyLoadError, { color: COLORS.danger }]}>{loadError}</Text>
      ) : null}
      {nextCursor ? (
        <Button
          title="Load Older Record Changes"
          variant="outline"
          onPress={onLoadOlder}
          loading={loadingOlder}
          disabled={loadingOlder || disabled}
          style={styles.loadOlderButton}
        />
      ) : null}
    </View>
  );
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
  onCorrect,
  onVoid,
}: {
  record: FuelInventoryOperation;
  unit: FuelVolumeUnit;
  canManage: boolean;
  onCorrect: () => void;
  onVoid: () => void;
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
        {amendmentReason ? (
          <Text style={[styles.historyReason, { color: themeColors.textPrimary }]}>
            Correction reason: {amendmentReason}
          </Text>
        ) : null}
        {record.voided && record.voidReason ? (
          <Text style={[styles.historyReason, { color: COLORS.danger }]}>
            {record.status === 'REPLACED' ? 'Replacement reason' : 'Void reason'}:{' '}
            {record.voidReason}
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
                ? `${record.status === 'REPLACED' ? 'Replaced' : 'Voided'} by ${record.voidedByName}`
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
              onPress={onCorrect}
              style={[styles.historyAction, { borderColor: themeColors.border }]}
            >
              <Ionicons name="create-outline" size={16} color={themeColors.accent} />
              <Text style={[styles.historyActionText, { color: themeColors.accent }]}>Correct</Text>
            </TouchableOpacity>
            {record.kind !== 'OPENING' ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onVoid}
                style={[styles.historyAction, { borderColor: COLORS.danger }]}
              >
                <Ionicons name="close-circle-outline" size={16} color={COLORS.danger} />
                <Text style={[styles.historyActionText, { color: COLORS.danger }]}>Void</Text>
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
  const [storedLegacyAudits, setStoredLegacyAudits] = useState<FuelInventoryLegacyAudit[]>([]);
  const [storedLegacyCursor, setStoredLegacyCursor] =
    useState<FuelInventoryLegacyAuditCursor | null>(null);
  const [loadError, setLoadError] = useState<{ vesselId: string; message: string } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [loadingOlderLegacy, setLoadingOlderLegacy] = useState(false);
  const [legacyLoadError, setLegacyLoadError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<FuelInventoryOperation | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const loadGeneration = useRef(0);
  const currentVesselId = useRef(vesselId);
  currentVesselId.current = vesselId;

  useEffect(() => {
    setVoidTarget(null);
    setVoidReason('');
    setVoiding(false);
  }, [vesselId]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadingOlder(false);
    setLoadingOlderLegacy(false);
    setHistoryLoadError(null);
    setLegacyLoadError(null);
    if (!vesselId) {
      setLoadedVesselId(null);
      setStoredSnapshot(null);
      setStoredHistory([]);
      setStoredNextBeforeSequence(null);
      setStoredLegacyAudits([]);
      setStoredLegacyCursor(null);
      setLoadError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [nextSnapshot, nextHistory, nextLegacyHistory] = await Promise.all([
        fuelManagementService.getInventorySnapshot(vesselId),
        fuelManagementService.getInventoryHistory(vesselId),
        fuelManagementService.getLegacyInventoryAudits(vesselId),
      ]);
      if (generation !== loadGeneration.current) return;
      setStoredSnapshot(nextSnapshot);
      setStoredHistory(nextHistory.operations);
      setStoredNextBeforeSequence(nextHistory.nextBeforeSequence);
      setStoredLegacyAudits(nextLegacyHistory.audits);
      setStoredLegacyCursor(nextLegacyHistory.nextCursor);
      setLoadedVesselId(vesselId);
      setLoadError(null);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel inventory error:', error);
      setLoadError({
        vesselId,
        message:
          'Fuel inventory could not be refreshed. Existing figures are retained, but recording and corrections are paused until the data refreshes.',
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
  const legacyAudits = loadedVesselId === vesselId ? storedLegacyAudits : [];
  const legacyCursor = loadedVesselId === vesselId ? storedLegacyCursor : null;
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

  const loadOlderLegacyAudits = async () => {
    if (
      !vesselId ||
      !legacyCursor ||
      loadingOlderLegacy ||
      currentLoadError ||
      loadedVesselId !== vesselId
    ) {
      return;
    }
    const generation = loadGeneration.current;
    setLoadingOlderLegacy(true);
    setLegacyLoadError(null);
    try {
      const nextPage = await fuelManagementService.getLegacyInventoryAudits(vesselId, {
        before: legacyCursor,
      });
      if (generation !== loadGeneration.current) return;
      setStoredLegacyAudits((current) => {
        const existingIds = new Set(current.map((record) => record.id));
        return [...current, ...nextPage.audits.filter((record) => !existingIds.has(record.id))];
      });
      setStoredLegacyCursor(nextPage.nextCursor);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load older legacy fuel audits error:', error);
      setLegacyLoadError('Older report-only record changes could not be loaded. Please try again.');
    } finally {
      if (generation === loadGeneration.current) setLoadingOlderLegacy(false);
    }
  };

  const openFuelReceipt = () => {
    const configuredTankCount = snapshot?.tanks.length ?? 0;
    if (configuredTankCount > 0 || canManage) {
      navigation.navigate('AddEditFuelLog', {});
      return;
    }
    Alert.alert('Fuel setup required', 'Ask an HOD or Captain MOV to configure a vessel fuel tank.');
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

  const correctOperation = (record: FuelInventoryOperation) => {
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
      Alert.alert('Correction unavailable', 'Refresh the fuel history and try again.');
    }
  };

  const confirmVoid = async () => {
    if (
      !voidTarget ||
      !vesselId ||
      voidTarget.vesselId !== vesselId ||
      !voidReason.trim() ||
      voiding ||
      !canManage ||
      currentLoadError
    ) {
      return;
    }
    const target = voidTarget;
    const targetVesselId = vesselId;
    setVoiding(true);
    try {
      if (target.kind === 'REFUEL' && target.sourceFuelLogId) {
        await fuelManagementService.voidFuelLog(target.sourceFuelLogId, {
          expectedRevision: target.revisionNo,
          reason: voidReason.trim(),
        });
      } else if (target.kind === 'TRANSFER' && target.sourceTransferId) {
        await fuelManagementService.deleteTransfer(target.sourceTransferId, {
          expectedRevision: target.revisionNo,
          reason: voidReason.trim(),
        });
      } else if (
        target.kind === 'SOUNDING' ||
        target.kind === 'CONSUMPTION' ||
        target.kind === 'ADJUSTMENT'
      ) {
        await fuelManagementService.voidInventoryEntry({
          operationId: target.id,
          expectedRevision: target.revisionNo,
          reason: voidReason.trim(),
        });
      } else {
        throw new Error('This fuel record cannot be voided here.');
      }
      if (currentVesselId.current !== targetVesselId) return;
      setVoidTarget(null);
      setVoidReason('');
      await load();
      Alert.alert('Fuel record voided', 'The reversal and its reason are now in the audit trail.');
    } catch (error) {
      if (currentVesselId.current !== targetVesselId) return;
      console.error('Void fuel inventory operation error:', error);
      Alert.alert(
        'Could not void fuel record',
        error instanceof Error ? error.message : 'Refresh the fuel history and try again.'
      );
    } finally {
      if (currentVesselId.current === targetVesselId) setVoiding(false);
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
          <LegacyAuditSection
            records={legacyAudits}
            nextCursor={legacyCursor}
            loadError={legacyLoadError}
            loadingOlder={loadingOlderLegacy}
            disabled={!!currentLoadError}
            onLoadOlder={loadOlderLegacyAudits}
          />
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
                onCorrect={() => correctOperation(record)}
                onVoid={() => {
                  setVoidReason('');
                  setVoidTarget(record);
                }}
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

          <LegacyAuditSection
            records={legacyAudits}
            nextCursor={legacyCursor}
            loadError={legacyLoadError}
            loadingOlder={loadingOlderLegacy}
            disabled={!!currentLoadError}
            onLoadOlder={loadOlderLegacyAudits}
          />
        </ScrollView>
      )}
      <Modal
        visible={!!voidTarget && voidTarget.vesselId === vesselId}
        transparent
        animationType="fade"
        onRequestClose={() => !voiding && setVoidTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !voiding && setVoidTarget(null)}
          />
          <View style={[styles.modalCard, { backgroundColor: themeColors.surface }]}>
            <View style={styles.modalIcon}>
              <Ionicons name="warning-outline" size={26} color={COLORS.danger} />
            </View>
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              Void this fuel record?
            </Text>
            <Text style={[styles.modalText, { color: themeColors.textSecondary }]}>
              This does not erase history. Nautical Ops records a reversal with your name, time and
              reason, then recalculates every affected tank.
            </Text>
            <Input
              label="Reason for voiding"
              value={voidReason}
              onChangeText={setVoidReason}
              placeholder="Required: explain why this record is invalid"
              multiline
            />
            <View style={styles.modalButtons}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setVoidTarget(null)}
                disabled={voiding}
                style={styles.modalButton}
              />
              <Button
                title="Void Record"
                variant="danger"
                onPress={confirmVoid}
                loading={voiding}
                disabled={!voidReason.trim()}
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
  legacySection: { marginTop: SPACING.xl },
  legacyAuditBlock: { marginBottom: SPACING.md },
  legacyHint: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.md,
  },
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
