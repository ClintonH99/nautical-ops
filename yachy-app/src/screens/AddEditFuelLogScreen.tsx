/**
 * Tank-aware vessel fuel log entry.
 *
 * The legacy fuel_logs row is still maintained for historical exports while
 * canonical tank allocations are saved atomically in litres.
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { BORDER_RADIUS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import fuelLogsService from '../services/fuelLogs';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import { FuelTank, FuelVolumeUnit } from '../types';
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
  const isEdit = Boolean(logId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tanks, setTanks] = useState<FuelTank[]>([]);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [logDate, setLogDate] = useState(localDateString());
  const [logTime, setLogTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [location, setLocation] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [comment, setComment] = useState('');
  const [legacyAllocationRequired, setLegacyAllocationRequired] = useState(false);
  const [legacyOriginalAmount, setLegacyOriginalAmount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!vesselId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const setup = await fuelManagementService.getSetup(vesselId);
      let nextUnit = setup.settings?.volumeUnit ?? 'LITRES';
      setTanks(setup.tanks);

      if (logId) {
        const [log, entries] = await Promise.all([
          fuelLogsService.getById(logId),
          fuelManagementService.getLogTankEntries(logId),
        ]);
        if (!log) throw new Error('Fuel log not found.');
        // The pre-tank Fuel Log explicitly stored and displayed gallons. Do not
        // reinterpret those historical values using a vessel's newer setup unit.
        const originalUnit = storedFuelVolumeUnit(log.volumeUnit);
        nextUnit = originalUnit;
        setLogDate(log.logDate);
        setLogTime(parseTime(log.logTime));
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
        setAllocations(Object.fromEntries(setup.tanks.map((tank) => [tank.id, ''])));
        setLegacyAllocationRequired(false);
        setLegacyOriginalAmount(null);
      }
      setUnit(nextUnit);
    } catch (error) {
      console.error('Load fuel log form error:', error);
      Alert.alert('Could not load fuel entry', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [logId, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const parsedAllocations = useMemo(
    () =>
      tanks.map((tank) => {
        const amount = parseDecimal(allocations[tank.id] ?? '');
        return { tank, amount: Number.isFinite(amount) && amount > 0 ? amount : 0 };
      }),
    [allocations, tanks]
  );
  const totalAmount = parsedAllocations.reduce((total, entry) => total + entry.amount, 0);
  const parsedPrice = parseDecimal(pricePerUnit);
  const totalPrice =
    totalAmount * (Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 0);

  const save = async (allowLegacyTotalChange = false) => {
    if (!vesselId) return;
    if (!location.trim()) {
      Alert.alert('Refuelling location required', 'Enter where the fuel was received.');
      return;
    }
    const positiveAllocations = parsedAllocations.filter((entry) => entry.amount > 0);
    if (positiveAllocations.length === 0) {
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
    if (
      legacyAllocationRequired &&
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

    const log = {
      vesselId,
      locationOfRefueling: location.trim(),
      logDate,
      logTime: formatTime(logTime),
      amountOfFuel: totalAmount,
      pricePerGallon: parsedPrice,
      totalPrice,
      createdByName: user?.name ?? '',
      volumeUnit: unit,
      currencyCode,
      comment: comment.trim(),
    };
    const entries = positiveAllocations.map((entry) => ({
      fuelTankId: entry.tank.id,
      amountLitres: toLitres(entry.amount, unit),
    }));

    setSaving(true);
    try {
      if (logId) {
        await fuelManagementService.updateFuelLogWithTankEntries(logId, {
          vesselId,
          log,
          entries,
        });
      } else {
        await fuelManagementService.createFuelLogWithTankEntries({ log, entries });
      }
      Alert.alert(
        isEdit ? 'Fuel entry updated' : 'Fuel entry saved',
        'The tank allocations are up to date.',
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
      <PageHeader title={isEdit ? 'Edit Fuel Log Entry' : 'New Fuel Log Entry'} />
      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : tanks.length === 0 ? (
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
                and was not linked to tanks. Allocate that total below before saving.
              </Text>
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
              <Text style={[styles.label, { color: themeColors.textPrimary }]}>Time</Text>
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
            {tanks.map((tank) => (
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
                Total fuel added
              </Text>
              <Text style={[styles.totalAmountValue, { color: themeColors.textPrimary }]}>
                {totalAmount.toLocaleString('en-US', { maximumFractionDigits: 3 })}{' '}
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
          </View>

          <Button
            title={isEdit ? 'Update Entry' : 'Save Entry'}
            onPress={save}
            loading={saving}
            disabled={saving}
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
