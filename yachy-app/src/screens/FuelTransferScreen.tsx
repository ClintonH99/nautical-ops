import React, { useCallback, useMemo, useState } from 'react';
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
import { FuelTankBalance, FuelTransfer, FuelVolumeUnit } from '../types';
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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [balances, setBalances] = useState<FuelTankBalance[]>([]);
  const [originalTransfer, setOriginalTransfer] = useState<FuelTransfer | null>(null);
  const [sourceTankId, setSourceTankId] = useState<string | null>(null);
  const [destinationTankId, setDestinationTankId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [transferDate, setTransferDate] = useState(localDateString());
  const [transferTime, setTransferTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    if (!vesselId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [setup, tankBalances, existing] = await Promise.all([
        fuelManagementService.getSetup(vesselId),
        fuelManagementService.getTankBalances(vesselId),
        transferId ? fuelManagementService.getTransferById(transferId) : Promise.resolve(null),
      ]);
      const nextUnit = setup.settings?.volumeUnit ?? 'LITRES';
      setUnit(nextUnit);
      setBalances(tankBalances);
      if (existing) {
        setOriginalTransfer(existing);
        setSourceTankId(existing.sourceTankId);
        setDestinationTankId(existing.destinationTankId);
        setAmount(String(Number(fromLitres(existing.amountLitres, nextUnit).toFixed(3))));
        setTransferDate(existing.transferDate);
        setTransferTime(parseTime(existing.transferTime));
        setLocation(existing.location);
        setNotes(existing.notes);
      } else {
        setOriginalTransfer(null);
        setSourceTankId((current) => current ?? tankBalances[0]?.tank.id ?? null);
        setDestinationTankId(
          (current) =>
            current ??
            tankBalances.find((item) => item.tank.id !== tankBalances[0]?.tank.id)?.tank.id ??
            null
        );
      }
    } catch (error) {
      console.error('Load fuel transfer form error:', error);
      Alert.alert('Could not load fuel tanks', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [transferId, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const balanceBeforeTransfer = useCallback(
    (tankId: string | null): number => {
      if (!tankId) return 0;
      let recorded = balances.find((item) => item.tank.id === tankId)?.recordedVolumeLitres ?? 0;
      // Current balances already include the stored transfer while editing. Undo
      // it first so the preview and validation describe the replacement record.
      if (originalTransfer) {
        if (originalTransfer.sourceTankId === tankId) recorded += originalTransfer.amountLitres;
        if (originalTransfer.destinationTankId === tankId)
          recorded -= originalTransfer.amountLitres;
      }
      return recorded;
    },
    [balances, originalTransfer]
  );

  const sourceBalanceLitres = balanceBeforeTransfer(sourceTankId);
  const destinationBalanceLitres = balanceBeforeTransfer(destinationTankId);
  const parsedAmount = parseDecimal(amount);
  const amountLitres =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? toLitres(parsedAmount, unit) : 0;
  const sourceAfter = sourceBalanceLitres - amountLitres;
  const destinationAfter = destinationBalanceLitres + amountLitres;

  const tankOptions = useMemo<FuelSelectOption[]>(
    () =>
      balances.map((item) => ({
        value: item.tank.id,
        label: item.tank.name,
        description: `${formatVolume(fromLitres(balanceBeforeTransfer(item.tank.id), unit))} ${unitLabel(unit)} recorded`,
      })),
    [balanceBeforeTransfer, balances, unit]
  );

  const saveTransfer = async () => {
    if (!vesselId) return;
    if (!sourceTankId || !destinationTankId) {
      Alert.alert('Select both tanks', 'Choose a source and destination tank.');
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
    if (amountLitres > sourceBalanceLitres + 0.0005) {
      Alert.alert(
        'Not enough recorded fuel',
        `The source tank has ${formatVolume(fromLitres(sourceBalanceLitres, unit))} ${unitLabel(unit)} recorded.`
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
      location: location.trim(),
      notes: notes.trim(),
    };

    setSaving(true);
    try {
      if (transferId) await fuelManagementService.updateTransfer(transferId, input);
      else await fuelManagementService.createTransfer(input);
      Alert.alert(
        transferId ? 'Transfer updated' : 'Transfer saved',
        'Tank balances are now up to date.',
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={transferId ? 'Edit Fuel Transfer' : 'Fuel Transfer'} />
      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : balances.length < 2 ? (
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
          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <FuelSelectField
              label="From (Source Tank)"
              value={sourceTankId}
              options={tankOptions.filter((option) => option.value !== destinationTankId)}
              onChange={setSourceTankId}
              title="Select source tank"
            />
            <FuelSelectField
              label="To (Destination Tank)"
              value={destinationTankId}
              options={tankOptions.filter((option) => option.value !== sourceTankId)}
              onChange={setDestinationTankId}
              title="Select destination tank"
            />
            <Input
              label={`Amount (${unitLabel(unit)})`}
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 500"
              keyboardType="decimal-pad"
            />
          </View>

          {sourceTankId && destinationTankId && amountLitres > 0 ? (
            <View style={[styles.previewCard, { backgroundColor: themeColors.surfaceAlt }]}>
              <Text style={[styles.previewTitle, { color: themeColors.textPrimary }]}>
                After transfer
              </Text>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: themeColors.textPrimary }]}>
                  {balances.find((item) => item.tank.id === sourceTankId)?.tank.name}
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
                  {balances.find((item) => item.tank.id === destinationTankId)?.tank.name}
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
          </View>

          <Button
            title={transferId ? 'Update Transfer' : 'Save Transfer'}
            onPress={saveTransfer}
            loading={saving}
            disabled={saving}
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
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, gap: SPACING.md },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  previewCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  previewTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.xs },
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
