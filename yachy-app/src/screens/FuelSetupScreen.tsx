import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Input, LoadingSpinner, PageHeader } from '../components';
import { FuelSelectField } from '../components/FuelSelectField';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import { FuelSetupTankInput, FuelVolumeUnit } from '../types';
import {
  commitFuelCapacityDraft,
  displayFuelCapacityInUnit,
  fuelCapacityDraftFromLitres,
} from '../utils/fuelSetupCapacity';
import { convertFuelVolume } from '../utils/fuelUnits';

interface TankDraft {
  key: string;
  id?: string;
  name: string;
  location: string;
  description: string;
  capacity: string;
  capacityLitres: number | null;
  capacityDirty: boolean;
}

const UNIT_OPTIONS = [
  { label: 'Litres (L)', value: 'LITRES' as const },
  { label: 'US gallons (US gal)', value: 'US_GALLONS' as const },
];

function parseDecimal(value: string): number {
  return Number.parseFloat(value.trim().replace(/,/g, '.'));
}

function formatVolume(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function unitShortLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return 'Could not save the vessel fuel setup.';
}

export const FuelSetupScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canEdit = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadedVesselId, setLoadedVesselId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [setupRevision, setSetupRevision] = useState(0);
  const [tanks, setTanks] = useState<TankDraft[]>([]);
  const [editor, setEditor] = useState<TankDraft | null>(null);
  const loadGeneration = useRef(0);
  const requestedVesselId = useRef<string | null>(null);
  const currentVesselId = useRef<string | null>(vesselId);
  currentVesselId.current = vesselId;

  const loadSetup = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedVesselId.current = null;
      setLoadedVesselId(null);
      setTanks([]);
      setLoadError(null);
      setEditor(null);
      setSaving(false);
      setLoading(false);
      return;
    }
    requestedVesselId.current = vesselId;
    setLoading(true);
    setSaving(false);
    setLoadError(null);
    setLoadedVesselId(null);
    setTanks([]);
    setEditor(null);
    try {
      const setup = await fuelManagementService.getSetup(vesselId);
      if (generation !== loadGeneration.current) return;
      const nextUnit = setup.settings?.volumeUnit ?? 'LITRES';
      setUnit(nextUnit);
      setSetupRevision(setup.settings?.setupRevision ?? 0);
      setTanks(
        setup.tanks.map((tank) => ({
          key: tank.id,
          id: tank.id,
          name: tank.name,
          location: tank.location,
          description: tank.description,
          ...fuelCapacityDraftFromLitres(tank.capacityLitres, nextUnit),
        }))
      );
      setLoadedVesselId(vesselId);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel setup error:', error);
      setLoadError(
        'Fuel setup could not be loaded. No setup changes can be saved until refresh succeeds.'
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadSetup();
      return () => {
        loadGeneration.current += 1;
      };
    }, [loadSetup])
  );

  const totalCapacity = useMemo(
    () =>
      tanks.reduce((total, tank) => {
        const value = parseDecimal(tank.capacity);
        return total + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0),
    [tanks]
  );

  const alternateUnit: FuelVolumeUnit = unit === 'LITRES' ? 'US_GALLONS' : 'LITRES';
  const alternateCapacity = convertFuelVolume(totalCapacity, unit, alternateUnit);

  const changeUnit = (nextUnit: FuelVolumeUnit) => {
    if (nextUnit === unit) return;
    setTanks((current) => current.map((tank) => displayFuelCapacityInUnit(tank, nextUnit)));
    setUnit(nextUnit);
  };

  const openNewTank = () => {
    setEditor({
      key: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: '',
      location: '',
      description: '',
      capacity: '',
      capacityLitres: null,
      capacityDirty: true,
    });
  };

  const saveEditor = () => {
    if (!editor) return;
    const name = editor.name.trim();
    const capacityDraft = commitFuelCapacityDraft(editor, unit);
    if (!name) {
      Alert.alert('Tank name required', 'Give this tank a clear name.');
      return;
    }
    if (!capacityDraft) {
      Alert.alert('Capacity required', 'Enter a tank capacity greater than zero.');
      return;
    }
    const duplicate = tanks.some(
      (tank) => tank.key !== editor.key && tank.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      Alert.alert('Duplicate tank name', 'Tank names must be unique for this vessel.');
      return;
    }
    const cleaned: TankDraft = {
      ...capacityDraft,
      name,
      location: editor.location.trim(),
      description: editor.description.trim(),
    };
    setTanks((current) => {
      const index = current.findIndex((tank) => tank.key === cleaned.key);
      if (index === -1) return [...current, cleaned];
      return current.map((tank) => (tank.key === cleaned.key ? cleaned : tank));
    });
    setEditor(null);
  };

  const requestDeleteEditor = () => {
    if (!editor) return;
    Alert.alert(
      'Remove tank from setup?',
      'The change is not applied until you save the vessel fuel setup.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setTanks((current) => current.filter((tank) => tank.key !== editor.key));
            setEditor(null);
          },
        },
      ]
    );
  };

  const saveSetup = async () => {
    if (!vesselId || !canEdit || loadError || loadedVesselId !== vesselId) return;
    if (tanks.length === 0) {
      Alert.alert('Add a tank', 'Configure at least one fuel tank before saving.');
      return;
    }

    const names = tanks.map((tank) => tank.name.trim().toLowerCase());
    if (names.some((name) => !name) || new Set(names).size !== names.length) {
      Alert.alert('Check tank names', 'Every tank needs a unique name.');
      return;
    }

    const tankInputs: FuelSetupTankInput[] = [];
    for (const tank of tanks) {
      if (
        tank.capacityLitres == null ||
        !Number.isFinite(tank.capacityLitres) ||
        tank.capacityLitres <= 0
      ) {
        Alert.alert(
          'Check tank capacities',
          `Enter a valid capacity for ${tank.name || 'each tank'}.`
        );
        return;
      }
      tankInputs.push({
        id: tank.id,
        name: tank.name.trim(),
        location: tank.location.trim(),
        description: tank.description.trim(),
        capacityLitres: tank.capacityLitres,
      });
    }

    const generation = loadGeneration.current;
    const targetVesselId = vesselId;
    const submittedUnit = unit;
    setSaving(true);
    try {
      const saved = await fuelManagementService.saveSetup({
        vesselId: targetVesselId,
        volumeUnit: submittedUnit,
        tanks: tankInputs,
        expectedRevision: setupRevision,
      });
      if (
        generation !== loadGeneration.current ||
        requestedVesselId.current !== targetVesselId ||
        currentVesselId.current !== targetVesselId
      ) {
        return;
      }
      setUnit(submittedUnit);
      setSetupRevision(saved.settings?.setupRevision ?? setupRevision + 1);
      setTanks(
        saved.tanks.map((tank) => ({
          key: tank.id,
          id: tank.id,
          name: tank.name,
          location: tank.location,
          description: tank.description,
          ...fuelCapacityDraftFromLitres(tank.capacityLitres, submittedUnit),
        }))
      );
      Alert.alert(
        'Fuel setup saved',
        'The shared vessel tank setup is up to date. Any new tank needs an explicit opening level before it can be used in inventory activity.',
        [
          { text: 'Done', style: 'cancel' },
          {
            text: 'Review Opening Levels',
            onPress: () => navigation.navigate('FuelOpeningBalances'),
          },
        ]
      );
    } catch (error) {
      if (
        generation !== loadGeneration.current ||
        requestedVesselId.current !== targetVesselId ||
        currentVesselId.current !== targetVesselId
      ) {
        return;
      }
      console.error('Save fuel setup error:', error);
      const message = messageFromError(error);
      const linkedTank = /foreign key|still referenced|violates/i.test(message);
      const staleSetup = /changed since|revision|refresh/i.test(message);
      Alert.alert(
        'Could not save setup',
        staleSetup
          ? 'Another manager changed the fuel setup after you opened it. Refresh before making further changes so their work is not overwritten.'
          : linkedTank
            ? 'A removed tank is already used by a fuel record. Keep that tank and rename it instead.'
            : message,
        staleSetup
          ? [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Refresh Setup', onPress: loadSetup },
            ]
          : [{ text: 'OK' }]
      );
    } finally {
      if (
        generation === loadGeneration.current &&
        requestedVesselId.current === targetVesselId &&
        currentVesselId.current === targetVesselId
      ) {
        setSaving(false);
      }
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
          Join a vessel to view its fuel setup.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Vessel Fuel Setup" />
      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : loadError || loadedVesselId !== vesselId ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={COLORS.warning} />
          <Text style={[styles.errorTitle, { color: themeColors.textPrimary }]}>
            Could not load
          </Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            {loadError ?? 'The current vessel setup has not been verified.'}
          </Text>
          <Button title="Retry" variant="outline" onPress={loadSetup} style={styles.retryButton} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.capacityCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.eyebrow, { color: themeColors.textPrimary }]}>
              Total Fuel Capacity
            </Text>
            <Text style={[styles.capacityValue, { color: themeColors.textPrimary }]}>
              {formatVolume(totalCapacity)}
            </Text>
            <Text style={[styles.alternateValue, { color: themeColors.textSecondary }]}>
              {formatVolume(alternateCapacity)} {unitShortLabel(alternateUnit)}
            </Text>
            <FuelSelectField
              label="Unit of measurement"
              value={unit}
              options={UNIT_OPTIONS}
              onChange={changeUnit}
              disabled={!canEdit}
              title="Fuel volume unit"
            />
          </View>

          <View style={[styles.tankCard, { backgroundColor: themeColors.surface }]}>
            <View style={styles.tankCardHeader}>
              <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Tanks</Text>
              <Text style={[styles.countBadge, { color: themeColors.accent }]}>{tanks.length}</Text>
            </View>
            {tanks.length === 0 ? (
              <View style={styles.noTanks}>
                <Ionicons name="water-outline" size={32} color={themeColors.textSecondary} />
                <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
                  No tanks have been configured yet.
                </Text>
              </View>
            ) : (
              tanks.map((tank, index) => {
                const capacity = parseDecimal(tank.capacity);
                return (
                  <TouchableOpacity
                    key={tank.key}
                    activeOpacity={0.7}
                    onPress={() => setEditor({ ...tank })}
                    style={[
                      styles.tankRow,
                      index > 0 && {
                        borderTopColor: themeColors.border,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={styles.tankCopy}>
                      <Text style={[styles.tankName, { color: themeColors.textPrimary }]}>
                        {tank.name}
                      </Text>
                      {tank.location ? (
                        <Text style={[styles.tankLocation, { color: themeColors.textSecondary }]}>
                          {tank.location}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.tankCapacity, { color: themeColors.textPrimary }]}>
                      {formatVolume(Number.isFinite(capacity) ? capacity : 0)}{' '}
                      {unitShortLabel(unit)}
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {canEdit ? (
            <Button title="＋  Add Tank" variant="outline" onPress={openNewTank} fullWidth />
          ) : null}

          {canEdit ? (
            <Button
              title="Review Opening Levels"
              variant="outline"
              onPress={() => navigation.navigate('FuelOpeningBalances')}
              fullWidth
            />
          ) : null}

          <View style={styles.permissionRow}>
            <Ionicons name="lock-closed" size={17} color={themeColors.textSecondary} />
            <Text style={[styles.permissionText, { color: themeColors.textSecondary }]}>
              Editable by HOD and Captain MOV
            </Text>
          </View>

          {canEdit ? (
            <Button
              title="Save Setup"
              onPress={saveSetup}
              loading={saving}
              disabled={saving}
              fullWidth
              style={styles.saveButton}
            />
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={editor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditor(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditor(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.editorSheet, { backgroundColor: themeColors.surfaceElevated }]}>
              <View style={[styles.modalHandle, { backgroundColor: themeColors.surfaceAlt }]} />
              <Text style={[styles.editorTitle, { color: themeColors.textPrimary }]}>
                {editor?.id ? 'Tank details' : 'Add tank'}
              </Text>
              <Input
                label="Tank name"
                value={editor?.name ?? ''}
                onChangeText={(name) =>
                  setEditor((current) => (current ? { ...current, name } : null))
                }
                placeholder="e.g. Forward Starboard"
                editable={canEdit}
              />
              <Input
                label={`Capacity (${unitShortLabel(unit)})`}
                value={editor?.capacity ?? ''}
                onChangeText={(capacity) =>
                  setEditor((current) =>
                    current ? { ...current, capacity, capacityDirty: true } : null
                  )
                }
                placeholder="e.g. 12000"
                keyboardType="decimal-pad"
                editable={canEdit}
              />
              <Input
                label="Location"
                value={editor?.location ?? ''}
                onChangeText={(location) =>
                  setEditor((current) => (current ? { ...current, location } : null))
                }
                placeholder="e.g. Forward machinery space"
                editable={canEdit}
              />
              <Input
                label="Description"
                value={editor?.description ?? ''}
                onChangeText={(description) =>
                  setEditor((current) => (current ? { ...current, description } : null))
                }
                placeholder="Optional notes about this tank"
                multiline
                editable={canEdit}
              />
              {canEdit ? (
                <View style={styles.editorActions}>
                  {editor && tanks.some((tank) => tank.key === editor.key) ? (
                    <Button
                      title="Remove"
                      variant="danger"
                      onPress={requestDeleteEditor}
                      style={styles.editorAction}
                    />
                  ) : null}
                  <Button title="Done" onPress={saveEditor} style={styles.editorAction} />
                </View>
              ) : (
                <Button title="Close" variant="outline" onPress={() => setEditor(null)} fullWidth />
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  errorTitle: { fontSize: FONTS.xl, fontWeight: '700', marginTop: SPACING.md },
  retryButton: { marginTop: SPACING.md, minWidth: 160 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, gap: SPACING.md },
  capacityCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  eyebrow: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.xs },
  capacityValue: { fontSize: 38, fontWeight: '800', letterSpacing: -0.8 },
  alternateValue: { fontSize: FONTS.base, marginTop: 2, marginBottom: SPACING.md },
  tankCard: { borderRadius: BORDER_RADIUS.lg, overflow: 'hidden' },
  tankCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  sectionTitle: { fontSize: FONTS.xl, fontWeight: '700' },
  countBadge: { fontSize: FONTS.base, fontWeight: '700' },
  tankRow: {
    minHeight: 70,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  tankCopy: { flex: 1 },
  tankName: { fontSize: FONTS.base, fontWeight: '700' },
  tankLocation: { fontSize: FONTS.sm, marginTop: 2 },
  tankCapacity: { fontSize: FONTS.base, fontWeight: '600' },
  noTanks: { alignItems: 'center', gap: SPACING.sm, padding: SPACING.xl },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
  },
  permissionText: { fontSize: FONTS.sm },
  saveButton: { marginTop: SPACING.xl },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  editorSheet: {
    borderTopLeftRadius: BORDER_RADIUS['2xl'],
    borderTopRightRadius: BORDER_RADIUS['2xl'],
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
  },
  modalHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  editorTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.lg },
  editorActions: { flexDirection: 'row', gap: SPACING.sm },
  editorAction: { flex: 1 },
});
