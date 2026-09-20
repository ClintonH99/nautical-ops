/**
 * Tank-aware vessel fuel log entry.
 *
 * The legacy fuel_logs row is still maintained for historical exports while
 * canonical tank allocations are saved atomically in litres.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, DateOnlyPicker, Input, LoadingSpinner, PageHeader } from '../components';
import { FuelSelectField } from '../components/FuelSelectField';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import fuelLogsService from '../services/fuelLogs';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import {
  FuelInventoryActivationStatus,
  FuelInventoryOperation,
  FuelLog,
  FuelTank,
  FuelVolumeUnit,
} from '../types';
import {
  formatUtcOffset,
  fuelEventDateTime,
  fuelEventFields,
  fuelUtcOffsetOptions,
} from '../utils/fuelDateTime';
import {
  canPreserveUnknownReceiptTime,
  needsHistoricalOffsetConfirmation,
} from '../utils/fuelHistoricalTime';
import { mergeFuelCorrectionTanks } from '../utils/fuelTankSelection';
import {
  fromLitres,
  LITRES_PER_US_GALLON,
  storedFuelVolumeUnit,
  toLitres,
} from '../utils/fuelUnits';

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — Pound sterling' },
  { value: 'AUD', label: 'AUD — Australian dollar' },
  { value: 'NZD', label: 'NZD — New Zealand dollar' },
  { value: 'CAD', label: 'CAD — Canadian dollar' },
  { value: 'ZAR', label: 'ZAR — South African rand' },
];

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
  const date = new Date();
  const [hours, minutes] = value.split(':').map(Number);
  date.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return date;
}

function parseDecimal(value: string): number {
  return Number.parseFloat(value.trim().replace(/,/g, '.'));
}

function unitLongLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'Litre' : 'US Gallon';
}

function unitShortLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function convertUnitPrice(price: number, fromUnit: FuelVolumeUnit, toUnit: FuelVolumeUnit): number {
  if (fromUnit === toUnit) return price;
  return fromUnit === 'US_GALLONS' ? price / LITRES_PER_US_GALLON : price * LITRES_PER_US_GALLON;
}

function currencyTotal(code: string, value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

export const AddEditFuelLogScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canManageSetup = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const logId = route.params?.logId as string | undefined;
  const correctionOperationId =
    typeof route.params?.correctionOperationId === 'string'
      ? route.params.correctionOperationId
      : null;
  const correctionMode = !!correctionOperationId;
  const isEdit = Boolean(logId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<FuelInventoryOperation | null>(null);
  const [originalLog, setOriginalLog] = useState<FuelLog | null>(null);
  const [tanks, setTanks] = useState<FuelTank[]>([]);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [logDate, setLogDate] = useState(localDateString());
  const [logTime, setLogTime] = useState(new Date());
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState(-new Date().getTimezoneOffset());
  const [confirmedHistoricalOffsetContext, setConfirmedHistoricalOffsetContext] = useState<
    string | null
  >(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [location, setLocation] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [comment, setComment] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [legacyAllocationRequired, setLegacyAllocationRequired] = useState(false);
  const [legacyOriginalAmount, setLegacyOriginalAmount] = useState<number | null>(null);
  const [immutablePosted, setImmutablePosted] = useState(false);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [inventoryStatus, setInventoryStatus] = useState<FuelInventoryActivationStatus | null>(
    null
  );
  const [eventTanksRefreshing, setEventTanksRefreshing] = useState(false);
  const [eventTanksError, setEventTanksError] = useState(false);
  const [eventTanksRetryNonce, setEventTanksRetryNonce] = useState(0);
  const [verifiedEventTanksContext, setVerifiedEventTanksContext] = useState<string | null>(null);
  const [retainedCorrectionTanks, setRetainedCorrectionTanks] = useState<FuelTank[]>([]);
  const loadGeneration = useRef(0);
  const eventTanksGeneration = useRef(0);
  const requestedContext = useRef<string | null>(null);
  const currentContext = vesselId
    ? `${vesselId}:${logId ?? ''}:${correctionOperationId ?? ''}`
    : null;
  const waitingForCurrentContext = requestedContext.current !== currentContext;
  const legacyEditMode =
    isEdit && !correctionMode && !!originalLog && !originalLog.currentInventoryOperationId;
  const historicalTimeUnknown =
    legacyEditMode && originalLog?.effectiveAt == null && originalLog?.utcOffsetMinutes == null;
  const historicalOffsetConfirmed =
    !!currentContext && confirmedHistoricalOffsetContext === currentContext;
  const hasPositiveAllocationInput = Object.values(allocations).some((value) => {
    const amount = parseDecimal(value);
    return Number.isFinite(amount) && amount > 0;
  });
  const originalLocalDateTimeUnchanged =
    !!originalLog &&
    logDate === originalLog.logDate &&
    formatTime(logTime) === formatTime(parseTime(originalLog.logTime));
  const preserveUnknownHistoricalTime = canPreserveUnknownReceiptTime({
    historicalTimeUnknown,
    offsetConfirmed: historicalOffsetConfirmed,
    legacyAllocationRequired,
    hasPositiveAllocation: hasPositiveAllocationInput,
    localDateTimeUnchanged: originalLocalDateTimeUnchanged,
  });
  const historicalOffsetConfirmationRequired = needsHistoricalOffsetConfirmation(
    historicalTimeUnknown,
    historicalOffsetConfirmed,
    preserveUnknownHistoricalTime
  );
  const eventTanksContext = vesselId
    ? `${vesselId}:${correctionOperationId ?? 'new'}:${logDate}:${formatTime(logTime)}:${utcOffsetMinutes}`
    : null;
  const requiresEventTankCheck =
    (!isEdit || correctionMode || legacyEditMode) && !preserveUnknownHistoricalTime;
  const eventTanksUnavailable =
    requiresEventTankCheck && verifiedEventTanksContext !== eventTanksContext;
  const eventTanksBlocked =
    requiresEventTankCheck && (eventTanksRefreshing || eventTanksError || eventTanksUnavailable);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedContext.current = null;
      setOriginalLog(null);
      setCorrection(null);
      setTanks([]);
      setAllocations({});
      setRetainedCorrectionTanks([]);
      setInventoryReady(false);
      setInventoryStatus(null);
      setVerifiedEventTanksContext(null);
      setConfirmedHistoricalOffsetContext(null);
      setLoading(false);
      return;
    }
    const context = `${vesselId}:${logId ?? ''}:${correctionOperationId ?? ''}`;
    if (requestedContext.current !== context) {
      requestedContext.current = context;
      const now = new Date();
      setTanks([]);
      setAllocations({});
      setUnit('LITRES');
      setLogDate(localDateString(now));
      setLogTime(now);
      setUtcOffsetMinutes(-now.getTimezoneOffset());
      setConfirmedHistoricalOffsetContext(null);
      setLocation('');
      setPricePerUnit('');
      setCurrencyCode('USD');
      setComment('');
      setAmendmentReason('');
      setLegacyAllocationRequired(false);
      setLegacyOriginalAmount(null);
      setImmutablePosted(false);
      setInventoryReady(false);
      setInventoryStatus(null);
      setRetainedCorrectionTanks([]);
      setVerifiedEventTanksContext(null);
    }
    setLoading(true);
    setLoadError(null);
    setOriginalLog(null);
    setCorrection(null);
    setEventTanksError(false);
    setEventTanksRefreshing(false);
    setVerifiedEventTanksContext(null);
    try {
      const [setup, inventory, loadedCorrection] = await Promise.all([
        fuelManagementService.getSetup(vesselId),
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
          loadedCorrection.kind !== 'REFUEL' ||
          loadedCorrection.status !== 'POSTED' ||
          loadedCorrection.sourceFuelLogId !== logId
        ) {
          throw new Error('This receipt is no longer available for correction.');
        }
        setCorrection(loadedCorrection);
      } else {
        setCorrection(null);
      }
      const initializedTankIds = new Set(
        inventory.tanks.filter((item) => item.initialized).map((item) => item.tank.id)
      );
      setInventoryReady(initializedTankIds.size > 0);
      setInventoryStatus(inventory.status);
      let nextUnit = setup.settings?.volumeUnit ?? 'LITRES';

      if (logId) {
        const [log, entries] = await Promise.all([
          fuelLogsService.getById(logId),
          fuelManagementService.getLogTankEntries(logId),
        ]);
        if (generation !== loadGeneration.current) return;
        if (!log || log.vesselId !== vesselId) {
          throw new Error('This fuel receipt is no longer available.');
        }
        if ((log.effectiveAt == null) !== (log.utcOffsetMinutes == null)) {
          throw new Error('This fuel receipt has incomplete historical ship-time evidence.');
        }
        setOriginalLog(log);
        const posted = !!log.currentInventoryOperationId;
        const correctingCurrentRevision =
          correctionMode &&
          canManageSetup &&
          loadedCorrection?.id === log.currentInventoryOperationId &&
          loadedCorrection?.sourceFuelLogId === log.id;
        setImmutablePosted(posted && !correctingCurrentRevision);
        const retainedTanks = await Promise.all(
          entries.map((entry) => fuelManagementService.getTankById(entry.fuelTankId, vesselId))
        );
        if (generation !== loadGeneration.current) return;
        const availableRetainedTanks = retainedTanks.filter((tank): tank is FuelTank => !!tank);
        setRetainedCorrectionTanks(
          correctingCurrentRevision || !posted ? availableRetainedTanks : []
        );
        const eligibleActiveTanks = setup.tanks.filter((tank) => initializedTankIds.has(tank.id));
        setTanks(
          correctingCurrentRevision
            ? mergeFuelCorrectionTanks(eligibleActiveTanks, availableRetainedTanks)
            : posted
              ? availableRetainedTanks
              : mergeFuelCorrectionTanks(setup.tanks, retainedTanks)
        );
        // The pre-tank Fuel Log explicitly stored and displayed gallons. Do not
        // reinterpret those historical values using a vessel's newer setup unit.
        const originalUnit = storedFuelVolumeUnit(log.volumeUnit);
        nextUnit = originalUnit;
        const persistedEventFields = loadedCorrection
          ? fuelEventFields(loadedCorrection.effectiveAt, loadedCorrection.utcOffsetMinutes)
          : log.effectiveAt
            ? fuelEventFields(log.effectiveAt, log.utcOffsetMinutes)
            : null;
        setLogDate(persistedEventFields?.date ?? log.logDate);
        setLogTime(persistedEventFields?.time ?? parseTime(log.logTime));
        if (persistedEventFields) {
          setUtcOffsetMinutes(persistedEventFields.utcOffsetMinutes);
        }
        setLocation(log.locationOfRefueling);
        setPricePerUnit(
          String(
            Number(convertUnitPrice(log.pricePerVolumeUnit, originalUnit, nextUnit).toFixed(4))
          )
        );
        setCurrencyCode(log.currencyCode || 'USD');
        setComment(log.comment || '');
        setAllocations(
          Object.fromEntries(
            entries.map((entry) => [
              entry.fuelTankId,
              String(Number(fromLitres(entry.amountLitres, nextUnit).toFixed(3))),
            ])
          )
        );
        setLegacyAllocationRequired(entries.length === 0);
        setLegacyOriginalAmount(entries.length === 0 ? log.amountOfFuel : null);
      } else {
        setOriginalLog(null);
        setImmutablePosted(false);
        setRetainedCorrectionTanks([]);
        const eligibleTanks =
          inventory.status === 'NOT_ACTIVATED'
            ? setup.tanks
            : setup.tanks.filter((tank) => initializedTankIds.has(tank.id));
        setTanks(eligibleTanks);
        setAllocations(Object.fromEntries(eligibleTanks.map((tank) => [tank.id, ''])));
        setLegacyAllocationRequired(false);
        setLegacyOriginalAmount(null);
      }
      setUnit(nextUnit);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel log form error:', error);
      setConfirmedHistoricalOffsetContext(null);
      setLoadError(
        error instanceof Error && error.message.includes('no longer available')
          ? error.message
          : 'Fuel receipt details could not be loaded. No changes can be saved until refresh succeeds.'
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [canManageSetup, correctionMode, correctionOperationId, logId, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        loadGeneration.current += 1;
        eventTanksGeneration.current += 1;
      };
    }, [load])
  );

  useEffect(() => {
    if (historicalOffsetConfirmationRequired) {
      eventTanksGeneration.current += 1;
      setVerifiedEventTanksContext(null);
      setEventTanksRefreshing(false);
      setEventTanksError(false);
      return;
    }
    if (
      !vesselId ||
      loading ||
      loadError ||
      waitingForCurrentContext ||
      !requiresEventTankCheck ||
      !eventTanksContext
    ) {
      return;
    }
    const generation = ++eventTanksGeneration.current;
    const eventAt = fuelEventDateTime(logDate, logTime, utcOffsetMinutes);
    setVerifiedEventTanksContext(null);
    setEventTanksError(false);
    if (!Number.isFinite(eventAt.getTime()) || eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      setEventTanksRefreshing(false);
      setEventTanksError(true);
      return;
    }
    let cancelled = false;
    setEventTanksRefreshing(true);
    const timer = setTimeout(async () => {
      try {
        const atEvent = await fuelManagementService.getInventorySnapshot(
          vesselId,
          eventAt.toISOString()
        );
        if (cancelled || generation !== eventTanksGeneration.current) return;
        const eligibleAtEvent = atEvent.tanks
          .filter(
            (item) =>
              !item.tank.archivedAt &&
              (correctionMode
                ? item.initialized && item.balanceLitres != null
                : legacyEditMode ||
                  inventoryStatus === 'NOT_ACTIVATED' ||
                  (item.initialized && item.balanceLitres != null))
          )
          .map((item) => item.tank);
        const retainedAtEvent = retainedCorrectionTanks.filter((tank) =>
          atEvent.tanks.some((item) => item.tank.id === tank.id)
        );
        const eligible =
          correctionMode || legacyEditMode
            ? mergeFuelCorrectionTanks(eligibleAtEvent, retainedAtEvent)
            : eligibleAtEvent;
        if (!correctionMode) setUnit(atEvent.displayUnit);
        setInventoryReady(atEvent.tanks.some((item) => item.initialized));
        setTanks(eligible);
        setAllocations((current) =>
          Object.fromEntries(eligible.map((tank) => [tank.id, current[tank.id] ?? '']))
        );
        setVerifiedEventTanksContext(eventTanksContext);
        setEventTanksError(false);
      } catch (error) {
        if (!cancelled && generation === eventTanksGeneration.current) {
          console.error('Load receipt event tank context error:', error);
          setVerifiedEventTanksContext(null);
          setEventTanksError(true);
        }
      } finally {
        if (!cancelled && generation === eventTanksGeneration.current) {
          setEventTanksRefreshing(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    correctionMode,
    eventTanksContext,
    eventTanksRetryNonce,
    historicalOffsetConfirmationRequired,
    inventoryStatus,
    isEdit,
    legacyEditMode,
    loadError,
    loading,
    logDate,
    logTime,
    requiresEventTankCheck,
    retainedCorrectionTanks,
    utcOffsetMinutes,
    vesselId,
    waitingForCurrentContext,
  ]);

  const displayedTanks = useMemo(
    () =>
      eventTanksBlocked ? (correctionMode || legacyEditMode ? retainedCorrectionTanks : []) : tanks,
    [correctionMode, eventTanksBlocked, legacyEditMode, retainedCorrectionTanks, tanks]
  );

  const parsedAllocations = useMemo(
    () =>
      displayedTanks.map((tank) => {
        const amount = parseDecimal(allocations[tank.id] ?? '');
        return { tank, amount: Number.isFinite(amount) && amount > 0 ? amount : 0 };
      }),
    [allocations, displayedTanks]
  );
  const totalAmount = parsedAllocations.reduce((total, entry) => total + entry.amount, 0);
  const parsedPrice = parseDecimal(pricePerUnit);
  const preservingLegacyUnallocatedAmount =
    isEdit && legacyAllocationRequired && totalAmount === 0 && legacyOriginalAmount != null;
  const receiptAmount = preservingLegacyUnallocatedAmount ? legacyOriginalAmount : totalAmount;
  const originalPriceUnchanged =
    !!originalLog &&
    Number.isFinite(parsedPrice) &&
    Math.abs(parsedPrice - originalLog.pricePerVolumeUnit) <= 0.000001;
  const totalPrice =
    preservingLegacyUnallocatedAmount && originalLog && originalPriceUnchanged
      ? originalLog.totalPrice
      : receiptAmount * (Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 0);
  const utcOffsetOptions = useMemo(
    () => fuelUtcOffsetOptions(utcOffsetMinutes),
    [utcOffsetMinutes]
  );
  const reportOnlyMode = !isEdit && inventoryStatus === 'NOT_ACTIVATED';

  const save = async (allowLegacyTotalChange = false) => {
    if (!vesselId) return;
    if (historicalOffsetConfirmationRequired) {
      Alert.alert(
        'Confirm historical UTC offset',
        'The original ship UTC offset was not recorded. Choose the correct historical offset and confirm it before changing the event time or tank allocation.'
      );
      return;
    }
    if (eventTanksBlocked) {
      Alert.alert(
        'Tank availability not verified',
        eventTanksError
          ? 'The tank setup at this ship time could not be loaded. Change the date or time, or retry before saving.'
          : 'Wait for the tank setup at this ship time to finish loading before saving.'
      );
      return;
    }
    if (isEdit && !canManageSetup) {
      Alert.alert('Manager access required', 'Only an HOD or Captain MOV can change a receipt.');
      return;
    }
    if (isEdit && !originalLog) {
      Alert.alert('Receipt unavailable', 'Refresh the receipt before trying again.');
      return;
    }
    if (correctionMode && !correction) {
      Alert.alert('Correction unavailable', 'Refresh fuel history and try again.');
      return;
    }
    if (immutablePosted) {
      Alert.alert(
        'Posted receipt is locked',
        'Fuel inventory records are append-only. Use the correction workflow from Fuel Inventory instead of silently changing this receipt.'
      );
      return;
    }
    if (!inventoryReady && !reportOnlyMode && !isEdit) {
      Alert.alert(
        'Opening levels required',
        canManageSetup
          ? 'Set an explicit opening level for at least one tank before recording a fuel receipt.'
          : 'An HOD or Captain MOV must set an opening level before fuel receipts can be recorded.'
      );
      return;
    }
    if (!location.trim()) {
      Alert.alert('Refuelling location required', 'Enter where the fuel was received.');
      return;
    }
    const positiveAllocations = parsedAllocations.filter((entry) => entry.amount > 0);
    const preserveLegacyWithoutAllocation =
      isEdit && legacyAllocationRequired && positiveAllocations.length === 0 && !!originalLog;
    if (positiveAllocations.length === 0 && !preserveLegacyWithoutAllocation) {
      Alert.alert('Add fuel to a tank', 'Enter an amount for at least one configured tank.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      Alert.alert(
        'Price required',
        `Enter a valid price per ${unitLongLabel(unit).toLowerCase()}.`
      );
      return;
    }
    if (isEdit && !amendmentReason.trim()) {
      Alert.alert(
        'Correction reason required',
        'Explain why the existing receipt must be changed.'
      );
      return;
    }
    if (
      legacyAllocationRequired &&
      !preserveLegacyWithoutAllocation &&
      legacyOriginalAmount != null &&
      Math.abs(totalAmount - legacyOriginalAmount) > 0.001 &&
      !allowLegacyTotalChange
    ) {
      Alert.alert(
        'Change historical fuel total?',
        `This legacy entry originally recorded ${legacyOriginalAmount.toLocaleString('en-US', {
          maximumFractionDigits: 3,
        })} US gal. Your tank allocations total ${totalAmount.toLocaleString('en-US', {
          maximumFractionDigits: 3,
        })} US gal. Only continue if you intend to replace the original total.`,
        [
          { text: 'Review allocations', style: 'cancel' },
          {
            text: 'Use new total',
            style: 'destructive',
            onPress: () => save(true),
          },
        ]
      );
      return;
    }

    const eventAt = preserveUnknownHistoricalTime
      ? null
      : fuelEventDateTime(logDate, logTime, utcOffsetMinutes);
    if (eventAt && !Number.isFinite(eventAt.getTime())) {
      Alert.alert('Check date and time', 'Choose a valid ship date, time and UTC offset.');
      return;
    }
    if (eventAt && eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      Alert.alert(
        'Check date and time',
        'A completed fuel receipt cannot be recorded in the future.'
      );
      return;
    }

    const log = {
      vesselId,
      locationOfRefueling: location.trim(),
      logDate,
      logTime: formatTime(logTime),
      amountOfFuel: preserveLegacyWithoutAllocation
        ? (legacyOriginalAmount ?? originalLog?.amountOfFuel ?? 0)
        : totalAmount,
      pricePerGallon: parsedPrice,
      totalPrice,
      createdByName: user?.name ?? '',
      volumeUnit: preserveLegacyWithoutAllocation ? (originalLog?.volumeUnit ?? null) : unit,
      currencyCode,
      comment: comment.trim(),
    };
    const entries = positiveAllocations.map((entry) => ({
      fuelTankId: entry.tank.id,
      amountLitres: toLitres(entry.amount, unit),
    }));

    setSaving(true);
    try {
      let createdLog: FuelLog | null = null;
      if (logId) {
        if (preserveUnknownHistoricalTime) {
          await fuelManagementService.updateFuelLogWithTankEntries(logId, {
            vesselId,
            log: {
              locationOfRefueling: location.trim(),
              pricePerGallon: parsedPrice,
              totalPrice,
              currencyCode,
              comment: comment.trim(),
            },
            entries: [],
            expectedRevision: correction?.revisionNo ?? originalLog?.inventoryRevision ?? 0,
            amendmentReason: amendmentReason.trim(),
          });
        } else {
          if (!eventAt) throw new Error('Fuel receipt event time is required.');
          await fuelManagementService.updateFuelLogWithTankEntries(logId, {
            vesselId,
            log,
            entries,
            effectiveAt: eventAt.toISOString(),
            utcOffsetMinutes,
            expectedRevision: correction?.revisionNo ?? originalLog?.inventoryRevision ?? 0,
            amendmentReason: amendmentReason.trim(),
          });
        }
      } else {
        if (!eventAt) throw new Error('Fuel receipt event time is required.');
        createdLog = await fuelManagementService.createFuelLogWithTankEntries({
          log,
          entries,
          effectiveAt: eventAt.toISOString(),
          utcOffsetMinutes,
        });
      }
      const legacyReportOnly = isEdit && !correctionMode;
      const createdReportOnly = !!createdLog && !createdLog.currentInventoryOperationId;
      Alert.alert(
        correctionMode
          ? 'Fuel receipt corrected'
          : legacyReportOnly
            ? 'Legacy receipt updated'
            : createdReportOnly
              ? 'Report-only receipt saved'
              : 'Fuel receipt saved',
        correctionMode
          ? 'A replacement revision was recorded and all affected tank balances were recalculated.'
          : legacyReportOnly
            ? preserveUnknownHistoricalTime
              ? 'The historical receipt was updated without inventing a ship UTC offset or tank allocation. It does not change calculated fuel inventory.'
              : 'The historical receipt and its report-only tank allocation were updated. It does not change calculated fuel inventory.'
            : createdReportOnly
              ? 'The receipt and its configured tank allocation were saved. Tank quantities remain unknown and no calculated fuel balance changed.'
              : 'The append-only fuel inventory ledger has been updated.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Save tank-aware fuel log error:', error);
      Alert.alert(
        'Could not save fuel entry',
        'The entry and its tank allocations were not changed. Please review the values and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to add fuel log entries.
        </Text>
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
            ? 'Correct Fuel Receipt'
            : isEdit
              ? 'Edit Legacy Receipt'
              : 'Create Fuel Receipt'
        }
      />
      {loading || waitingForCurrentContext ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Could not load
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>{loadError}</Text>
          <Button title="Retry" variant="outline" onPress={load} style={styles.emptyAction} />
        </View>
      ) : isEdit && !canManageSetup ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Manager access required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Only an HOD or Captain MOV can change an existing fuel receipt.
          </Text>
        </View>
      ) : immutablePosted ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Posted receipt
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            This receipt is part of the vessel's fuel inventory audit trail and cannot be edited in
            place.
          </Text>
          <Button
            title="Back to Fuel Receipts"
            onPress={() => navigation.goBack()}
            style={styles.emptyAction}
          />
        </View>
      ) : tanks.length === 0 && !legacyAllocationRequired ? (
        <View style={styles.center}>
          <Ionicons name="water-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Fuel setup required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            The vessel needs at least one shared fuel tank before entries can be allocated.
          </Text>
          {canManageSetup ? (
            <Button
              title="Set Up Fuel Tanks"
              onPress={() => navigation.navigate('FuelSetup')}
              style={styles.emptyAction}
            />
          ) : (
            <Text style={[styles.permissionHint, { color: themeColors.textSecondary }]}>
              Ask an HOD or Captain MOV to complete the setup.
            </Text>
          )}
        </View>
      ) : !inventoryReady && !reportOnlyMode && !isEdit ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Opening levels required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Nautical Ops will not infer empty tanks from historic fuel logs. Set an explicit opening
            quantity for at least one tank first.
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
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {legacyAllocationRequired ? (
            <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
              <Ionicons name="information-circle-outline" size={22} color={themeColors.accent} />
              <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
                This older entry recorded{' '}
                {legacyOriginalAmount?.toLocaleString('en-US', { maximumFractionDigits: 3 })} US gal
                and was not linked to tanks. You may leave every tank blank to preserve that fact,
                or add a historical allocation if the delivery evidence identifies the tanks. This
                does not change calculated fuel inventory.
              </Text>
            </View>
          ) : null}

          {reportOnlyMode ? (
            <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
              <Ionicons name="document-text-outline" size={22} color={COLORS.warning} />
              <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
                Report-only mode: opening levels have not been set. This receipt and its configured
                tank allocation will be kept as operational evidence without changing a calculated
                fuel balance.
              </Text>
            </View>
          ) : null}

          {eventTanksBlocked && !historicalOffsetConfirmationRequired ? (
            <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
              <Ionicons
                name={eventTanksError ? 'cloud-offline-outline' : 'time-outline'}
                size={22}
                color={eventTanksError ? COLORS.warning : themeColors.accent}
              />
              <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
                {eventTanksError
                  ? 'Tank availability at this ship time could not be verified. Change the date or time, or retry before saving.'
                  : 'Checking which tanks were available at this ship time…'}
              </Text>
              {eventTanksError ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setEventTanksRetryNonce((value) => value + 1)}
                  style={styles.noticeRetry}
                >
                  <Text style={[styles.noticeRetryText, { color: themeColors.accent }]}>Retry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <DateOnlyPicker
              label="Date"
              title="Select refuelling date"
              value={logDate}
              onChange={setLogDate}
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
                    {formatTime(logTime)}
                  </Text>
                  <DateTimePicker
                    value={logTime}
                    mode="time"
                    display="compact"
                    onChange={(_: DateTimePickerEvent, selected?: Date) => {
                      if (selected) setLogTime(selected);
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
                      {formatTime(logTime)}
                    </Text>
                    <Ionicons name="time-outline" size={22} color={themeColors.textSecondary} />
                  </TouchableOpacity>
                  {showTimePicker ? (
                    <DateTimePicker
                      value={logTime}
                      mode="time"
                      display="default"
                      is24Hour
                      onChange={(_: DateTimePickerEvent, selected?: Date) => {
                        setShowTimePicker(false);
                        if (selected) setLogTime(selected);
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
                      ? `${formatUtcOffset(utcOffsetMinutes)} is confirmed for this historical receipt.`
                      : `The original ship UTC offset was not recorded. ${formatUtcOffset(utcOffsetMinutes)} is only a suggestion from this device. You may leave the date, time and tank allocation unchanged to preserve the unknown offset, or confirm the correct historical offset before changing them.`}
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
              label="Refuelling Location"
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. Port Hercules, Monaco"
            />
          </View>

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
              Fuel added by tank
            </Text>
            {displayedTanks.length === 0 ? (
              <Text style={[styles.unallocatedMessage, { color: themeColors.textSecondary }]}>
                No vessel tanks are configured. This receipt will remain explicitly unallocated.
              </Text>
            ) : null}
            {displayedTanks.map((tank) => (
              <View key={tank.id} style={styles.allocationRow}>
                <View style={styles.allocationCopy}>
                  <Text
                    style={[styles.tankName, { color: themeColors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {tank.name}
                  </Text>
                  {tank.location ? (
                    <Text
                      style={[styles.tankLocation, { color: themeColors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {tank.location}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={[
                    styles.amountField,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <TextInput
                    value={allocations[tank.id] ?? ''}
                    onChangeText={(value) =>
                      setAllocations((current) => ({ ...current, [tank.id]: value }))
                    }
                    placeholder="0"
                    placeholderTextColor={themeColors.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.amountInput, { color: themeColors.textPrimary }]}
                  />
                  <Text style={[styles.amountUnit, { color: themeColors.textSecondary }]}>
                    {unitShortLabel(unit)}
                  </Text>
                </View>
              </View>
            ))}
            <View style={[styles.totalAmountRow, { borderTopColor: themeColors.border }]}>
              <Text style={[styles.totalAmountLabel, { color: themeColors.textSecondary }]}>
                {preservingLegacyUnallocatedAmount ? 'Recorded legacy total' : 'Total fuel added'}
              </Text>
              <Text style={[styles.totalAmountValue, { color: themeColors.textPrimary }]}>
                {receiptAmount.toLocaleString('en-US', { maximumFractionDigits: 3 })}{' '}
                {unitShortLabel(unit)}
              </Text>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <Input
              label={`Price per ${unitLongLabel(unit)}`}
              value={pricePerUnit}
              onChangeText={setPricePerUnit}
              placeholder="e.g. 1.08"
              keyboardType="decimal-pad"
            />
            <FuelSelectField
              label="Currency"
              value={currencyCode}
              options={CURRENCY_OPTIONS}
              onChange={setCurrencyCode}
              title="Select currency"
            />
            <View style={styles.totalPriceRow}>
              <Text style={[styles.totalPriceLabel, { color: themeColors.textSecondary }]}>
                Total Price
              </Text>
              <Text style={[styles.totalPriceValue, { color: themeColors.textPrimary }]}>
                {currencyTotal(currencyCode, totalPrice)}
              </Text>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <Input
              label="Comment"
              value={comment}
              onChangeText={setComment}
              placeholder="Fuel sample, supplier reference or other notes"
              multiline
            />
            {isEdit ? (
              <Input
                label={correctionMode ? 'Reason for correction' : 'Reason for change'}
                value={amendmentReason}
                onChangeText={setAmendmentReason}
                placeholder="Required: explain why the existing receipt is wrong"
                multiline
              />
            ) : null}
          </View>

          {isEdit ? (
            <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
              <Ionicons name="shield-checkmark-outline" size={22} color={themeColors.accent} />
              <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
                {correctionMode
                  ? 'Saving creates a replacement revision. The original receipt, both actors and the correction reason remain in the audit trail.'
                  : 'This receipt predates fuel inventory activation. Saving updates its retained report record without changing any calculated tank balance.'}
              </Text>
            </View>
          ) : null}

          <Button
            title={
              correctionMode
                ? 'Save Receipt Correction'
                : isEdit
                  ? 'Update Entry'
                  : reportOnlyMode
                    ? 'Save Report-Only Receipt'
                    : 'Save Entry'
            }
            onPress={save}
            loading={saving}
            disabled={saving || (eventTanksBlocked && !historicalOffsetConfirmationRequired)}
            fullWidth
          />
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
  permissionHint: { fontSize: FONTS.sm, marginTop: SPACING.sm, textAlign: 'center' },
  unallocatedMessage: { fontSize: FONTS.sm, lineHeight: 20, marginBottom: SPACING.md },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, gap: SPACING.md },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  noticeText: { flex: 1, fontSize: FONTS.sm, lineHeight: 20 },
  noticeRetry: { alignSelf: 'center', paddingHorizontal: SPACING.xs, paddingVertical: SPACING.xs },
  noticeRetryText: { fontSize: FONTS.sm, fontWeight: '700' },
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
  sectionTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.md },
  allocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  allocationCopy: { flex: 1, minWidth: 0 },
  tankName: { fontSize: FONTS.base, fontWeight: '600' },
  tankLocation: { fontSize: FONTS.xs, marginTop: 2 },
  amountField: {
    width: 138,
    height: 48,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  amountInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: SPACING.sm,
    fontSize: FONTS.base,
    textAlign: 'right',
  },
  amountUnit: {
    minWidth: 42,
    paddingHorizontal: SPACING.sm,
    fontSize: FONTS.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  totalAmountRow: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  totalAmountLabel: { fontSize: FONTS.sm, fontWeight: '600' },
  totalAmountValue: { fontSize: FONTS.base, fontWeight: '700' },
  totalPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  totalPriceLabel: { fontSize: FONTS.base, fontWeight: '600' },
  totalPriceValue: { fontSize: FONTS.xl, fontWeight: '800' },
});
