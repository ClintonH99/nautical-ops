import React, { useEffect, useMemo, useState } from 'react';
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
import {
  Button,
  DateOnlyPicker,
  Input,
  LabeledDropdown,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import seaMilesService, { SeaMileEntryFields } from '../services/seaMiles';
import { useAuthStore } from '../store';
import type { SeaMileEntry } from '../types';
import { toYYYYMMDD } from '../utils';
import { isMasterOfVessel } from '../utils/access';

type VesselLengthUnit = 'ft' | 'm';

const VESSEL_LENGTH_UNITS: Array<{ label: string; value: VesselLengthUnit }> = [
  { label: 'Meters', value: 'm' },
  { label: 'ft', value: 'ft' },
];

function vesselLengthUnitLabel(unit: VesselLengthUnit | null): string {
  if (unit === 'm') return 'Meters';
  if (unit === 'ft') return 'ft';
  return 'Meters / ft';
}

function numberValue(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseVesselLength(value: string): { amount: string; unit: VesselLengthUnit } {
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?$/i);
  if (!match) {
    return { amount: value.replace(/[^\d.,]/g, ''), unit: 'ft' };
  }

  const savedUnit = match[2]?.toLowerCase();
  return {
    amount: match[1].replace(',', '.'),
    unit: savedUnit?.startsWith('m') ? 'm' : 'ft',
  };
}

export const AddEditSeaMileScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const entryId = route.params?.entryId as string | undefined;
  const reviewMode = route.params?.reviewMode === true;

  const [entry, setEntry] = useState<SeaMileEntry | null>(null);
  const [loading, setLoading] = useState(!!entryId);
  const [saving, setSaving] = useState(false);
  const [lengthUnitPickerOpen, setLengthUnitPickerOpen] = useState(false);
  const [tidalPickerOpen, setTidalPickerOpen] = useState(false);
  const [voyageDate, setVoyageDate] = useState(toYYYYMMDD(new Date()));
  const [vesselName, setVesselName] = useState('');
  const [vesselLength, setVesselLength] = useState('');
  const [vesselLengthUnit, setVesselLengthUnit] = useState<VesselLengthUnit | null>(null);
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [capacityRole, setCapacityRole] = useState(user?.position ?? '');
  const [milesLogged, setMilesLogged] = useState('');
  const [dayHours, setDayHours] = useState('');
  const [nightHours, setNightHours] = useState('');
  const [tidal, setTidal] = useState(false);

  useEffect(() => {
    let active = true;
    if (!entryId) return undefined;

    const load = async () => {
      try {
        const existing = await seaMilesService.getById(entryId);
        if (!active) return;
        if (!existing) {
          Alert.alert('Not found', 'This sea-mile entry is no longer available.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
          return;
        }
        const canEdit = reviewMode
          ? isMasterOfVessel(user) && existing.status === 'PENDING'
          : existing.userId === user?.id && ['DRAFT', 'DECLINED'].includes(existing.status);
        if (!canEdit) {
          Alert.alert('Entry locked', 'This sea-mile entry cannot be edited.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
          return;
        }

        setEntry(existing);
        setVoyageDate(existing.voyageDate);
        setVesselName(existing.vesselName);
        const savedLength = parseVesselLength(existing.vesselLength);
        setVesselLength(savedLength.amount);
        setVesselLengthUnit(savedLength.unit);
        setFromLocation(existing.fromLocation);
        setToLocation(existing.toLocation);
        setCapacityRole(existing.capacityRole);
        setMilesLogged(String(existing.milesLogged));
        setDayHours(String(existing.dayHours));
        setNightHours(String(existing.nightHours));
        setTidal(existing.tidal);
      } catch (error) {
        console.error('Load sea-mile entry error:', error);
        Alert.alert('Error', 'The sea-mile entry could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [entryId, navigation, reviewMode, user]);

  const fields = useMemo<SeaMileEntryFields | null>(() => {
    const miles = numberValue(milesLogged);
    const day = numberValue(dayHours);
    const night = numberValue(nightHours);
    const length = numberValue(vesselLength);
    if (
      !voyageDate ||
      !vesselName.trim() ||
      length === null ||
      length <= 0 ||
      !fromLocation.trim() ||
      !toLocation.trim() ||
      !capacityRole.trim() ||
      miles === null ||
      day === null ||
      night === null
    ) {
      return null;
    }
    return {
      voyageDate,
      vesselName,
      vesselLength: `${length} ${vesselLengthUnit ?? 'ft'}`,
      fromLocation,
      toLocation,
      capacityRole,
      milesLogged: miles,
      dayHours: day,
      nightHours: night,
      tidal,
    };
  }, [
    voyageDate,
    vesselName,
    vesselLength,
    vesselLengthUnit,
    fromLocation,
    toLocation,
    capacityRole,
    milesLogged,
    dayHours,
    nightHours,
    tidal,
  ]);

  const requireFields = (): SeaMileEntryFields | null => {
    if (!fields) {
      Alert.alert(
        'Missing information',
        'Complete every field and enter valid numbers for vessel length, miles, and hours.'
      );
      return null;
    }
    return fields;
  };

  const saveDraftOrChanges = async () => {
    const validFields = requireFields();
    if (!validFields || !user?.id) return;
    setSaving(true);
    try {
      if (reviewMode && entryId) {
        await seaMilesService.updatePendingAsCaptain(entryId, validFields);
      } else if (entryId) {
        await seaMilesService.updateEditable(entryId, validFields);
      } else {
        await seaMilesService.createDraft(user.id, validFields);
      }
      navigation.goBack();
    } catch (error: any) {
      console.error('Save sea-mile entry error:', error);
      Alert.alert('Could not save', error?.message || 'Please check the entry and try again.');
    } finally {
      setSaving(false);
    }
  };

  const submitForReview = async () => {
    const validFields = requireFields();
    if (!validFields || !user?.id) return;
    if (!user.vesselId) {
      Alert.alert(
        'Join a vessel first',
        'You can save this entry as a draft, but you need to be onboard a vessel before submitting it to a Captain/MOV.'
      );
      return;
    }

    setSaving(true);
    try {
      let id = entryId;
      if (!id) {
        id = (await seaMilesService.createDraft(user.id, validFields)).id;
      }
      await seaMilesService.submit(id, validFields);
      Alert.alert('Submitted', 'Your sea-mile entry was sent to the Captain/MOV for review.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      console.error('Submit sea-mile entry error:', error);
      Alert.alert('Could not submit', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  const title = entryId || reviewMode ? 'Edit Sea Miles Entry' : 'Create Sea Miles Entry';
  const sectionTitleColor = themeColors.isDark ? COLORS.white : COLORS.primary;

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={title} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {entry?.status === 'DECLINED' && entry.declineComment ? (
          <View style={[styles.declineCard, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.declineTitle}>Captain’s comment</Text>
            <Text style={[styles.declineText, { color: themeColors.textPrimary }]}>
              {entry.declineComment}
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Voyage details</Text>
          <DateOnlyPicker
            label="Date"
            value={voyageDate}
            onChange={setVoyageDate}
            title="Select voyage date"
            maximumDate={toYYYYMMDD(new Date())}
          />

          <Input
            label="Vessel Name"
            value={vesselName}
            onChangeText={setVesselName}
            placeholder="e.g. M/Y Aurora"
            maxLength={160}
          />
          <View style={styles.lengthRow}>
            <Input
              containerStyle={styles.lengthInput}
              label="Vessel Length"
              value={vesselLength}
              onChangeText={setVesselLength}
              placeholder="e.g. 138"
              keyboardType="decimal-pad"
              maxLength={12}
            />
            <View style={styles.lengthUnit}>
              <Text style={[styles.unitLabel, { color: themeColors.textPrimary }]}>Unit</Text>
              <TouchableOpacity
                style={[
                  styles.unitDropdown,
                  { backgroundColor: themeColors.control, borderColor: themeColors.border },
                ]}
                onPress={() => setLengthUnitPickerOpen(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Unit: ${vesselLengthUnitLabel(vesselLengthUnit)}`}
              >
                <Text
                  style={[
                    styles.unitValue,
                    {
                      color: vesselLengthUnit ? themeColors.textPrimary : themeColors.textSecondary,
                    },
                  ]}
                >
                  {vesselLengthUnitLabel(vesselLengthUnit)}
                </Text>
                <Text style={[styles.unitChevron, { color: sectionTitleColor }]}>
                  {lengthUnitPickerOpen ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.twoColumns}>
            <Input
              containerStyle={styles.half}
              label="From"
              value={fromLocation}
              onChangeText={setFromLocation}
              placeholder="Departure location"
              maxLength={160}
            />
            <Input
              containerStyle={styles.half}
              label="To"
              value={toLocation}
              onChangeText={setToLocation}
              placeholder="Destination"
              maxLength={160}
            />
          </View>
          <Input
            label="Capacity / Role"
            value={capacityRole}
            onChangeText={setCapacityRole}
            placeholder="e.g. Deckhand"
            maxLength={120}
          />
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Sea service</Text>
          <Input
            label="Miles Logged"
            value={milesLogged}
            onChangeText={setMilesLogged}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <Text style={[styles.fieldHint, { color: themeColors.textSecondary }]}>
            Nautical miles
          </Text>
          <View style={styles.twoColumns}>
            <Input
              containerStyle={styles.half}
              label="Day Hours"
              value={dayHours}
              onChangeText={setDayHours}
              placeholder="0"
              keyboardType="decimal-pad"
            />
            <Input
              containerStyle={styles.half}
              label="Night Hours"
              value={nightHours}
              onChangeText={setNightHours}
              placeholder="0"
              keyboardType="decimal-pad"
            />
          </View>
          <LabeledDropdown
            label="Tidal"
            value={tidal ? 'Yes' : 'No'}
            open={tidalPickerOpen}
            onPress={() => setTidalPickerOpen(true)}
            tightTop
          />
        </View>

        {reviewMode ? (
          <Button title="Save Changes" onPress={saveDraftOrChanges} loading={saving} fullWidth />
        ) : (
          <View style={styles.actionRow}>
            <Button
              title="Save Draft"
              variant="outline"
              onPress={saveDraftOrChanges}
              disabled={saving}
              style={styles.actionButton}
            />
            <Button
              title="Submit for Review"
              onPress={submitForReview}
              loading={saving}
              style={styles.actionButton}
            />
          </View>
        )}
      </ScrollView>

      <Modal visible={lengthUnitPickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setLengthUnitPickerOpen(false)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              Vessel length unit
            </Text>
            {VESSEL_LENGTH_UNITS.map((unit) => (
              <TouchableOpacity
                key={unit.value}
                style={[
                  styles.modalItem,
                  vesselLengthUnit === unit.value && styles.modalItemSelected,
                ]}
                onPress={() => {
                  setVesselLengthUnit(unit.value);
                  setLengthUnitPickerOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                  {unit.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={tidalPickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setTidalPickerOpen(false)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              Tidal passage?
            </Text>
            {[
              { label: 'Yes', value: true },
              { label: 'No', value: false },
            ].map((option) => (
              <TouchableOpacity
                key={option.label}
                style={[styles.modalItem, tidal === option.value && styles.modalItemSelected]}
                onPress={() => {
                  setTidal(option.value);
                  setTidalPickerOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  fieldHint: {
    fontSize: FONTS.xs,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.md,
  },
  lengthRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md },
  lengthInput: { flex: 1.8 },
  lengthUnit: { flex: 1, marginBottom: SPACING.md },
  unitLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  unitDropdown: {
    minHeight: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  unitValue: { fontSize: FONTS.base, flexShrink: 1 },
  unitChevron: { fontSize: 10 },
  twoColumns: { flexDirection: 'row', gap: SPACING.md },
  half: { flex: 1 },
  actionRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  actionButton: { flex: 1, paddingHorizontal: SPACING.sm },
  declineCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  declineTitle: {
    color: COLORS.danger,
    fontSize: FONTS.sm,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  declineText: { fontSize: FONTS.sm, lineHeight: 20 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalBox: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.md },
  modalItem: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md },
  modalItemSelected: { borderWidth: 2, borderColor: COLORS.primary },
  modalItemText: { fontSize: FONTS.base },
});
