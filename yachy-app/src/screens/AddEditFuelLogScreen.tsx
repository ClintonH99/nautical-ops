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
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  DateOnlyPicker,
  Input,
  LoadingSpinner,
  PageHeader,
  TimePickerField,
} from '../components';
import { FuelSelectField } from '../components/FuelSelectField';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import fuelLogsService from '../services/fuelLogs';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import { FuelInventoryOperation, FuelLog, FuelTank, FuelVolumeUnit } from '../types';
import { fuelEventDateTime, fuelEventFields } from '../utils/fuelDateTime';
import { canPreserveUnknownReceiptTime } from '../utils/fuelHistoricalTime';
import { mergeFuelCorrectionTanks } from '../utils/fuelTankSelection';
import { convertFuelVolume, fromLitres, storedFuelVolumeUnit, toLitres } from '../utils/fuelUnits';

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
];

const VOLUME_UNIT_OPTIONS = [
  { value: 'LITRES' as const, label: 'Litres (L)' },
  { value: 'US_GALLONS' as const, label: 'US Gallons (US gal)' },
];

interface NewTankDraft {
  id: string;
  name: string;
  location: string;
  description: string;
  capacity: string;
  amountReceived: string;
}

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
  return Number.parseFloat(value.trim().replace(/\s/g, '').replace(/,/g, '.'));
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return '';
}

function roundDecimal(value: number, places: number): number {
  const factor = 10 ** places;
  const correction = Math.sign(value) * Number.EPSILON * Math.max(1, Math.abs(value));
  return Math.round((value + correction) * factor) / factor;
}

function convertedInputValue(
  value: string,
  fromUnit: FuelVolumeUnit,
  toUnit: FuelVolumeUnit
): string {
  const parsed = parseDecimal(value);
  if (!Number.isFinite(parsed)) return value;
  return String(Number(convertFuelVolume(parsed, fromUnit, toUnit).toFixed(3)));
}

function unitLongLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'Litre' : 'US Gallon';
}

function unitShortLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
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
  const [priceUnit, setPriceUnit] = useState<FuelVolumeUnit>('LITRES');
  const [setupRevision, setSetupRevision] = useState(0);
  const [setupCapacityLitres, setSetupCapacityLitres] = useState(0);
  const [configuredTankNames, setConfiguredTankNames] = useState<string[]>([]);
  const [newTanks, setNewTanks] = useState<NewTankDraft[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [logDate, setLogDate] = useState(localDateString());
  const [logTime, setLogTime] = useState(new Date());
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState(-new Date().getTimezoneOffset());
  const [location, setLocation] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [comment, setComment] = useState('');
  const [legacyAllocationRequired, setLegacyAllocationRequired] = useState(false);
  const [legacyOriginalAmount, setLegacyOriginalAmount] = useState<number | null>(null);
  const [immutablePosted, setImmutablePosted] = useState(false);
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
  const hasPositiveAllocationInput =
    Object.values(allocations).some((value) => {
      const amount = parseDecimal(value);
      return Number.isFinite(amount) && amount > 0;
    }) ||
    newTanks.some((tank) => {
      const amount = parseDecimal(tank.amountReceived);
      return Number.isFinite(amount) && amount > 0;
    });
  const originalLocalDateTimeUnchanged =
    !!originalLog &&
    logDate === originalLog.logDate &&
    formatTime(logTime) === formatTime(parseTime(originalLog.logTime));
  const preserveUnknownHistoricalTime = canPreserveUnknownReceiptTime({
    historicalTimeUnknown,
    offsetConfirmed: false,
    legacyAllocationRequired,
    hasPositiveAllocation: hasPositiveAllocationInput,
    localDateTimeUnchanged: originalLocalDateTimeUnchanged,
  });
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
      setNewTanks([]);
      setSetupRevision(0);
      setSetupCapacityLitres(0);
      setConfiguredTankNames([]);
      setRetainedCorrectionTanks([]);
      setVerifiedEventTanksContext(null);
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
      setPriceUnit('LITRES');
      setSetupRevision(0);
      setSetupCapacityLitres(0);
      setConfiguredTankNames([]);
      setNewTanks([]);
      setLogDate(localDateString(now));
      setLogTime(now);
      setUtcOffsetMinutes(-now.getTimezoneOffset());
      setLocation('');
      setPricePerUnit('');
      setCurrencyCode('USD');
      setComment('');
      setLegacyAllocationRequired(false);
      setLegacyOriginalAmount(null);
      setImmutablePosted(false);
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
          throw new Error('This receipt is no longer available for editing.');
        }
        setCorrection(loadedCorrection);
      } else {
        setCorrection(null);
      }
      const initializedTankIds = new Set(
        inventory.tanks.filter((item) => item.initialized).map((item) => item.tank.id)
      );
      setSetupRevision(setup.settings?.setupRevision ?? 0);
      setSetupCapacityLitres(setup.totalCapacityLitres);
      setConfiguredTankNames(setup.tanks.map((tank) => tank.name));
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
        setPricePerUnit(String(Number(log.pricePerVolumeUnit.toFixed(4))));
        setPriceUnit(log.priceVolumeUnit);
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
        // Every receipt is an independent refuelling record. A tank does not
        // need a remembered inventory balance before it can receive fuel.
        const eligibleTanks = setup.tanks;
        setTanks(eligibleTanks);
        setAllocations(Object.fromEntries(eligibleTanks.map((tank) => [tank.id, ''])));
        setLegacyAllocationRequired(false);
        setLegacyOriginalAmount(null);
        setPriceUnit(nextUnit);
      }
      setUnit(nextUnit);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel log form error:', error);
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
              (correctionMode ? item.initialized && item.balanceLitres != null : true)
          )
          .map((item) => item.tank);
        const retainedAtEvent = retainedCorrectionTanks.filter((tank) =>
          atEvent.tanks.some((item) => item.tank.id === tank.id)
        );
        const eligible =
          correctionMode || legacyEditMode
            ? mergeFuelCorrectionTanks(eligibleAtEvent, retainedAtEvent)
            : eligibleAtEvent;
        // Keep the user's selected receipt unit stable while date/time changes
        // refresh historical tank eligibility. Reinterpreting typed values in
        // a different unit would corrupt the receipt.
        setSetupCapacityLitres(atEvent.totalCapacityLitres);
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

  const changeVolumeUnit = (nextUnit: FuelVolumeUnit) => {
    if (nextUnit === unit || isEdit) return;
    setAllocations((current) =>
      Object.fromEntries(
        Object.entries(current).map(([tankId, value]) => [
          tankId,
          convertedInputValue(value, unit, nextUnit),
        ])
      )
    );
    setNewTanks((current) =>
      current.map((tank) => ({
        ...tank,
        capacity: convertedInputValue(tank.capacity, unit, nextUnit),
        amountReceived: convertedInputValue(tank.amountReceived, unit, nextUnit),
      }))
    );
    setUnit(nextUnit);
  };

  const addNewTank = () => {
    setNewTanks((current) => [
      ...current,
      {
        id: Crypto.randomUUID(),
        name: '',
        location: '',
        description: '',
        capacity: '',
        amountReceived: '',
      },
    ]);
  };

  const updateNewTank = (id: string, patch: Partial<NewTankDraft>) => {
    setNewTanks((current) =>
      current.map((tank) => (tank.id === id ? { ...tank, ...patch } : tank))
    );
  };

  const parsedAllocations = useMemo(
    () =>
      displayedTanks.map((tank) => {
        const amount = parseDecimal(allocations[tank.id] ?? '');
        const normalizedAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
        return {
          tank,
          amount: normalizedAmount,
        };
      }),
    [allocations, displayedTanks]
  );
  const parsedNewTanks = useMemo(
    () =>
      newTanks.map((tank) => {
        const capacity = parseDecimal(tank.capacity);
        const amount = parseDecimal(tank.amountReceived);
        return {
          tank,
          capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 0,
          amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        };
      }),
    [newTanks]
  );
  const existingAmount = parsedAllocations.reduce((total, entry) => total + entry.amount, 0);
  const newTankAmount = parsedNewTanks.reduce((total, entry) => total + entry.amount, 0);
  const totalAmount = existingAmount + newTankAmount;
  const canonicalDeliveredLitres = [...parsedAllocations, ...parsedNewTanks]
    .filter((entry) => entry.amount > 0)
    .reduce((total, entry) => total + roundDecimal(toLitres(entry.amount, unit), 3), 0);
  // Allocation rows are persisted independently at three-decimal litre
  // precision. Derive the parent quantity from those canonical children so an
  // unlimited multi-tank receipt cannot drift beyond the database invariant.
  const canonicalReceiptAmount = roundDecimal(fromLitres(canonicalDeliveredLitres, unit), 3);
  const newCapacityLitres = parsedNewTanks.reduce(
    (total, entry) => total + toLitres(entry.capacity, unit),
    0
  );
  const totalCapacityLitres = setupCapacityLitres + newCapacityLitres;
  const alternateUnit: FuelVolumeUnit = unit === 'LITRES' ? 'US_GALLONS' : 'LITRES';
  const displayedCapacity = fromLitres(totalCapacityLitres, unit);
  const alternateCapacity = fromLitres(totalCapacityLitres, alternateUnit);
  const parsedPrice = parseDecimal(pricePerUnit);
  const normalizedPrice = Number.isFinite(parsedPrice) ? roundDecimal(parsedPrice, 4) : 0;
  const preservingLegacyUnallocatedAmount =
    isEdit && legacyAllocationRequired && totalAmount === 0 && legacyOriginalAmount != null;
  const receiptAmount = preservingLegacyUnallocatedAmount
    ? legacyOriginalAmount
    : canonicalReceiptAmount;
  const originalPriceUnchanged =
    !!originalLog &&
    Number.isFinite(parsedPrice) &&
    priceUnit === originalLog.priceVolumeUnit &&
    Math.abs(normalizedPrice - originalLog.pricePerVolumeUnit) <= 0.000001;
  const pricedAmount = preservingLegacyUnallocatedAmount
    ? fromLitres(toLitres(receiptAmount, unit), priceUnit)
    : fromLitres(canonicalDeliveredLitres, priceUnit);
  const totalPrice =
    preservingLegacyUnallocatedAmount && originalLog && originalPriceUnchanged
      ? originalLog.totalPrice
      : pricedAmount * (normalizedPrice > 0 ? normalizedPrice : 0);
  const currencyOptions = useMemo(
    () =>
      CURRENCY_OPTIONS.some((option) => option.value === currencyCode)
        ? CURRENCY_OPTIONS
        : [...CURRENCY_OPTIONS, { value: currencyCode, label: currencyCode }],
    [currencyCode]
  );
  const save = async (allowLegacyTotalChange = false) => {
    if (!vesselId) return;
    if (eventTanksBlocked) {
      Alert.alert(
        'Tank availability not verified',
        eventTanksError
          ? 'The tank setup at the selected date and time could not be loaded. Change the date or time, or retry before saving.'
          : 'Wait for the tank setup at the selected date and time to finish loading before saving.'
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
      Alert.alert('Edit unavailable', 'Refresh fuel history and try again.');
      return;
    }
    if (immutablePosted) {
      Alert.alert('Posted receipt is locked', 'Open this receipt from Fuel History to edit it.');
      return;
    }
    if (!location.trim()) {
      Alert.alert('Refuelling location required', 'Enter where the fuel was received.');
      return;
    }
    const positiveAllocations = parsedAllocations.filter((entry) => entry.amount > 0);
    const positiveNewTankAllocations = parsedNewTanks.filter((entry) => entry.amount > 0);
    const preserveLegacyWithoutAllocation =
      isEdit &&
      legacyAllocationRequired &&
      positiveAllocations.length === 0 &&
      positiveNewTankAllocations.length === 0 &&
      !!originalLog;
    if (
      positiveAllocations.length === 0 &&
      positiveNewTankAllocations.length === 0 &&
      !preserveLegacyWithoutAllocation
    ) {
      Alert.alert('Add fuel to a tank', 'Enter an amount for at least one configured tank.');
      return;
    }
    if (!isEdit) {
      const overCapacity = positiveAllocations.find(
        (entry) => toLitres(entry.amount, unit) > entry.tank.capacityLitres
      );
      if (overCapacity) {
        const capacity = fromLitres(overCapacity.tank.capacityLitres, unit);
        Alert.alert(
          `${overCapacity.tank.name} exceeds capacity`,
          `This receipt starts with a blank fuel amount. Enter no more than ${formatVolume(capacity)} ${unitShortLabel(unit)} for this tank.`,
          [{ text: 'Review Amount' }]
        );
        return;
      }
    }
    if (newTanks.length > 0) {
      if (isEdit || !canManageSetup) {
        Alert.alert(
          'Manager access required',
          'Only an HOD or Captain MOV can add vessel tanks while creating a receipt.'
        );
        return;
      }
      const normalizedNames = [
        ...configuredTankNames.map((name) => name.trim().toLowerCase()),
        ...newTanks.map((tank) => tank.name.trim().toLowerCase()),
      ];
      if (
        newTanks.some((tank) => !tank.name.trim()) ||
        new Set(normalizedNames).size !== normalizedNames.length
      ) {
        Alert.alert('Check tank names', 'Every new tank needs a unique name.');
        return;
      }
      const invalidTank = parsedNewTanks.find(
        (entry) => entry.capacity <= 0 || entry.amount <= 0 || entry.amount > entry.capacity
      );
      if (invalidTank) {
        Alert.alert(
          'Check new tank details',
          'Each new tank needs a positive capacity and fuel amount. The fuel received cannot exceed the tank capacity.'
        );
        return;
      }
    }
    if (!Number.isFinite(parsedPrice) || normalizedPrice <= 0) {
      Alert.alert(
        'Price required',
        `Enter a valid price per ${unitLongLabel(priceUnit).toLowerCase()}.`
      );
      return;
    }
    if (
      legacyAllocationRequired &&
      !preserveLegacyWithoutAllocation &&
      legacyOriginalAmount != null &&
      Math.abs(receiptAmount - legacyOriginalAmount) > 0.001 &&
      !allowLegacyTotalChange
    ) {
      Alert.alert(
        'Change historical fuel total?',
        `This earlier entry originally recorded ${legacyOriginalAmount.toLocaleString('en-US', {
          maximumFractionDigits: 3,
        })} US gal. Your tank allocations total ${receiptAmount.toLocaleString('en-US', {
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
      Alert.alert('Check date and time', 'Choose a valid date and time.');
      return;
    }
    if (eventAt && eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      Alert.alert(
        'Check date and time',
        'A completed fuel receipt cannot be recorded in the future.'
      );
      return;
    }

    const normalizedTotalPrice = roundDecimal(totalPrice, 2);
    const log = {
      vesselId,
      locationOfRefueling: location.trim(),
      logDate,
      logTime: formatTime(logTime),
      amountOfFuel: preserveLegacyWithoutAllocation
        ? (legacyOriginalAmount ?? originalLog?.amountOfFuel ?? 0)
        : receiptAmount,
      pricePerGallon: normalizedPrice,
      priceVolumeUnit: priceUnit,
      totalPrice: normalizedTotalPrice,
      createdByName: user?.name ?? '',
      volumeUnit: preserveLegacyWithoutAllocation ? (originalLog?.volumeUnit ?? null) : unit,
      currencyCode,
      comment: comment.trim(),
    };
    const entries = positiveAllocations
      .map((entry) => ({
        fuelTankId: entry.tank.id,
        amountLitres: toLitres(entry.amount, unit),
      }))
      .concat(
        positiveNewTankAllocations.map((entry) => ({
          fuelTankId: entry.tank.id,
          amountLitres: toLitres(entry.amount, unit),
        }))
      );

    setSaving(true);
    try {
      if (logId) {
        if (preserveUnknownHistoricalTime) {
          await fuelManagementService.updateFuelLogWithTankEntries(logId, {
            vesselId,
            log: {
              locationOfRefueling: location.trim(),
              pricePerGallon: normalizedPrice,
              priceVolumeUnit: priceUnit,
              totalPrice: normalizedTotalPrice,
              currencyCode,
              comment: comment.trim(),
            },
            entries: [],
            expectedRevision: correction?.revisionNo ?? originalLog?.inventoryRevision ?? 0,
            amendmentReason: 'Edited by user',
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
            amendmentReason: 'Edited by user',
          });
        }
      } else {
        if (!eventAt) throw new Error('Fuel receipt event time is required.');
        await fuelManagementService.createFuelLogWithTankEntries({
          log,
          entries,
          newTanks: positiveNewTankAllocations.map((entry) => ({
            id: entry.tank.id,
            name: entry.tank.name.trim(),
            location: entry.tank.location.trim(),
            description: entry.tank.description.trim(),
            capacityLitres: toLitres(entry.capacity, unit),
            // Receipt quantities are standalone. The tank is saved for future
            // receipts, but this receipt does not establish an inventory level.
            openingLitres: 0,
          })),
          expectedSetupRevision: setupRevision,
          effectiveAt: eventAt.toISOString(),
          utcOffsetMinutes,
        });
      }
      Alert.alert(
        isEdit ? 'Fuel receipt updated.' : 'Fuel receipt saved',
        isEdit
          ? preserveUnknownHistoricalTime
            ? 'The earlier receipt was updated without adding missing timing or tank-allocation data.'
            : 'The fuel receipt and its tank allocations were updated.'
          : 'The receipt and its tank allocations were saved as a standalone refuelling record. Previous receipt quantities were not carried forward.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      const rawMessage = messageFromError(error);
      if (/exceed tank capacity/i.test(rawMessage)) {
        Alert.alert(
          'Fuel received exceeds tank capacity',
          'Each receipt starts blank. Check that the amount entered for each tank does not exceed that tank’s capacity.'
        );
        return;
      }
      console.error('Save tank-aware fuel log error:', error);
      const message =
        rawMessage ||
        'The entry and its tank allocations were not changed. Please review the values and try again.';
      Alert.alert('Could not save fuel entry', message);
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
      <PageHeader title={isEdit ? 'Edit Fuel Receipt' : 'Create Fuel Receipt'} />
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
      ) : tanks.length === 0 && !legacyAllocationRequired && (!canManageSetup || isEdit) ? (
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

          {eventTanksBlocked ? (
            <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
              <Ionicons
                name={eventTanksError ? 'cloud-offline-outline' : 'time-outline'}
                size={22}
                color={eventTanksError ? COLORS.warning : themeColors.accent}
              />
              <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
                {eventTanksError
                  ? 'Tank availability at the selected date and time could not be verified. Change the date or time, or retry before saving.'
                  : 'Checking which tanks were available at the selected date and time…'}
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
            <Input
              label="Location"
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. Port Hercules, Monaco"
            />
            <DateOnlyPicker
              label="Date"
              title="Select refuelling date"
              value={logDate}
              onChange={setLogDate}
            />
            <TimePickerField
              label="Time"
              title="Select Fuel Receipt Time"
              value={logTime}
              onChange={setLogTime}
              containerStyle={styles.field}
            />
          </View>

          <View style={[styles.capacityCard, { backgroundColor: themeColors.surface }]}>
            <View style={styles.capacityHeader}>
              <View style={styles.capacityCopy}>
                <Text style={[styles.capacityLabel, { color: themeColors.textPrimary }]}>
                  Total Fuel Capacity
                </Text>
                <Text style={[styles.capacityValue, { color: themeColors.textPrimary }]}>
                  {Math.round(displayedCapacity).toLocaleString('en-US')} {unitShortLabel(unit)}
                </Text>
                <Text style={[styles.capacityConversion, { color: themeColors.textSecondary }]}>
                  ≈ {Math.round(alternateCapacity).toLocaleString('en-US')}{' '}
                  {unitShortLabel(alternateUnit)}
                </Text>
              </View>
              <Ionicons name="water-outline" size={30} color={themeColors.accent} />
            </View>
            <FuelSelectField
              label="Fuel volume unit"
              value={unit}
              options={VOLUME_UNIT_OPTIONS}
              onChange={changeVolumeUnit}
              disabled={isEdit}
              title="Select fuel volume unit"
            />
            <Text style={[styles.capacityHint, { color: themeColors.textSecondary }]}>
              Capacity is calculated from the vessel tanks below so the total cannot drift out of
              sync.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
              Fuel received by tank
            </Text>
            {displayedTanks.length === 0 ? (
              <Text style={[styles.unallocatedMessage, { color: themeColors.textSecondary }]}>
                No existing vessel tanks are available at the selected date and time. Add a tank
                below to continue.
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
                  <Text style={[styles.tankCapacity, { color: themeColors.textSecondary }]}>
                    Capacity{' '}
                    {fromLitres(tank.capacityLitres, unit).toLocaleString('en-US', {
                      maximumFractionDigits: 3,
                    })}{' '}
                    {unitShortLabel(unit)}
                  </Text>
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

            {newTanks.map((tank, index) => (
              <View
                key={tank.id}
                style={[
                  styles.newTankCard,
                  {
                    backgroundColor: themeColors.background,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <View style={styles.newTankHeader}>
                  <View>
                    <Text style={[styles.newTankTitle, { color: themeColors.textPrimary }]}>
                      New Tank {index + 1}
                    </Text>
                    <Text style={[styles.newTankSubtitle, { color: themeColors.textSecondary }]}>
                      Saved to the vessel fuel setup with this receipt
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Remove new tank ${index + 1}`}
                    onPress={() =>
                      setNewTanks((current) => current.filter((item) => item.id !== tank.id))
                    }
                    style={styles.removeTankButton}
                  >
                    <Ionicons name="trash-outline" size={19} color={COLORS.error} />
                    <Text style={[styles.removeTankText, { color: COLORS.error }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
                <Input
                  label="Tank name"
                  value={tank.name}
                  onChangeText={(name) => updateNewTank(tank.id, { name })}
                  placeholder="e.g. Forward Starboard Tank"
                />
                <Input
                  label={`Tank capacity (${unitShortLabel(unit)})`}
                  value={tank.capacity}
                  onChangeText={(capacity) => updateNewTank(tank.id, { capacity })}
                  placeholder="e.g. 12000"
                  keyboardType="decimal-pad"
                />
                <Input
                  label={`Fuel received into tank (${unitShortLabel(unit)})`}
                  value={tank.amountReceived}
                  onChangeText={(amountReceived) => updateNewTank(tank.id, { amountReceived })}
                  placeholder="e.g. 8000"
                  keyboardType="decimal-pad"
                />
                <Input
                  label="Tank location"
                  value={tank.location}
                  onChangeText={(tankLocation) =>
                    updateNewTank(tank.id, { location: tankLocation })
                  }
                  placeholder="Optional — e.g. Forward machinery space"
                />
                <Input
                  label="Tank description"
                  value={tank.description}
                  onChangeText={(description) => updateNewTank(tank.id, { description })}
                  placeholder="Optional notes about this tank"
                  multiline
                />
              </View>
            ))}

            {canManageSetup && !isEdit ? (
              <Button
                title="＋  Add Tank"
                variant="outline"
                onPress={addNewTank}
                fullWidth
                style={styles.addTankButton}
              />
            ) : null}
            <View style={[styles.totalAmountRow, { borderTopColor: themeColors.border }]}>
              <Text style={[styles.totalAmountLabel, { color: themeColors.textSecondary }]}>
                {preservingLegacyUnallocatedAmount ? 'Recorded total' : 'Total fuel received'}
              </Text>
              <Text style={[styles.totalAmountValue, { color: themeColors.textPrimary }]}>
                {receiptAmount.toLocaleString('en-US', { maximumFractionDigits: 3 })}{' '}
                {unitShortLabel(unit)}
              </Text>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <Input
              label={`Price per ${unitLongLabel(priceUnit)}`}
              value={pricePerUnit}
              onChangeText={setPricePerUnit}
              placeholder="e.g. 1.08"
              keyboardType="decimal-pad"
            />
            <FuelSelectField
              label="Price unit"
              value={priceUnit}
              options={VOLUME_UNIT_OPTIONS}
              onChange={setPriceUnit}
              disabled={isEdit}
              title="Select price unit"
            />
            <FuelSelectField
              label="Currency"
              value={currencyCode}
              options={currencyOptions}
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
          </View>

          {isEdit ? (
            <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
              <Ionicons name="shield-checkmark-outline" size={22} color={themeColors.accent} />
              <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
                Saving updates this fuel receipt and its tank allocations.
              </Text>
            </View>
          ) : null}

          <Button
            title={isEdit ? 'Save Changes' : 'Create Fuel Receipt'}
            onPress={save}
            loading={saving}
            disabled={saving || eventTanksBlocked}
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
  capacityCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg },
  capacityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  capacityCopy: { flex: 1 },
  capacityLabel: { fontSize: FONTS.base, fontWeight: '700' },
  capacityValue: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  capacityConversion: { fontSize: FONTS.sm, marginTop: 2 },
  capacityHint: { fontSize: FONTS.xs, lineHeight: 18, marginTop: -SPACING.xs },
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
  tankCapacity: { fontSize: FONTS.xs, marginTop: 2 },
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
  newTankCard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  newTankHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  newTankTitle: { fontSize: FONTS.base, fontWeight: '700' },
  newTankSubtitle: { fontSize: FONTS.xs, marginTop: 2 },
  removeTankButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.xs,
  },
  removeTankText: { fontSize: FONTS.sm, fontWeight: '700' },
  addTankButton: { marginTop: SPACING.sm },
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
