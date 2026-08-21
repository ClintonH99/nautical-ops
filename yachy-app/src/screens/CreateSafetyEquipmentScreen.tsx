/**
 * Create Safety Equipment Screen
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import safetyEquipmentService, { normalizeSafetyItem } from '../services/safetyEquipment';
import type { SafetyEquipmentData, SafetyItem } from '../services/safetyEquipment';
import vesselService from '../services/vessel';
import { Button, LoadingSpinner, PageHeader, ExportButton } from '../components';
import { generateSafetyEquipmentPdf } from '../utils/safetyEquipmentPdf';

const DEFAULT_CATEGORIES = [
  'fireExtinguishers',
  'firstAidKits',
  'medicalBags',
  'fireFightingEquipment',
  'lifeRings',
  'lifeRafts',
  'bilgePumps',
  'fireHoses',
  'emergencyOff',
  'fireAlarmPanel',
  'fireAlarmSwitches',
  'flares',
  'epirbs',
];

const LABELS: Record<string, string> = {
  fireExtinguishers: 'Fire extinguishers',
  firstAidKits: 'First aid kits',
  medicalBags: 'Medical bags',
  fireFightingEquipment: 'Fire fighting equipment',
  lifeRings: 'Life rings',
  lifeRafts: 'Life rafts',
  bilgePumps: 'Bilge pumps',
  fireHoses: 'Fire hoses',
  emergencyOff: 'Emergency OFF switches',
  fireAlarmPanel: 'Fire alarm panel',
  fireAlarmSwitches: 'Fire alarm switches',
  flares: 'Flares',
  epirbs: 'EPIRBs',
};

function getLabel(key: string, customLabels: Record<string, string>): string {
  return LABELS[key] ?? customLabels[key] ?? key;
}

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function emptyItem(): SafetyItem {
  return { location: '', lastChecked: null, lastCheckedNA: false, expiryDate: null, expiryDateNA: false };
}

type ActiveDateField = { key: string; index: number; field: 'lastChecked' | 'expiryDate' } | null;

export const CreateSafetyEquipmentScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const isMOV = user?.role === 'CAPTAIN_MOV';
  const canManage = isHOD || isMOV;
  const equipmentId = route.params?.equipmentId as string | undefined;
  const isEdit = !!equipmentId;
  const [loading, setLoading] = useState(isEdit);
  const [vesselName, setVesselName] = useState('');
  const [title, setTitle] = useState('');
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => [...DEFAULT_CATEGORIES]);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const [data, setData] = useState<Record<string, SafetyItem[]>>(
    Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c, [emptyItem()]]))
  );
  const [activeDateField, setActiveDateField] = useState<ActiveDateField>(null);

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Safety Equipment' : 'Create Safety Equipment' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!vesselId) return;
    vesselService.getVessel(vesselId).then((vessel) => {
      if (vessel?.name) setVesselName(vessel.name);
    });
  }, [vesselId]);

  useEffect(() => {
    if (!equipmentId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const item = await safetyEquipmentService.getById(equipmentId);
        if (item) {
          setTitle(item.title ?? '');
          const raw = item.data || {};
          const labels = (raw.customLabels as Record<string, string>) || {};
          setCustomLabels(labels);
          const allKeys = new Set(DEFAULT_CATEGORIES);
          Object.keys(raw).forEach((k) => {
            if (k !== 'vesselName' && k !== 'customLabels' && k.startsWith('custom_')) {
              allKeys.add(k);
            }
          });
          const order = [...DEFAULT_CATEGORIES.filter((k) => allKeys.has(k))];
          const customKeys = Object.keys(raw).filter(
            (k) => k.startsWith('custom_') && !DEFAULT_CATEGORIES.includes(k)
          );
          order.push(...customKeys);
          setCategoryOrder(order.length ? order : [...DEFAULT_CATEGORIES]);
          const next: Record<string, SafetyItem[]> = {};
          order.forEach((k) => {
            const rawArr = (raw[k] as (string | SafetyItem)[] | undefined) ?? [];
            const normalized = rawArr.map(normalizeSafetyItem).filter((it) => it.location);
            next[k] = normalized.length ? normalized : [emptyItem()];
          });
          setData(next);
        }
      } catch (e) {
        console.error('Load safety equipment error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [equipmentId]);

  const setLoc = (key: string, i: number, v: string) => {
    const arr = [...(data[key] || [emptyItem()])];
    arr[i] = { ...arr[i], location: v };
    setData({ ...data, [key]: arr });
  };

  const setDateField = (key: string, i: number, field: 'lastChecked' | 'expiryDate', value: string) => {
    const arr = [...(data[key] || [emptyItem()])];
    const naField = field === 'lastChecked' ? 'lastCheckedNA' : 'expiryDateNA';
    arr[i] = { ...arr[i], [field]: value, [naField]: false };
    setData({ ...data, [key]: arr });
  };

  const toggleNA = (key: string, i: number, field: 'lastChecked' | 'expiryDate') => {
    const arr = [...(data[key] || [emptyItem()])];
    const naField = field === 'lastChecked' ? 'lastCheckedNA' : 'expiryDateNA';
    const nowNA = !arr[i][naField];
    arr[i] = { ...arr[i], [naField]: nowNA, [field]: nowNA ? null : arr[i][field] };
    setData({ ...data, [key]: arr });
  };

  const addLoc = (key: string) => setData({ ...data, [key]: [...(data[key] || []), emptyItem()] });
  const remLoc = (key: string, i: number) => {
    const arr = (data[key] || []).filter((_, idx) => idx !== i);
    setData({ ...data, [key]: arr.length ? arr : [emptyItem()] });
  };

  const addEquipmentType = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const existingLabels = Object.values(LABELS).filter(Boolean);
    const existingCustom = Object.values(customLabels);
    const allLabels = [...existingLabels, ...existingCustom];
    if (allLabels.some((l) => l.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Duplicate', 'This equipment type already exists.');
      return;
    }
    const key = `custom_${Date.now()}`;
    setCustomLabels({ ...customLabels, [key]: name });
    setCategoryOrder([...categoryOrder, key]);
    setData({ ...data, [key]: [emptyItem()] });
    setNewCategoryName('');
  };

  const removeCategory = (key: string) => {
    const label = getLabel(key, customLabels);
    Alert.alert('Remove category', `Remove "${label}"? Locations will be lost.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const nextOrder = categoryOrder.filter((k) => k !== key);
          if (nextOrder.length === 0) {
            setCategoryOrder([...DEFAULT_CATEGORIES]);
            setData(Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c, [emptyItem()]])));
          } else {
            setCategoryOrder(nextOrder);
            const { [key]: _, ...rest } = data;
            setData(rest);
          }
          if (key.startsWith('custom_')) {
            const { [key]: __, ...rest } = customLabels;
            setCustomLabels(rest);
          }
        },
      },
    ]);
  };

  const build = (): SafetyEquipmentData => {
    const out: SafetyEquipmentData = { vesselName };
    if (Object.keys(customLabels).length) {
      out.customLabels = customLabels;
    }
    categoryOrder.forEach((k) => {
      const arr = (data[k] || []).filter((it) => it.location.trim());
      if (arr.length) (out as any)[k] = arr;
    });
    return out;
  };

  const onExport = async () => {
    await generateSafetyEquipmentPdf(
      build(),
      title || vesselName || 'Safety Equipment',
      (title || 'Safety').replace(/[^a-z0-9]/gi, '_') + '.pdf'
    );
  };

  const onPublish = async () => {
    if (!vesselId || !canManage) return;
    try {
      const payload = build();
      const planTitle = title || vesselName || 'Safety Equipment';
      if (isEdit && equipmentId) {
        await safetyEquipmentService.update(equipmentId, planTitle, payload);
      } else {
        await safetyEquipmentService.create(vesselId, planTitle, payload, user?.id);
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', 'Could not publish');
    }
  };

  const openDatePicker = (key: string, index: number, field: 'lastChecked' | 'expiryDate') => {
    setActiveDateField({ key, index, field });
  };

  const activeItem = activeDateField ? data[activeDateField.key]?.[activeDateField.index] : null;
  const activeValue = activeDateField && activeItem ? activeItem[activeDateField.field] : null;

  if (!vesselId)
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel.</Text>
      </View>
    );
  if (!canManage)
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Only HODs and Captain have access. Crew can export to PDF.
        </Text>
      </View>
    );
  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title="Create Safety Equipment"
        actions={<ExportButton active={false} onPress={onExport} />}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[
            styles.label,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Plan title
        </Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="Safety Equipment Locations"
          placeholderTextColor={COLORS.textTertiary}
        />
        <View style={[styles.addSection, { borderColor: themeColors.surfaceAlt }]}>
          <Text
            style={[
              styles.addSectionLabel,
              { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
            ]}
          >
            Add equipment type
          </Text>
          <View style={styles.addSectionRow}>
            <TextInput
              style={[
                styles.input,
                styles.flex,
                { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
              ]}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="e.g. Safety harnesses"
              placeholderTextColor={COLORS.textTertiary}
              onSubmitEditing={addEquipmentType}
            />
            <Button
              title="Add"
              onPress={addEquipmentType}
              variant="outline"
              style={styles.addBtn}
            />
          </View>
        </View>
        {categoryOrder.map((key) => (
          <View key={key} style={styles.cat}>
            <View style={styles.catHeader}>
              <Text style={[styles.catLabel, { color: themeColors.textPrimary }]}>
                {getLabel(key, customLabels)}
              </Text>
              <TouchableOpacity
                onPress={() => removeCategory(key)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
            {(data[key] || [emptyItem()]).map((item, i) => (
              <View
                key={i}
                style={[
                  styles.itemCard,
                  { backgroundColor: themeColors.surface, borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border },
                ]}
              >
                <View style={styles.row}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.flex,
                      { backgroundColor: themeColors.background, color: themeColors.textPrimary },
                    ]}
                    value={item.location}
                    onChangeText={(v) => setLoc(key, i, v)}
                    placeholder="Location"
                    placeholderTextColor={COLORS.textTertiary}
                  />
                  <TouchableOpacity onPress={() => remLoc(key, i)}>
                    <Text style={styles.rm}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.dateRow}>
                  <View style={styles.dateCol}>
                    <Text style={[styles.dateLabel, { color: themeColors.textSecondary }]}>Last checked</Text>
                    <TouchableOpacity
                      disabled={item.lastCheckedNA}
                      onPress={() => openDatePicker(key, i, 'lastChecked')}
                      style={[
                        styles.dateChip,
                        {
                          backgroundColor: item.lastCheckedNA ? themeColors.background : themeColors.background,
                          borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dateChipText,
                          {
                            color: item.lastCheckedNA || !item.lastChecked ? themeColors.textSecondary : themeColors.textPrimary,
                            fontStyle: item.lastCheckedNA ? 'italic' : 'normal',
                          },
                        ]}
                      >
                        {item.lastCheckedNA ? 'N/A' : item.lastChecked || 'Not set'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.naRow}
                      onPress={() => toggleNA(key, i, 'lastChecked')}
                    >
                      <Ionicons
                        name={item.lastCheckedNA ? 'checkbox' : 'square-outline'}
                        size={15}
                        color={item.lastCheckedNA ? COLORS.primary : themeColors.textSecondary}
                      />
                      <Text style={[styles.naLabel, { color: themeColors.textSecondary }]}>Mark N/A</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.dateCol}>
                    <Text style={[styles.dateLabel, { color: themeColors.textSecondary }]}>Expiry / replace by</Text>
                    <TouchableOpacity
                      disabled={item.expiryDateNA}
                      onPress={() => openDatePicker(key, i, 'expiryDate')}
                      style={[
                        styles.dateChip,
                        {
                          backgroundColor: themeColors.background,
                          borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dateChipText,
                          {
                            color: item.expiryDateNA || !item.expiryDate ? themeColors.textSecondary : themeColors.textPrimary,
                            fontStyle: item.expiryDateNA ? 'italic' : 'normal',
                          },
                        ]}
                      >
                        {item.expiryDateNA ? 'N/A' : item.expiryDate || 'Not set'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.naRow}
                      onPress={() => toggleNA(key, i, 'expiryDate')}
                    >
                      <Ionicons
                        name={item.expiryDateNA ? 'checkbox' : 'square-outline'}
                        size={15}
                        color={item.expiryDateNA ? COLORS.primary : themeColors.textSecondary}
                      />
                      <Text style={[styles.naLabel, { color: themeColors.textSecondary }]}>Mark N/A</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
            <TouchableOpacity onPress={() => addLoc(key)}>
              <Text style={styles.add}>+ Add location</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save' : 'Publish'}
            onPress={onPublish}
            variant="primary"
            fullWidth
            style={styles.btn}
          />
        </View>
      </ScrollView>

      {activeDateField && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setActiveDateField(null)}>
            <View
              style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
              onStartShouldSetResponder={() => true}
            >
              <Calendar
                current={activeValue || toYYYYMMDD(new Date())}
                markedDates={
                  activeValue
                    ? { [activeValue]: { selected: true, selectedColor: COLORS.primary } }
                    : {}
                }
                onDayPress={({ dateString }: { dateString: string }) => {
                  if (activeDateField) {
                    setDateField(activeDateField.key, activeDateField.index, activeDateField.field, dateString);
                  }
                  setActiveDateField(null);
                }}
                theme={{
                  backgroundColor: themeColors.surface,
                  calendarBackground: themeColors.surface,
                  textSectionTitleColor: themeColors.isDark ? COLORS.white : COLORS.black,
                  selectedDayBackgroundColor: COLORS.primary,
                  selectedDayTextColor: COLORS.white,
                  todayTextColor: COLORS.primary,
                  dayTextColor: themeColors.isDark ? COLORS.white : COLORS.black,
                  arrowColor: themeColors.textPrimary,
                  monthTextColor: themeColors.textPrimary,
                }}
              />
              <Button title="Close" onPress={() => setActiveDateField(null)} variant="outline" fullWidth />
            </View>
          </Pressable>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding + 120 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: 4, marginTop: SPACING.md },
  addSection: {
    marginTop: SPACING.xl,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addSectionLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.sm },
  addSectionRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  addBtn: { minWidth: 70 },
  cat: { marginTop: SPACING.lg },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  catLabel: { fontSize: FONTS.base, fontWeight: '600', flex: 1 },
  input: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemCard: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  flex: { flex: 1 },
  rm: { color: COLORS.primary },
  dateRow: { flexDirection: 'row', gap: SPACING.md },
  dateCol: { flex: 1 },
  dateLabel: { fontSize: FONTS.xs, marginBottom: 4 },
  dateChip: { borderWidth: 1, borderRadius: BORDER_RADIUS.sm, padding: SPACING.sm, marginBottom: 6 },
  dateChipText: { fontSize: FONTS.sm },
  naRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  naLabel: { fontSize: FONTS.xs },
  add: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600', marginBottom: SPACING.sm },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    width: '100%',
    gap: SPACING.md,
  },
});
