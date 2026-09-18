import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
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
import type { FuelInventoryOperation, FuelTank, FuelVolumeUnit } from '../types';
import { fuelEventDateTime, fuelEventFields, fuelUtcOffsetOptions } from '../utils/fuelDateTime';
import { fromLitres, toLitres } from '../utils/fuelUnits';

type EntryKind = 'SOUNDING' | 'CONSUMPTION' | 'ADJUSTMENT';
type AdjustmentDirection = 'ADD' | 'REMOVE';

interface EntryTank {
  tank: FuelTank;
  initialized: boolean;
  balanceLitres: number | null;
}

const DIRECTION_OPTIONS: FuelSelectOption<AdjustmentDirection>[] = [
  { value: 'ADD', label: 'Add fuel', description: 'Increase the calculated tank quantity' },
  { value: 'REMOVE', label: 'Remove fuel', description: 'Decrease the calculated tank quantity' },
];

function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

function screenTitle(kind: EntryKind): string {
  if (kind === 'SOUNDING') return 'Record Tank Sounding';
  if (kind === 'CONSUMPTION') return 'Record Fuel Consumption';
  return 'Manual Fuel Adjustment';
}

function historyEntryName(kind: EntryKind): string {
  if (kind === 'SOUNDING') return 'Tank Sounding';
  if (kind === 'CONSUMPTION') return 'Fuel Consumption';
  return 'Fuel Adjustment';
}

function amountLabel(kind: EntryKind, unit: FuelVolumeUnit): string {
  if (kind === 'SOUNDING') return `Measured quantity (${unitLabel(unit)})`;
  if (kind === 'CONSUMPTION') return `Amount used (${unitLabel(unit)})`;
  return `Adjustment quantity (${unitLabel(unit)})`;
}

function amountPlaceholder(kind: EntryKind): string {
  return kind === 'SOUNDING' ? 'Enter 0 if measured empty' : 'e.g. 250';
}

export const FuelTankEntryScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canManage = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const correctionOperationId =
    typeof route.params?.correctionOperationId === 'string'
      ? route.params.correctionOperationId
      : null;
  const correctionMode = !!correctionOperationId;
  const requestedKind = String(route.params?.kind ?? 'SOUNDING').toUpperCase();
  const kind: EntryKind =
    requestedKind === 'CONSUMPTION' || requestedKind === 'ADJUSTMENT' ? requestedKind : 'SOUNDING';
  const requestedTankId = route.params?.tankId as string | undefined;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<FuelInventoryOperation | null>(null);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [tanks, setTanks] = useState<EntryTank[]>([]);
  const [tankId, setTankId] = useState<string | null>(requestedTankId ?? null);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<AdjustmentDirection>('ADD');
  const [entryDate, setEntryDate] = useState(localDateString());
  const [entryTime, setEntryTime] = useState(new Date());
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState(-new Date().getTimezoneOffset());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const [verifiedPreviewContext, setVerifiedPreviewContext] = useState<string | null>(null);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const loadGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const requestedContext = useRef<string | null>(null);
  const currentContext = vesselId
    ? `${vesselId}:${kind}:${correctionOperationId ?? ''}:${requestedTankId ?? ''}`
    : null;
  const waitingForCurrentContext = requestedContext.current !== currentContext;
  const previewContext = vesselId
    ? `${vesselId}:${kind}:${entryDate}:${formatTime(entryTime)}:${utcOffsetMinutes}`
    : null;
  const previewUnavailable = !correctionMode && verifiedPreviewContext !== previewContext;
  const previewBlocked =
    !correctionMode && (previewRefreshing || previewError || previewUnavailable);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedContext.current = null;
      setLoadError(null);
      setCorrection(null);
      setTanks([]);
      setTankId(null);
      setAmount('');
      setLocation('');
      setReason('');
      setAmendmentReason('');
      setPreviewRefreshing(false);
      setPreviewError(false);
      setPreviewRetryNonce(0);
      setVerifiedPreviewContext(null);
      requestRef.current = null;
      setLoading(false);
      return;
    }
    requestedContext.current = `${vesselId}:${kind}:${correctionOperationId ?? ''}:${
      requestedTankId ?? ''
    }`;
    setLoading(true);
    setLoadError(null);
    setCorrection(null);
    setTanks([]);
    setTankId(requestedTankId ?? null);
    setAmount('');
    setDirection('ADD');
    setLocation('');
    setReason('');
    setAmendmentReason('');
    setPreviewRefreshing(false);
    setPreviewError(false);
    setPreviewRetryNonce(0);
    setVerifiedPreviewContext(null);
    requestRef.current = null;
    try {
      const [snapshot, loadedCorrection] = await Promise.all([
        fuelManagementService.getInventorySnapshot(vesselId),
        correctionOperationId
          ? fuelManagementService.getInventoryOperation(correctionOperationId)
          : Promise.resolve(null),
      ]);
      if (generation !== loadGeneration.current) return;
      if (correctionOperationId) {
        if (
          !loadedCorrection ||
          loadedCorrection.vesselId !== vesselId ||
          loadedCorrection.status !== 'POSTED' ||
          !['SOUNDING', 'CONSUMPTION', 'ADJUSTMENT'].includes(loadedCorrection.kind) ||
          loadedCorrection.kind !== kind
        ) {
          throw new Error('This fuel record is no longer available for correction.');
        }
      }
      const correctionTankId = loadedCorrection?.postings[0]?.tankId;
      const retainedCorrectionTank = correctionTankId
        ? await fuelManagementService.getTankById(correctionTankId, vesselId)
        : null;
      if (generation !== loadGeneration.current) return;
      const nextUnit = snapshot.displayUnit;
      const nextTanks = snapshot.tanks.map((item) => ({
        tank: item.tank,
        initialized: item.initialized,
        balanceLitres: item.balanceLitres,
      }));
      if (
        correctionMode &&
        retainedCorrectionTank &&
        !nextTanks.some((item) => item.tank.id === retainedCorrectionTank.id)
      ) {
        nextTanks.push({
          tank: retainedCorrectionTank,
          initialized: true,
          balanceLitres: null,
        });
      }
      const available = nextTanks.filter((item) =>
        correctionMode
          ? item.tank.id === correctionTankId
          : item.initialized && item.balanceLitres != null
      );
      setUnit(nextUnit);
      setTanks(nextTanks);
      setTankId(
        requestedTankId && available.some((item) => item.tank.id === requestedTankId)
          ? requestedTankId
          : (available[0]?.tank.id ?? null)
      );
      if (loadedCorrection) {
        setCorrection(loadedCorrection);
        const fields = fuelEventFields(
          loadedCorrection.effectiveAt,
          loadedCorrection.utcOffsetMinutes
        );
        setEntryDate(fields.date);
        setEntryTime(fields.time);
        setUtcOffsetMinutes(fields.utcOffsetMinutes);
        setLocation(
          typeof loadedCorrection.metadata.location === 'string'
            ? loadedCorrection.metadata.location
            : ''
        );
        setReason(
          typeof loadedCorrection.metadata.reason === 'string'
            ? loadedCorrection.metadata.reason
            : ''
        );
        const postingAmount = loadedCorrection.postings[0]?.amountLitres ?? 0;
        setAmount(String(Number(fromLitres(Math.abs(postingAmount), nextUnit).toFixed(3))));
        if (loadedCorrection.kind === 'ADJUSTMENT') {
          setDirection(postingAmount < 0 ? 'REMOVE' : 'ADD');
        }
      } else {
        const now = new Date();
        setEntryDate(localDateString(now));
        setEntryTime(now);
        setUtcOffsetMinutes(-now.getTimezoneOffset());
      }
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel inventory entry error:', error);
      setLoadError(
        error instanceof Error && error.message.includes('no longer available')
          ? error.message
          : 'Tank activity details could not be loaded. No changes can be saved until refresh succeeds.'
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [correctionMode, correctionOperationId, kind, requestedTankId, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load])
  );

  useEffect(() => {
    if (!vesselId || loading || loadError || waitingForCurrentContext || !previewContext) return;
    if (correctionMode) return;
    const generation = ++previewGeneration.current;
    const eventAt = fuelEventDateTime(entryDate, entryTime, utcOffsetMinutes);
    setVerifiedPreviewContext(null);
    setTanks([]);
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
        setUnit(atEvent.displayUnit);
        const eventTanks = atEvent.tanks.map((item) => ({
          tank: item.tank,
          initialized: item.initialized,
          balanceLitres: item.balanceLitres,
        }));
        const availableAtEvent = eventTanks.filter(
          (item) => item.initialized && item.balanceLitres != null
        );
        setTanks(eventTanks);
        setTankId((current) =>
          current && availableAtEvent.some((item) => item.tank.id === current)
            ? current
            : (availableAtEvent[0]?.tank.id ?? null)
        );
        setVerifiedPreviewContext(previewContext);
        setPreviewError(false);
      } catch (error) {
        if (!cancelled && generation === previewGeneration.current) {
          console.error('Load fuel inventory event preview error:', error);
          setTanks([]);
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
    entryDate,
    entryTime,
    loadError,
    loading,
    previewContext,
    previewRetryNonce,
    utcOffsetMinutes,
    vesselId,
    waitingForCurrentContext,
  ]);

  const visibleTanks = useMemo(() => (previewBlocked ? [] : tanks), [previewBlocked, tanks]);

  const availableTanks = useMemo(
    () =>
      visibleTanks.filter((item) =>
        correctionMode
          ? item.tank.id === correction?.postings[0]?.tankId
          : item.initialized && item.balanceLitres != null
      ),
    [correction, correctionMode, visibleTanks]
  );
  const selectedTank = availableTanks.find((item) => item.tank.id === tankId) ?? null;
  const tankOptions = useMemo<FuelSelectOption[]>(
    () =>
      availableTanks.map((item) => ({
        value: item.tank.id,
        label: item.tank.name,
        description: correctionMode
          ? 'Original audited tank — cannot be changed in this correction'
          : `${formatVolume(fromLitres(item.balanceLitres ?? 0, unit))} ${unitLabel(
              unit
            )} calculated`,
      })),
    [availableTanks, correctionMode, unit]
  );
  const utcOffsetOptions = useMemo(
    () => fuelUtcOffsetOptions(utcOffsetMinutes),
    [utcOffsetMinutes]
  );

  const parsedAmount = parseDecimal(amount);
  const amountLitres = Number.isFinite(parsedAmount) ? toLitres(parsedAmount, unit) : 0;
  const currentBalance = selectedTank?.balanceLitres ?? 0;
  const afterBalance =
    kind === 'SOUNDING'
      ? amountLitres
      : kind === 'CONSUMPTION' || direction === 'REMOVE'
        ? currentBalance - amountLitres
        : currentBalance + amountLitres;
  const variance = kind === 'SOUNDING' ? amountLitres - currentBalance : null;

  const save = async () => {
    if (!vesselId || loadError || waitingForCurrentContext) return;
    if (!correctionMode && previewBlocked) {
      Alert.alert(
        'Tank availability not verified',
        previewError
          ? 'The balance at this ship time could not be loaded. Change the date or time, or retry before saving.'
          : 'Wait for the balance at this ship time to finish loading before saving.'
      );
      return;
    }
    if (!tankId || !selectedTank) return;
    if (correctionMode && !canManage) {
      Alert.alert(
        'Manager access required',
        'Only an HOD or Captain MOV can correct fuel records.'
      );
      return;
    }
    if (kind === 'ADJUSTMENT' && !canManage) {
      Alert.alert('Manager access required', 'Only an HOD or Captain MOV can make adjustments.');
      return;
    }
    const zeroAllowed = kind === 'SOUNDING';
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || (!zeroAllowed && parsedAmount <= 0)) {
      Alert.alert(
        'Check quantity',
        zeroAllowed
          ? 'Enter a measured quantity of zero or greater.'
          : 'Enter a quantity greater than zero.'
      );
      return;
    }
    if (kind === 'ADJUSTMENT' && !reason.trim()) {
      Alert.alert('Reason required', 'Explain why this manual adjustment is needed.');
      return;
    }
    if (correctionMode && !amendmentReason.trim()) {
      Alert.alert(
        'Correction reason required',
        'Explain why the original record is being replaced.'
      );
      return;
    }

    const eventAt = fuelEventDateTime(entryDate, entryTime, utcOffsetMinutes);
    if (!Number.isFinite(eventAt.getTime())) {
      Alert.alert('Check date and time', 'Choose a valid ship date, time and UTC offset.');
      return;
    }
    if (eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      Alert.alert('Check date and time', 'Fuel activity cannot be recorded in the future.');
      return;
    }

    setSaving(true);
    try {
      const input = {
        vesselId,
        fuelTankId: tankId,
        kind,
        amountLitres,
        adjustmentDirection: kind === 'ADJUSTMENT' ? direction : undefined,
        occurredAt: eventAt.toISOString(),
        utcOffsetMinutes,
        location: location.trim() || undefined,
        reason: reason.trim() || undefined,
        notes:
          correction && typeof correction.metadata.notes === 'string'
            ? correction.metadata.notes
            : undefined,
      };
      const fingerprint = JSON.stringify({
        ...input,
        operationId: correction?.id ?? null,
        expectedRevision: correction?.revisionNo ?? null,
        amendmentReason: amendmentReason.trim(),
      });
      if (requestRef.current?.fingerprint !== fingerprint) {
        requestRef.current = { fingerprint, id: Crypto.randomUUID() };
      }
      if (correction) {
        await fuelManagementService.amendInventoryEntry({
          ...input,
          operationId: correction.id,
          expectedRevision: correction.revisionNo,
          amendmentReason: amendmentReason.trim(),
          idempotencyKey: requestRef.current.id,
        });
      } else {
        await fuelManagementService.recordInventoryEntry({
          ...input,
          idempotencyKey: requestRef.current.id,
        });
      }
      const successTitle = correctionMode
        ? 'Fuel record corrected'
        : kind === 'SOUNDING'
          ? 'Sounding recorded'
          : kind === 'CONSUMPTION'
            ? 'Consumption recorded'
            : 'Adjustment recorded';
      Alert.alert(successTitle, 'The append-only fuel inventory ledger has been updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error('Save fuel inventory entry error:', error);
      const message = error instanceof Error ? error.message : '';
      Alert.alert(
        'Could not save fuel activity',
        message || 'The calculated level may have changed. Refresh and check the quantity.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to record fuel inventory activity.
        </Text>
      </View>
    );
  }

  if ((kind === 'ADJUSTMENT' || correctionMode) && !canManage) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <PageHeader title={screenTitle(kind)} />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Manager access required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Only an HOD or Captain MOV can record adjustments or replace audited fuel records.
          </Text>
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
        title={correctionMode ? `Correct ${historyEntryName(kind)}` : screenTitle(kind)}
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
          <Button title="Retry" variant="outline" onPress={load} style={styles.centerAction} />
        </View>
      ) : !previewBlocked && availableTanks.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={COLORS.warning} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Opening levels required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Every selected tank needs an explicit opening level before activity can be recorded.
          </Text>
          {canManage ? (
            <Button
              title="Set Opening Levels"
              onPress={() => navigation.navigate('FuelOpeningBalances')}
              style={styles.centerAction}
            />
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {previewBlocked ? (
            <View style={[styles.auditNotice, { borderColor: themeColors.border }]}>
              <Ionicons
                name={previewError ? 'cloud-offline-outline' : 'time-outline'}
                size={20}
                color={previewError ? COLORS.warning : themeColors.accent}
              />
              <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                {previewError
                  ? 'Tank availability and the balance at this ship time could not be verified. Change the date or time, or retry before saving.'
                  : 'Checking tank availability and the balance at this ship time…'}
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
          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <FuelSelectField
              label={correctionMode ? 'Original audited tank' : 'Tank'}
              value={tankId}
              options={tankOptions}
              onChange={setTankId}
              title="Select fuel tank"
              disabled={correctionMode || previewBlocked}
            />
            {correctionMode ? (
              <View style={[styles.tankCorrectionNotice, { borderColor: COLORS.warning }]}>
                <Ionicons name="alert-circle-outline" size={19} color={COLORS.warning} />
                <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                  Wrong tank? Cancel this correction, void the original record from Fuel history,
                  then create a new entry on the correct tank.
                </Text>
              </View>
            ) : null}
            <Input
              label={amountLabel(kind, unit)}
              value={amount}
              onChangeText={setAmount}
              placeholder={amountPlaceholder(kind)}
              keyboardType="decimal-pad"
            />
            {kind === 'ADJUSTMENT' ? (
              <FuelSelectField
                label="Direction"
                value={direction}
                options={DIRECTION_OPTIONS}
                onChange={setDirection}
                title="Add or remove fuel"
              />
            ) : null}
          </View>

          {selectedTank && !correctionMode ? (
            <View style={[styles.previewCard, { backgroundColor: themeColors.surfaceAlt }]}>
              <Text style={[styles.previewTitle, { color: themeColors.textPrimary }]}>
                {kind === 'SOUNDING' ? 'Sounding comparison' : 'Calculated result'}
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
                <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
                  Calculated before
                </Text>
                <Text style={[styles.previewValue, { color: themeColors.textPrimary }]}>
                  {formatVolume(fromLitres(currentBalance, unit))} {unitLabel(unit)}
                </Text>
              </View>
              {kind === 'SOUNDING' && Number.isFinite(parsedAmount) && parsedAmount >= 0 ? (
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
                    Variance
                  </Text>
                  <Text
                    style={[
                      styles.previewValue,
                      { color: variance === 0 ? themeColors.textPrimary : COLORS.warning },
                    ]}
                  >
                    {variance != null && variance > 0 ? '+' : ''}
                    {variance != null ? formatVolume(fromLitres(variance, unit)) : '0'}{' '}
                    {unitLabel(unit)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
                  Calculated after
                </Text>
                <Text
                  style={[
                    styles.previewValue,
                    {
                      color:
                        afterBalance < 0 || afterBalance > selectedTank.tank.capacityLitres
                          ? COLORS.danger
                          : themeColors.textPrimary,
                    },
                  ]}
                >
                  {Number.isFinite(parsedAmount)
                    ? `${formatVolume(fromLitres(afterBalance, unit))} ${unitLabel(unit)}`
                    : '—'}
                </Text>
              </View>
              {kind === 'SOUNDING' ? (
                <Text style={[styles.previewHint, { color: themeColors.textSecondary }]}>
                  A sounding is an absolute physical observation. It resets the calculated level to
                  the measured quantity and keeps the variance in the audit history.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <DateOnlyPicker
              label="Effective date"
              title={`Select ${kind.toLowerCase()} date`}
              value={entryDate}
              onChange={setEntryDate}
            />
            <View style={styles.field}>
              <Text style={[styles.label, { color: themeColors.textPrimary }]}>
                Effective ship time
              </Text>
              {Platform.OS === 'ios' ? (
                <View
                  style={[
                    styles.timeField,
                    { backgroundColor: themeColors.control, borderColor: themeColors.border },
                  ]}
                >
                  <Text style={[styles.timeValue, { color: themeColors.textPrimary }]}>
                    {formatTime(entryTime)}
                  </Text>
                  <DateTimePicker
                    value={entryTime}
                    mode="time"
                    display="compact"
                    onChange={(_: DateTimePickerEvent, selected?: Date) =>
                      selected && setEntryTime(selected)
                    }
                  />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.timeField,
                      { backgroundColor: themeColors.control, borderColor: themeColors.border },
                    ]}
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Text style={[styles.timeValue, { color: themeColors.textPrimary }]}>
                      {formatTime(entryTime)}
                    </Text>
                    <Ionicons name="time-outline" size={22} color={themeColors.textSecondary} />
                  </TouchableOpacity>
                  {showTimePicker ? (
                    <DateTimePicker
                      value={entryTime}
                      mode="time"
                      onChange={(_: DateTimePickerEvent, selected?: Date) => {
                        setShowTimePicker(false);
                        if (selected) setEntryTime(selected);
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
              onChange={setUtcOffsetMinutes}
              title="Select ship UTC offset"
            />
            <Input
              label="Location (optional)"
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. Engine room"
            />
            <Input
              label={kind === 'ADJUSTMENT' ? 'Reason' : 'Note (optional)'}
              value={reason}
              onChangeText={setReason}
              placeholder={
                kind === 'ADJUSTMENT'
                  ? 'Required: explain the correction'
                  : kind === 'CONSUMPTION'
                    ? 'e.g. Generator and propulsion use'
                    : 'e.g. Manual sounding at berth'
              }
              multiline
            />
            {correctionMode ? (
              <Input
                label="Reason for correction"
                value={amendmentReason}
                onChangeText={setAmendmentReason}
                placeholder="Required: explain why the original record is wrong"
                multiline
              />
            ) : null}
          </View>

          {kind === 'ADJUSTMENT' || correctionMode ? (
            <View style={[styles.auditNotice, { borderColor: COLORS.warning }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.warning} />
              <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                {correctionMode
                  ? 'Saving creates a new revision. The original record, correction reason and both actors remain visible in the audit trail. If the wrong tank was selected, cancel, void this record from Fuel history, then create a new entry on the correct tank.'
                  : 'Manual adjustments are exceptional audit entries. Use Fuel Receipt, Transfer, Consumption or Sounding whenever one of those accurately describes the event.'}
              </Text>
            </View>
          ) : null}

          <Button
            title={
              correctionMode
                ? 'Save Correction'
                : kind === 'SOUNDING'
                  ? 'Save Sounding'
                  : kind === 'CONSUMPTION'
                    ? 'Save Consumption'
                    : 'Save Adjustment'
            }
            onPress={save}
            loading={saving}
            disabled={saving || !tankId || previewBlocked}
            fullWidth
          />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  centerAction: { marginTop: SPACING.lg, minWidth: 210 },
  message: { fontSize: FONTS.base, lineHeight: 22, textAlign: 'center' },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, gap: SPACING.md },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  previewCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  previewTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.sm },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingVertical: 4,
  },
  previewLabel: { flex: 1, fontSize: FONTS.sm },
  previewValue: { fontSize: FONTS.sm, fontWeight: '700', textAlign: 'right' },
  previewHint: { fontSize: FONTS.xs, lineHeight: 18, marginTop: SPACING.sm },
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
  tankCorrectionNotice: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.sm,
    marginTop: -SPACING.xs,
    marginBottom: SPACING.md,
  },
  auditText: { flex: 1, fontSize: FONTS.xs, lineHeight: 18 },
  auditRetry: { alignSelf: 'center', paddingHorizontal: SPACING.xs, paddingVertical: SPACING.xs },
  auditRetryText: { fontSize: FONTS.sm, fontWeight: '700' },
});
