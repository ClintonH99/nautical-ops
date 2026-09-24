import React, { useCallback, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  DateOnlyPicker,
  Input,
  LoadingSpinner,
  PageHeader,
  TimePickerField,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import type { FuelInventoryOperation, FuelTank, FuelVolumeUnit } from '../types';
import { fuelEventDateTime, fuelEventFields } from '../utils/fuelDateTime';
import { fromLitres, toLitres } from '../utils/fuelUnits';

interface OpeningTank {
  tank: FuelTank;
  initialized: boolean;
}

function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function parseDecimal(value: string): number {
  return Number.parseFloat(value.trim().replace(/,/g, '.'));
}

function unitLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

export const FuelOpeningBalancesScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canManage = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
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
  const [tanks, setTanks] = useState<OpeningTank[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [entryDate, setEntryDate] = useState(localDateString());
  const [entryTime, setEntryTime] = useState(new Date());
  const [utcOffsetMinutes, setUtcOffsetMinutes] = useState(-new Date().getTimezoneOffset());
  const [notes, setNotes] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const loadGeneration = useRef(0);
  const requestedContext = useRef<string | null>(null);
  const currentContext = vesselId ? `${vesselId}:${correctionOperationId ?? ''}` : null;
  const waitingForCurrentContext = requestedContext.current !== currentContext;

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedContext.current = null;
      setLoadError(null);
      setCorrection(null);
      setTanks([]);
      setAmounts({});
      setNotes('');
      setAmendmentReason('');
      requestRef.current = null;
      setLoading(false);
      return;
    }
    requestedContext.current = `${vesselId}:${correctionOperationId ?? ''}`;
    setLoading(true);
    setLoadError(null);
    setCorrection(null);
    setTanks([]);
    setAmounts({});
    setNotes('');
    setAmendmentReason('');
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
          loadedCorrection.kind !== 'OPENING' ||
          loadedCorrection.status !== 'POSTED'
        ) {
          throw new Error('These opening levels are no longer available for correction.');
        }
      }
      const correctionTankIds = loadedCorrection
        ? loadedCorrection.postings.map((posting) => posting.tankId)
        : [];
      const retainedCorrectionTanks = correctionMode
        ? await Promise.all(
            correctionTankIds.map((tankId) => fuelManagementService.getTankById(tankId, vesselId))
          )
        : [];
      if (generation !== loadGeneration.current) return;
      const nextUnit = snapshot.displayUnit;
      const nextTanks = correctionMode
        ? retainedCorrectionTanks
            .filter((tank): tank is FuelTank => !!tank)
            .map((tank) => ({ tank, initialized: false }))
        : snapshot.tanks.map((item) => ({
            tank: item.tank,
            initialized: item.initialized,
          }));
      const now = new Date();
      if (loadedCorrection) {
        const fields = fuelEventFields(
          loadedCorrection.effectiveAt,
          loadedCorrection.utcOffsetMinutes
        );
        setCorrection(loadedCorrection);
        setEntryDate(fields.date);
        setEntryTime(fields.time);
        setUtcOffsetMinutes(fields.utcOffsetMinutes);
        setNotes(
          typeof loadedCorrection.metadata.notes === 'string' ? loadedCorrection.metadata.notes : ''
        );
      } else {
        setEntryDate(localDateString(now));
        setEntryTime(now);
        setUtcOffsetMinutes(-now.getTimezoneOffset());
      }
      setUnit(nextUnit);
      setTanks(nextTanks);
      setAmounts(
        Object.fromEntries(
          nextTanks.map((item) => {
            const opening = loadedCorrection?.postings.find(
              (posting) => posting.tankId === item.tank.id
            );
            return [
              item.tank.id,
              opening ? String(Number(fromLitres(opening.amountLitres, nextUnit).toFixed(3))) : '',
            ];
          })
        )
      );
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load opening fuel levels error:', error);
      setLoadError(
        error instanceof Error && error.message.includes('no longer available')
          ? error.message
          : 'Opening levels could not be loaded. No changes can be saved until refresh succeeds.'
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [correctionMode, correctionOperationId, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load])
  );

  const uninitialized = useMemo(
    () => (correctionMode ? tanks : tanks.filter((item) => !item.initialized)),
    [correctionMode, tanks]
  );
  const save = async () => {
    if (
      !vesselId ||
      !canManage ||
      uninitialized.length === 0 ||
      loadError ||
      waitingForCurrentContext
    ) {
      return;
    }
    if (correctionMode && !correction) {
      Alert.alert('Correction unavailable', 'Refresh fuel history and try again.');
      return;
    }
    const eventAt = fuelEventDateTime(entryDate, entryTime, utcOffsetMinutes);
    if (!Number.isFinite(eventAt.getTime())) {
      Alert.alert('Check date and time', 'Choose a valid date and time.');
      return;
    }
    if (eventAt.getTime() > Date.now() + 5 * 60 * 1000) {
      Alert.alert('Check date and time', 'Opening levels cannot be recorded in the future.');
      return;
    }

    const entries: Array<{ tankId: string; amountLitres: number }> = [];
    for (const item of uninitialized) {
      const rawAmount = amounts[item.tank.id];
      if (rawAmount === undefined || rawAmount.trim() === '') {
        Alert.alert(
          'Every tank needs a level',
          `Enter the opening quantity for ${item.tank.name}. Enter 0 if it is empty.`
        );
        return;
      }
      const amount = parseDecimal(rawAmount);
      const amountLitres = toLitres(amount, unit);
      if (!Number.isFinite(amount) || amount < 0) {
        Alert.alert('Check opening quantity', `${item.tank.name} must be zero or greater.`);
        return;
      }
      if (amountLitres > item.tank.capacityLitres + 0.0005) {
        Alert.alert(
          'Opening quantity exceeds capacity',
          `${item.tank.name} has a capacity of ${formatVolume(
            fromLitres(item.tank.capacityLitres, unit)
          )} ${unitLabel(unit)}.`
        );
        return;
      }
      entries.push({ tankId: item.tank.id, amountLitres });
    }
    if (correctionMode && !amendmentReason.trim()) {
      Alert.alert(
        'Correction reason required',
        'Explain why the opening levels are being replaced.'
      );
      return;
    }

    setSaving(true);
    try {
      const fingerprint = JSON.stringify({
        vesselId,
        operationId: correction?.id ?? null,
        expectedRevision: correction?.revisionNo ?? null,
        occurredAt: eventAt.toISOString(),
        utcOffsetMinutes,
        entries,
        notes: notes.trim(),
        amendmentReason: amendmentReason.trim(),
      });
      if (requestRef.current?.fingerprint !== fingerprint) {
        requestRef.current = { fingerprint, id: Crypto.randomUUID() };
      }
      if (correction) {
        await fuelManagementService.amendOpeningInventory({
          operationId: correction.id,
          expectedRevision: correction.revisionNo,
          occurredAt: eventAt.toISOString(),
          utcOffsetMinutes,
          entries,
          notes: notes.trim() || undefined,
          amendmentReason: amendmentReason.trim(),
          idempotencyKey: requestRef.current.id,
        });
      } else {
        await fuelManagementService.activateInventory({
          vesselId,
          occurredAt: eventAt.toISOString(),
          utcOffsetMinutes,
          entries,
          notes: notes.trim() || undefined,
          idempotencyKey: requestRef.current.id,
        });
      }
      Alert.alert(
        correctionMode ? 'Opening levels corrected' : 'Opening levels saved',
        correctionMode
          ? 'A replacement revision was recorded and all affected tank balances were recalculated.'
          : 'The fuel inventory is initialized. Future receipts, transfers, consumption and soundings will update the calculated levels.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Save opening fuel levels error:', error);
      const message = error instanceof Error ? error.message : '';
      Alert.alert(
        'Could not save opening levels',
        message || 'No levels were saved. Refresh the tank setup and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to initialize fuel inventory.
        </Text>
      </View>
    );
  }

  if (!canManage) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <PageHeader title={correctionMode ? 'Correct Opening Levels' : 'Opening Fuel Levels'} />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Manager access required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Only an HOD or Captain MOV can establish opening tank quantities.
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
      <PageHeader title={correctionMode ? 'Correct Opening Levels' : 'Opening Fuel Levels'} />
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
      ) : tanks.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="water-outline" size={44} color={themeColors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            Fuel setup required
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Add the vessel fuel tanks before setting their opening levels.
          </Text>
          <Button
            title="Open Fuel Setup"
            onPress={() => navigation.navigate('FuelSetup')}
            style={styles.centerAction}
          />
        </View>
      ) : !correctionMode && uninitialized.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={48} color={COLORS.success} />
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
            All tanks initialized
          </Text>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Opening levels are immutable audit records. Use a sounding to verify the current
            physical quantity.
          </Text>
          <Button
            title="Back to Fuel"
            onPress={() => navigation.navigate('FuelInventory')}
            style={styles.centerAction}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.notice, { backgroundColor: themeColors.surfaceAlt }]}>
            <Ionicons name="information-circle-outline" size={24} color={themeColors.accent} />
            <Text style={[styles.noticeText, { color: themeColors.textPrimary }]}>
              {correctionMode
                ? 'Enter the quantities that were actually present on the displayed historical opening date. The original time is retained automatically.'
                : 'Enter the physical quantity currently in every uninitialized tank. Use 0 only when a tank is known to be empty. Historic fuel receipts are not used to guess these values.'}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <DateOnlyPicker
              label="Date"
              title="Select opening date"
              value={entryDate}
              onChange={setEntryDate}
            />
            {!correctionMode ? (
              <>
                <TimePickerField
                  label="Time"
                  title="Select Opening Level Time"
                  value={entryTime}
                  onChange={setEntryTime}
                  containerStyle={styles.field}
                />
              </>
            ) : null}
          </View>

          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
            Tank quantities
          </Text>
          {uninitialized.map((item) => (
            <View
              key={item.tank.id}
              style={[styles.tankCard, { backgroundColor: themeColors.surface }]}
            >
              <View style={styles.tankHeader}>
                <View style={styles.tankCopy}>
                  <Text style={[styles.tankName, { color: themeColors.textPrimary }]}>
                    {item.tank.name}
                  </Text>
                  {item.tank.location ? (
                    <Text style={[styles.tankLocation, { color: themeColors.textSecondary }]}>
                      {item.tank.location}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.capacity, { color: themeColors.textSecondary }]}>
                  Capacity {formatVolume(fromLitres(item.tank.capacityLitres, unit))}{' '}
                  {unitLabel(unit)}
                </Text>
              </View>
              <Input
                label={`Opening quantity (${unitLabel(unit)})`}
                value={amounts[item.tank.id] ?? ''}
                onChangeText={(value) =>
                  setAmounts((current) => ({ ...current, [item.tank.id]: value }))
                }
                placeholder="Enter 0 if empty"
                keyboardType="decimal-pad"
              />
            </View>
          ))}

          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <Input
              label="Note (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Initial physical tank sounding"
              multiline
            />
            {correctionMode ? (
              <Input
                label="Reason for correction"
                value={amendmentReason}
                onChangeText={setAmendmentReason}
                placeholder="Required: explain why the original opening levels are wrong"
                multiline
              />
            ) : null}
          </View>

          <View style={[styles.auditNotice, { borderColor: themeColors.border }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={themeColors.accent} />
            <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
              {correctionMode
                ? 'This creates a replacement revision. The original opening levels, actors and correction reason remain in the audit history.'
                : 'Opening levels are permanent audit records. Corrections are recorded separately; they are not silently overwritten.'}
            </Text>
          </View>
          {!correctionMode ? (
            <View style={[styles.auditNotice, { borderColor: COLORS.warning }]}>
              <Ionicons name="warning-outline" size={20} color={COLORS.warning} />
              <Text style={[styles.auditText, { color: themeColors.textSecondary }]}>
                Rollout safety: confirm every crew device is running the new fuel-inventory app
                version before initializing. Older app versions cannot change fuel records after
                this vessel switches to audited inventory.
              </Text>
            </View>
          ) : null}
          <Button
            title={correctionMode ? 'Save Opening Correction' : 'Initialize Fuel Inventory'}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  centerAction: { marginTop: SPACING.lg, minWidth: 200 },
  message: { fontSize: FONTS.base, lineHeight: 22, textAlign: 'center' },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, gap: SPACING.md },
  notice: {
    flexDirection: 'row',
    gap: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
  },
  noticeText: { flex: 1, fontSize: FONTS.sm, lineHeight: 21 },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
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
  sectionTitle: { fontSize: FONTS.xl, fontWeight: '700', marginTop: SPACING.sm },
  tankCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  tankHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  tankCopy: { flex: 1 },
  tankName: { fontSize: FONTS.base, fontWeight: '700' },
  tankLocation: { fontSize: FONTS.sm, marginTop: 2 },
  capacity: { fontSize: FONTS.xs, textAlign: 'right' },
  auditNotice: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  auditText: { flex: 1, fontSize: FONTS.xs, lineHeight: 18 },
});
