import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, DateOnlyPicker, Input, LoadingSpinner, PageHeader } from '../components';
import { FuelSelectField, FuelSelectOption } from '../components/FuelSelectField';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import {
  FuelInventoryActivationStatus,
  FuelInventoryOperation,
  FuelTankBalance,
  FuelTransfer,
  FuelVolumeUnit,
} from '../types';
import {
  formatUtcOffset,
  fuelEventDateTime,
  fuelEventFields,
  fuelUtcOffsetOptions,
} from '../utils/fuelDateTime';
import { needsHistoricalOffsetConfirmation } from '../utils/fuelHistoricalTime';
import { getSelectableFuelTransferBalances } from '../utils/fuelTankSelection';
import { fromLitres, toLitres } from '../utils/fuelUnits';

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseTime(value: string): Date {
  const result = new Date();
  const [hours, minutes] = value.split(':').map(Number);
  result.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return result;
}

function parseDecimal(value: string): number {
  return Number.parseFloat(value.trim().replace(/,/g, '.'));
}

function unitLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

export const FuelTransferScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canManageSetup = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const transferId = route.params?.transferId as string | undefined;
  const correctionOperationId =
    typeof route.params?.correctionOperationId === 'string'
      ? route.params.correctionOperationId
      : null;
  const correctionMode = !!correctionOperationId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<FuelInventoryOperation | null>(null);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [inventoryStatus, setInventoryStatus] = useState<FuelInventoryActivationStatus | null>(
    null
  );
  const [balances, setBalances] = useState<FuelTankBalance[]>([]);
  const [originalTransfer, setOriginalTransfer] = useState<FuelTransfer | null>(null);
  const [sourceTankId, setSourceTankId] = useState<string | null>(null);
  const [destinationTankId, setDestinationTankId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [transferDate, setTransferDate] = useState(localDateString());
  const [transferTime, setTransferTime] = useState(new Date());
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState(-new Date().getTimezoneOffset());
  const [confirmedHistoricalOffsetContext, setConfirmedHistoricalOffsetContext] = useState<
    string | null
  >(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const [verifiedPreviewContext, setVerifiedPreviewContext] = useState<string | null>(null);
  const [retainedCorrectionBalances, setRetainedCorrectionBalances] = useState<FuelTankBalance[]>(
    []
  );
  const loadGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const requestedContext = useRef<string | null>(null);
  const currentContext = vesselId
    ? `${vesselId}:${transferId ?? ''}:${correctionOperationId ?? ''}`
    : null;
  const waitingForCurrentContext = requestedContext.current !== currentContext;
  const legacyEditMode =
    !!transferId &&
    !correctionMode &&
    !!originalTransfer &&
    !originalTransfer.currentInventoryOperationId;
  const historicalTimeUnknown =
    legacyEditMode &&
    originalTransfer?.effectiveAt == null &&
    originalTransfer?.utcOffsetMinutes == null;
  const historicalOffsetConfirmed =
    !!currentContext && confirmedHistoricalOffsetContext === currentContext;
  const historicalOffsetConfirmationRequired = needsHistoricalOffsetConfirmation(
    historicalTimeUnknown,
    historicalOffsetConfirmed
  );
  const postedReadOnlyMode =
    !!transferId && !correctionMode && !!originalTransfer?.currentInventoryOperationId;
  const editingExisting = !!transferId && !!originalTransfer;
  const requiresEventPreview = !editingExisting || correctionMode || legacyEditMode;
  const previewContext = vesselId
    ? `${vesselId}:${correctionOperationId ?? 'new'}:${transferDate}:${formatTime(transferTime)}:${utcOffsetMinutes}`
    : null;
  const previewUnavailable = requiresEventPreview && verifiedPreviewContext !== previewContext;
  const previewBlocked =
    requiresEventPreview && (previewRefreshing || previewError || previewUnavailable);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedContext.current = null;
      setOriginalTransfer(null);
      setCorrection(null);
      setInventoryStatus(null);
      setBalances([]);
      setRetainedCorrectionBalances([]);
      setPreviewRefreshing(false);
      setPreviewError(false);
      setVerifiedPreviewContext(null);
      setConfirmedHistoricalOffsetContext(null);
      setLoading(false);
      return;
    }
    const context = `${vesselId}:${transferId ?? ''}:${correctionOperationId ?? ''}`;
    if (requestedContext.current !== context) {
      requestedContext.current = context;
      const now = new Date();
      setBalances([]);
      setUnit('LITRES');
      setInventoryStatus(null);
      setSourceTankId(null);
      setDestinationTankId(null);
      setAmount('');
      setTransferDate(localDateString(now));
      setTransferTime(now);
      setUtcOffsetMinutes(-now.getTimezoneOffset());
      setConfirmedHistoricalOffsetContext(null);
      setLocation('');
      setNotes('');
      setAmendmentReason('');
      setRetainedCorrectionBalances([]);
      setPreviewRefreshing(false);
      setPreviewError(false);
      setVerifiedPreviewContext(null);
    }
    setLoading(true);
    setLoadError(null);
    setOriginalTransfer(null);
    setCorrection(null);
    setPreviewRefreshing(false);
    setPreviewError(false);
    setVerifiedPreviewContext(null);
    try {
      const [setup, inventory, existing, loadedCorrection] = await Promise.all([
        fuelManagementService.getSetup(vesselId),
        fuelManagementService.getInventorySnapshot(vesselId),
        transferId ? fuelManagementService.getTransferById(transferId) : Promise.resolve(null),
        correctionOperationId
          ? fuelManagementService.getInventoryOperation(correctionOperationId)
          : Promise.resolve(null),
      ]);
      if (generation !== loadGeneration.current) return;
      if (transferId && (!existing || existing.vesselId !== vesselId)) {
        throw new Error('This fuel transfer is no longer available.');
      }
      if (existing && (existing.effectiveAt == null) !== (existing.utcOffsetMinutes == null)) {
        throw new Error('This fuel transfer has incomplete historical ship-time evidence.');
      }
      if (correctionOperationId) {
        if (
          !loadedCorrection ||
          loadedCorrection.vesselId !== vesselId ||
          loadedCorrection.kind !== 'TRANSFER' ||
          loadedCorrection.status !== 'POSTED' ||
          loadedCorrection.sourceTransferId !== transferId ||
          !existing ||
          existing.currentInventoryOperationId !== loadedCorrection.id
        ) {
          throw new Error('This transfer is no longer available for correction.');
        }
        setCorrection(loadedCorrection);
      } else {
        setCorrection(null);
      }
      const nextUnit = setup.settings?.volumeUnit ?? 'LITRES';
      let nextBalances = inventory.tanks.map((item) => ({
        tank: item.tank,
        recordedVolumeLitres: item.balanceLitres ?? 0,
        remainingCapacityLitres: item.remainingCapacityLitres ?? item.tank.capacityLitres,
        isInitialized: item.initialized,
        lastVerifiedAt: item.lastVerifiedAt,
        lastVerificationKind: item.lastVerificationKind,
      }));
      const retainedBalances: FuelTankBalance[] = [];
      if (existing) {
        const retained = await Promise.all([
          fuelManagementService.getTankById(existing.sourceTankId, vesselId),
          fuelManagementService.getTankById(existing.destinationTankId, vesselId),
        ]);
        if (generation !== loadGeneration.current) return;
        for (const tank of retained) {
          if (!tank || retainedBalances.some((item) => item.tank.id === tank.id)) continue;
          const currentBalance = nextBalances.find((item) => item.tank.id === tank.id);
          const retainedBalance =
            currentBalance ??
            ({
              tank,
              recordedVolumeLitres: 0,
              remainingCapacityLitres: tank.capacityLitres,
              isInitialized: false,
              lastVerifiedAt: null,
              lastVerificationKind: null,
            } satisfies FuelTankBalance);
          retainedBalances.push(retainedBalance);
          if (!currentBalance) {
            nextBalances = [...nextBalances, retainedBalance];
          }
        }
      }
      const initializedBalances = nextBalances.filter((item) => item.isInitialized === true);
      setUnit(nextUnit);
      setInventoryStatus(inventory.status);
      setBalances(nextBalances);
      setRetainedCorrectionBalances(
        correctionMode || (!!existing && !existing.currentInventoryOperationId)
          ? retainedBalances
          : []
      );
      if (existing) {
        setOriginalTransfer(existing);
        setSourceTankId(existing.sourceTankId);
        setDestinationTankId(existing.destinationTankId);
        setAmount(String(Number(fromLitres(existing.amountLitres, nextUnit).toFixed(3))));
        const persistedFields = loadedCorrection
          ? fuelEventFields(loadedCorrection.effectiveAt, loadedCorrection.utcOffsetMinutes)
          : existing.effectiveAt
            ? fuelEventFields(existing.effectiveAt, existing.utcOffsetMinutes)
            : null;
        setTransferDate(persistedFields?.date ?? existing.transferDate);
        setTransferTime(persistedFields?.time ?? parseTime(existing.transferTime));
        if (persistedFields) setUtcOffsetMinutes(persistedFields.utcOffsetMinutes);
        setLocation(existing.location);
        setNotes(existing.notes);
      } else {
        setOriginalTransfer(null);
        const eligibleBalances =
          inventory.status === 'NOT_ACTIVATED' ? nextBalances : initializedBalances;
        setSourceTankId((current) => current ?? eligibleBalances[0]?.tank.id ?? null);
        setDestinationTankId(
          (current) =>
            current ??
            eligibleBalances.find((item) => item.tank.id !== eligibleBalances[0]?.tank.id)?.tank
              .id ??
            null
        );
      }
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel transfer form error:', error);
      setConfirmedHistoricalOffsetContext(null);
      setLoadError(
        error instanceof Error && error.message.includes('no longer available')
          ? error.message
          : 'Fuel transfer details could not be loaded. No changes can be saved until refresh succeeds.'
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [correctionMode, correctionOperationId, transferId, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        loadGeneration.current += 1;
        previewGeneration.current += 1;
      };
    }, [load])
  );

  useEffect(() => {
    if (historicalOffsetConfirmationRequired) {
      previewGeneration.current += 1;
      setVerifiedPreviewContext(null);
      setPreviewRefreshing(false);
      setPreviewError(false);
      return;
    }
    if (
      !vesselId ||
      loading ||
      loadError ||
      waitingForCurrentContext ||
      !requiresEventPreview ||
      !previewContext
    ) {
      return;
    }
    const generation = ++previewGeneration.current;
    const eventAt = fuelEventDateTime(transferDate, transferTime, utcOffsetMinutes);
    setVerifiedPreviewContext(null);
    setBalances([]);
    if (!Number.isFinite(eventAt.getTime()) || eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      setPreviewRefreshing(false);
      setPreviewError(true);
      return;
    }
    let cancelled = false;
    setPreviewRefreshing(true);
    setPreviewError(false);
    const timer = setTimeout(async () => {
      try {
        const atEvent = await fuelManagementService.getInventorySnapshot(
          vesselId,
          eventAt.toISOString()
        );
        if (cancelled || generation !== previewGeneration.current) return;
        const eventBalances = atEvent.tanks.map((item) => ({
          tank: item.tank,
          recordedVolumeLitres: item.balanceLitres ?? 0,
          remainingCapacityLitres: item.remainingCapacityLitres ?? item.tank.capacityLitres,
          isInitialized: item.initialized,
          lastVerifiedAt: item.lastVerifiedAt,
          lastVerificationKind: item.lastVerificationKind,
        }));
        const activeAtEvent = eventBalances.filter((item) => !item.tank.archivedAt);
        const initializedAtEvent = activeAtEvent.filter((item) => item.isInitialized);
        const eligibleAtEvent = correctionMode
          ? initializedAtEvent
          : legacyEditMode || inventoryStatus === 'NOT_ACTIVATED'
            ? activeAtEvent
            : initializedAtEvent;
        const retainedAtEvent = retainedCorrectionBalances.filter((retained) =>
          eventBalances.some((item) => item.tank.id === retained.tank.id)
        );
        const balancesForForm =
          correctionMode || legacyEditMode
            ? retainedAtEvent.reduce<FuelTankBalance[]>(
                (merged, retained) => {
                  if (merged.some((item) => item.tank.id === retained.tank.id)) return merged;
                  return [
                    ...merged,
                    eventBalances.find((item) => item.tank.id === retained.tank.id) ?? retained,
                  ];
                },
                [...eligibleAtEvent]
              )
            : eligibleAtEvent;
        setUnit(atEvent.displayUnit);
        setBalances(balancesForForm);
        setSourceTankId((current) =>
          current && balancesForForm.some((item) => item.tank.id === current)
            ? current
            : (balancesForForm[0]?.tank.id ?? null)
        );
        setDestinationTankId((current) => {
          if (current && balancesForForm.some((item) => item.tank.id === current)) {
            return current;
          }
          return balancesForForm[1]?.tank.id ?? balancesForForm[0]?.tank.id ?? null;
        });
        setVerifiedPreviewContext(previewContext);
        setPreviewError(false);
      } catch (error) {
        if (!cancelled && generation === previewGeneration.current) {
          console.error('Load transfer event preview error:', error);
          setBalances([]);
          setVerifiedPreviewContext(null);
          setPreviewError(true);
        }
      } finally {
        if (!cancelled && generation === previewGeneration.current) setPreviewRefreshing(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    correctionMode,
    historicalOffsetConfirmationRequired,
    loadError,
    loading,
    inventoryStatus,
    legacyEditMode,
    originalTransfer,
    previewContext,
    previewRetryNonce,
    requiresEventPreview,
    retainedCorrectionBalances,
    transferDate,
    transferTime,
    utcOffsetMinutes,
    vesselId,
    waitingForCurrentContext,
  ]);

  const visibleBalances = useMemo(
    () =>
      previewBlocked
        ? correctionMode || legacyEditMode
          ? retainedCorrectionBalances
          : []
        : balances,
    [balances, correctionMode, legacyEditMode, previewBlocked, retainedCorrectionBalances]
  );
  const selectedEventIncludesOriginal = useMemo(() => {
    if (!correctionMode || !correction) return true;
    const selectedEventAt = fuelEventDateTime(transferDate, transferTime, utcOffsetMinutes);
    const originalEventAt = new Date(correction.effectiveAt);
    return (
      Number.isFinite(selectedEventAt.getTime()) &&
      Number.isFinite(originalEventAt.getTime()) &&
      selectedEventAt.getTime() >= originalEventAt.getTime()
    );
  }, [correction, correctionMode, transferDate, transferTime, utcOffsetMinutes]);

  const balanceBeforeTransfer = useCallback(
    (tankId: string | null): number => {
      if (!tankId) return 0;
      let recorded =
        visibleBalances.find((item) => item.tank.id === tankId)?.recordedVolumeLitres ?? 0;
      // Current balances already include the stored transfer while editing. Undo
      // it first so the preview and validation describe the replacement record.
      if (originalTransfer && selectedEventIncludesOriginal) {
        if (originalTransfer.sourceTankId === tankId) recorded += originalTransfer.amountLitres;
        if (originalTransfer.destinationTankId === tankId)
          recorded -= originalTransfer.amountLitres;
      }
      return recorded;
    },
    [originalTransfer, selectedEventIncludesOriginal, visibleBalances]
  );

  const sourceBalanceLitres = balanceBeforeTransfer(sourceTankId);
  const destinationBalanceLitres = balanceBeforeTransfer(destinationTankId);
  const parsedAmount = parseDecimal(amount);
  const amountLitres =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? toLitres(parsedAmount, unit) : 0;
  const sourceAfter = sourceBalanceLitres - amountLitres;
  const destinationAfter = destinationBalanceLitres + amountLitres;
  const initializedBalances = visibleBalances.filter((item) => item.isInitialized === true);
  const inventoryReady = initializedBalances.length > 0;
  const reportOnlyMode = !editingExisting && inventoryStatus === 'NOT_ACTIVATED';
  const selectionMode = legacyEditMode ? 'LEGACY_EDIT' : reportOnlyMode ? 'REPORT_ONLY' : 'LEDGER';
  const selectableBalances = useMemo(
    () =>
      correctionMode
        ? visibleBalances
        : getSelectableFuelTransferBalances(visibleBalances, selectionMode),
    [correctionMode, selectionMode, visibleBalances]
  );

  const tankOptions = useMemo<FuelSelectOption[]>(
    () =>
      selectableBalances.map((item) => ({
        value: item.tank.id,
        label: item.tank.name,
        description: editingExisting
          ? 'Current quantity is hidden while changing historical activity'
          : reportOnlyMode
            ? 'Report-only tank selection; current quantity is unknown'
            : `${formatVolume(fromLitres(balanceBeforeTransfer(item.tank.id), unit))} ${unitLabel(unit)} calculated`,
      })),
    [balanceBeforeTransfer, editingExisting, reportOnlyMode, selectableBalances, unit]
  );
  const utcOffsetOptions = useMemo(
    () => fuelUtcOffsetOptions(utcOffsetMinutes),
    [utcOffsetMinutes]
  );

  const saveTransfer = async () => {
    if (!vesselId) return;
    if (historicalOffsetConfirmationRequired) {
      Alert.alert(
        'Confirm historical UTC offset',
        'The original ship UTC offset was not recorded. Choose and confirm the correct historical offset before this transfer can be checked or changed.'
      );
      return;
    }
    if (previewBlocked) {
      Alert.alert(
        'Tank availability not verified',
        previewError
          ? 'The balances at this ship time could not be loaded. Change the date or time, or retry before saving.'
          : 'Wait for the balances at this ship time to finish loading before saving.'
      );
      return;
    }
    if (postedReadOnlyMode) {
      Alert.alert(
        'Posted transfer is locked',
        'Fuel inventory records are append-only. Corrections must be recorded separately.'
      );
      return;
    }
    if (transferId && !canManageSetup) {
      Alert.alert('Manager access required', 'Only an HOD or Captain MOV can change a transfer.');
      return;
    }
    if (transferId && !originalTransfer) {
      Alert.alert('Transfer unavailable', 'Refresh the transfer before trying again.');
      return;
    }
    if (correctionMode && !correction) {
      Alert.alert('Correction unavailable', 'Refresh fuel history and try again.');
      return;
    }
    if (!sourceTankId || !destinationTankId) {
      Alert.alert('Select both tanks', 'Choose a source and destination tank.');
      return;
    }
    if (!inventoryReady && !reportOnlyMode && !editingExisting) {
      Alert.alert(
        'Opening levels required',
        canManageSetup
          ? 'Set explicit opening levels for at least two tanks before recording a transfer.'
          : 'An HOD or Captain MOV must set the required opening tank levels before transfers can be recorded.'
      );
      return;
    }
    if (sourceTankId === destinationTankId) {
      Alert.alert('Choose different tanks', 'Fuel cannot be transferred into the same tank.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Enter an amount', 'The transfer amount must be greater than zero.');
      return;
    }
    if (
      !correctionMode &&
      !reportOnlyMode &&
      !legacyEditMode &&
      amountLitres > sourceBalanceLitres + 0.0005
    ) {
      Alert.alert(
        'Not enough recorded fuel',
        `The source tank has ${formatVolume(fromLitres(sourceBalanceLitres, unit))} ${unitLabel(unit)} calculated.`
      );
      return;
    }
    if (transferId && !amendmentReason.trim()) {
      Alert.alert(
        'Correction reason required',
        'Explain why the existing transfer must be changed.'
      );
      return;
    }

    const eventAt = fuelEventDateTime(transferDate, transferTime, utcOffsetMinutes);
    if (!Number.isFinite(eventAt.getTime())) {
      Alert.alert('Check date and time', 'Choose a valid ship date, time and UTC offset.');
      return;
    }
    if (eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      Alert.alert(
        'Check date and time',
        'A completed fuel transfer cannot be recorded in the future.'
      );
      return;
    }

    const input = {
      vesselId,
      sourceTankId,
      destinationTankId,
      amountLitres,
      transferDate,
      transferTime: formatTime(transferTime),
      effectiveAt: eventAt.toISOString(),
      utcOffsetMinutes,
      location: location.trim(),
      notes: notes.trim(),
      expectedRevision: transferId
        ? (correction?.revisionNo ?? originalTransfer?.inventoryRevision ?? 0)
        : undefined,
      amendmentReason: transferId ? amendmentReason.trim() : undefined,
    };

    setSaving(true);
    try {
      let createdTransfer: FuelTransfer | null = null;
      if (transferId) {
        await fuelManagementService.updateTransfer(transferId, input);
      } else {
        createdTransfer = await fuelManagementService.createTransfer(input);
      }
      const createdReportOnly = !!createdTransfer && !createdTransfer.currentInventoryOperationId;
      Alert.alert(
        correctionMode
          ? 'Fuel transfer corrected'
          : legacyEditMode
            ? 'Legacy transfer updated'
            : createdReportOnly
              ? 'Report-only transfer saved'
              : 'Transfer saved',
        correctionMode
          ? 'A replacement revision was recorded and both tank balances were recalculated.'
          : legacyEditMode
            ? 'The report-only transfer was updated. No fuel inventory balance changed because this record predates inventory activation.'
            : createdReportOnly
              ? 'The transfer was saved against the configured tanks. Tank quantities remain unknown and no calculated fuel balance changed.'
              : 'The append-only fuel inventory ledger has been updated.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Save fuel transfer error:', error);
      const message = error instanceof Error ? error.message : '';
      Alert.alert(
        'Could not save transfer',
        /balance|insufficient|available/i.test(message)
          ? 'The recorded source balance changed. Refresh and check the amount before trying again.'
          : 'No changes were saved. Please check the tank details and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to record fuel transfers.
        </Text>
      </View>
    );
  }

  if (transferId && !canManageSetup) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <PageHeader title={correctionMode ? 'Correct Fuel Transfer' : 'Edit Legacy Transfer'} />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Manager access required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Only an HOD or Captain MOV can change an existing fuel transfer.
          </Text>
        </View>
      </View>
    );
  }

  if (postedReadOnlyMode && !waitingForCurrentContext) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <PageHeader title="Fuel Transfer" />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Posted transfer
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            This transfer is part of the vessel's fuel inventory audit trail and cannot be edited in
            place.
          </Text>
          <Button
            title="Back to Transfers"
            onPress={() => navigation.goBack()}
            style={styles.emptyAction}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader
        title={
          correctionMode
            ? 'Correct Fuel Transfer'
            : legacyEditMode
              ? 'Edit Legacy Transfer'
              : 'Fuel Transfer'
        }
      />
      {loading || waitingForCurrentContext ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={COLORS.warning} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Could not load
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>{loadError}</Text>
          <Button title="Retry" variant="outline" onPress={load} style={styles.emptyAction} />
        </View>
      ) : !previewBlocked && !inventoryReady && !reportOnlyMode && !editingExisting ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={COLORS.warning} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Opening levels required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            {visibleBalances.filter((item) => item.isInitialized !== true).length}{' '}
            {visibleBalances.filter((item) => item.isInitialized !== true).length === 1
              ? 'tank has'
              : 'tanks have'}{' '}
            an unknown quantity. No zero balance is assumed.
          </Text>
          {canManageSetup ? (
            <Button
              title="Set Opening Levels"
              onPress={() => navigation.navigate('FuelOpeningBalances')}
              style={styles.emptyAction}
            />
          ) : (
            <Text style={[styles.permissionHint, { color: themeColors.textSecondary }]}>
              Ask an HOD or Captain MOV to initialize the fuel inventory.
            </Text>
          )}
        </View>
      ) : !previewBlocked && selectableBalances.length < 2 ? (
        <View style={styles.center}>
          <Ionicons name="swap-horizontal-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Two tanks required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Configure at least two vessel fuel tanks before recording a transfer.
          </Text>
          {canManageSetup ? (
            <Button
              title="Open Fuel Setup"
              onPress={() => navigation.navigate('FuelSetup')}
              style={styles.emptyAction}
            />
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {previewBlocked && !historicalOffsetConfirmationRequired ? (
            <View style={[styles.auditNotice, { borderColor: themeColors.border }]}>
              <Ionicons
                name={previewError ? 'cloud-offline-outline' : 'time-outline'}
                size={20}
                color={previewError ? COLORS.warning : themeColors.accent}
              />
              <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                {previewError
                  ? 'Tank availability and balances at this ship time could not be verified. Change the date or time, or retry before saving.'
                  : 'Checking tank availability and balances at this ship time…'}
              </Text>
              {previewError ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setPreviewRetryNonce((value) => value + 1)}
                  style={styles.auditRetry}
                >
                  <Text style={[styles.auditRetryText, { color: themeColors.accent }]}>Retry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {reportOnlyMode ? (
            <View style={[styles.auditNotice, { borderColor: COLORS.warning }]}>
              <Ionicons name="document-text-outline" size={20} color={COLORS.warning} />
              <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                Report-only mode: opening levels have not been set. This records which configured
                tanks were used, but quantities stay unknown and no calculated balance changes.
              </Text>
            </View>
          ) : null}
          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <FuelSelectField
              label="From (Source Tank)"
              value={sourceTankId}
              options={tankOptions.filter((option) => option.value !== destinationTankId)}
              onChange={setSourceTankId}
              title="Select source tank"
              disabled={previewBlocked}
            />
            <FuelSelectField
              label="To (Destination Tank)"
              value={destinationTankId}
              options={tankOptions.filter((option) => option.value !== sourceTankId)}
              onChange={setDestinationTankId}
              title="Select destination tank"
              disabled={previewBlocked}
            />
            <Input
              label={`Amount (${unitLabel(unit)})`}
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 500"
              keyboardType="decimal-pad"
            />
          </View>

          {sourceTankId &&
          destinationTankId &&
          amountLitres > 0 &&
          !editingExisting &&
          !reportOnlyMode ? (
            <View style={[styles.previewCard, { backgroundColor: themeColors.surfaceAlt }]}>
              <Text style={[styles.previewTitle, { color: themeColors.textPrimary }]}>
                Calculated after transfer
              </Text>
              {previewRefreshing ? (
                <Text style={[styles.previewHint, { color: themeColors.textSecondary }]}>
                  Updating the balance at this ship time…
                </Text>
              ) : null}
              {previewError ? (
                <Text style={[styles.previewHint, { color: COLORS.warning }]}>
                  The time-specific preview could not be refreshed. Saving will validate it again.
                </Text>
              ) : null}
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: themeColors.textPrimary }]}>
                  {visibleBalances.find((item) => item.tank.id === sourceTankId)?.tank.name}
                </Text>
                <Text
                  style={[
                    styles.previewValue,
                    { color: sourceAfter < 0 ? COLORS.danger : themeColors.textPrimary },
                  ]}
                >
                  {formatVolume(fromLitres(sourceAfter, unit))} {unitLabel(unit)}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: themeColors.textPrimary }]}>
                  {visibleBalances.find((item) => item.tank.id === destinationTankId)?.tank.name}
                </Text>
                <Text style={[styles.previewValue, { color: themeColors.textPrimary }]}>
                  {formatVolume(fromLitres(destinationAfter, unit))} {unitLabel(unit)}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <DateOnlyPicker
              label="Date"
              title="Select transfer date"
              value={transferDate}
              onChange={setTransferDate}
            />
            <View style={styles.field}>
              <Text style={[styles.label, { color: themeColors.textPrimary }]}>Ship time</Text>
              {Platform.OS === 'ios' ? (
                <View
                  style={[
                    styles.timeField,
                    {
                      backgroundColor: themeColors.surface,
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <Text style={[styles.timeValue, { color: themeColors.textPrimary }]}>
                    {formatTime(transferTime)}
                  </Text>
                  <DateTimePicker
                    value={transferTime}
                    mode="time"
                    display="compact"
                    onChange={(_: DateTimePickerEvent, selected?: Date) => {
                      if (selected) setTransferTime(selected);
                    }}
                  />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.timeField,
                      {
                        backgroundColor: themeColors.surface,
                        borderColor: themeColors.border,
                      },
                    ]}
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Text style={[styles.timeValue, { color: themeColors.textPrimary }]}>
                      {formatTime(transferTime)}
                    </Text>
                    <Ionicons name="time-outline" size={22} color={themeColors.textSecondary} />
                  </TouchableOpacity>
                  {showTimePicker ? (
                    <DateTimePicker
                      value={transferTime}
                      mode="time"
                      display="default"
                      is24Hour
                      onChange={(_: DateTimePickerEvent, selected?: Date) => {
                        setShowTimePicker(false);
                        if (selected) setTransferTime(selected);
                      }}
                    />
                  ) : null}
                </>
              )}
            </View>
            <FuelSelectField
              label="Ship UTC offset"
              value={utcOffsetMinutes}
              options={utcOffsetOptions}
              onChange={(value) => {
                setUtcOffsetMinutes(value);
                if (historicalTimeUnknown) setConfirmedHistoricalOffsetContext(null);
              }}
              title="Select ship UTC offset"
            />
            {historicalTimeUnknown ? (
              <View
                style={[
                  styles.historicalTimeNotice,
                  {
                    backgroundColor: themeColors.surfaceAlt,
                    borderColor: historicalOffsetConfirmed ? themeColors.accent : COLORS.warning,
                  },
                ]}
              >
                <Ionicons
                  name={historicalOffsetConfirmed ? 'checkmark-circle-outline' : 'warning-outline'}
                  size={20}
                  color={historicalOffsetConfirmed ? themeColors.accent : COLORS.warning}
                />
                <View style={styles.historicalTimeCopy}>
                  <Text style={[styles.historicalTimeText, { color: themeColors.textPrimary }]}>
                    {historicalOffsetConfirmed
                      ? `${formatUtcOffset(utcOffsetMinutes)} is confirmed for this historical transfer.`
                      : `The original ship UTC offset was not recorded. ${formatUtcOffset(utcOffsetMinutes)} is only a suggestion from this device. Confirm the correct historical offset before checking or changing this transfer.`}
                  </Text>
                  {!historicalOffsetConfirmed ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => {
                        if (currentContext) setConfirmedHistoricalOffsetContext(currentContext);
                      }}
                      style={[styles.confirmOffsetButton, { borderColor: themeColors.accent }]}
                    >
                      <Text style={[styles.confirmOffsetText, { color: themeColors.accent }]}>
                        Confirm {formatUtcOffset(utcOffsetMinutes)}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
            <Input
              label="Location"
              value={location}
              onChangeText={setLocation}
              placeholder="Optional location"
            />
            <Input
              label="Comment"
              value={notes}
              onChangeText={setNotes}
              placeholder="Reason or operational notes"
              multiline
            />
            {editingExisting ? (
              <Input
                label={legacyEditMode ? 'Reason for change' : 'Reason for correction'}
                value={amendmentReason}
                onChangeText={setAmendmentReason}
                placeholder="Required: explain why the existing transfer is wrong"
                multiline
              />
            ) : null}
          </View>

          {editingExisting ? (
            <View style={[styles.auditNotice, { borderColor: themeColors.border }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={themeColors.accent} />
              <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                {legacyEditMode
                  ? 'This transfer predates fuel inventory activation. Saving updates the retained report record without changing any calculated tank balance.'
                  : 'Saving creates a replacement revision. The original transfer, actors and correction reason remain in the audit trail.'}
              </Text>
            </View>
          ) : null}

          <Button
            title={
              correctionMode
                ? 'Save Transfer Correction'
                : legacyEditMode
                  ? 'Update Legacy Transfer'
                  : reportOnlyMode
                    ? 'Save Report-Only Transfer'
                    : 'Save Transfer'
            }
            onPress={saveTransfer}
            loading={saving}
            disabled={saving || (previewBlocked && !historicalOffsetConfirmationRequired)}
            fullWidth
          />
          <TouchableOpacity
            onPress={() => navigation.navigate('FuelSetup')}
            style={styles.setupLink}
          >
            <Text style={[styles.setupLinkText, { color: themeColors.accent }]}>
              {canManageSetup ? 'Edit Tank Setup' : 'View Tank Setup'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={themeColors.accent} />
          </TouchableOpacity>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.sm,
  },
  message: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginTop: SPACING.sm },
  emptyAction: { marginTop: SPACING.md },
  permissionHint: { fontSize: FONTS.sm, textAlign: 'center', marginTop: SPACING.md },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, gap: SPACING.md },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  previewCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  previewTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.xs },
  previewHint: { fontSize: FONTS.xs, lineHeight: 18 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.md },
  previewLabel: { flex: 1, fontSize: FONTS.base },
  previewValue: { fontSize: FONTS.base, fontWeight: '700' },
  field: { marginBottom: SPACING.md },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  timeField: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeValue: { fontSize: FONTS.base },
  auditNotice: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  auditText: { flex: 1, fontSize: FONTS.xs, lineHeight: 18 },
  auditRetry: { alignSelf: 'center', paddingHorizontal: SPACING.xs, paddingVertical: SPACING.xs },
  auditRetryText: { fontSize: FONTS.sm, fontWeight: '700' },
  historicalTimeNotice: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  historicalTimeCopy: { flex: 1, gap: SPACING.sm },
  historicalTimeText: { fontSize: FONTS.xs, lineHeight: 18 },
  confirmOffsetButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  confirmOffsetText: { fontSize: FONTS.sm, fontWeight: '700' },
  setupLink: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: SPACING.md,
  },
  setupLinkText: { fontSize: FONTS.base, fontWeight: '600' },
});
