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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import safetyEquipmentService, {
  getSafetyEquipmentCategoryOrder,
  normalizeSafetyItem,
} from '../services/safetyEquipment';
import type { SafetyEquipmentData, SafetyItem } from '../services/safetyEquipment';
import vesselService from '../services/vessel';
import { Button, DateOnlyPicker, LoadingSpinner, PageHeader, ExportButton } from '../components';
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

function emptyItem(): SafetyItem {
  return {
    location: '',
    lastChecked: null,
    lastCheckedNA: false,
    expiryDate: null,
    expiryDateNA: false,
  };
}

export const CreateSafetyEquipmentScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const isMOV = user?.role === 'CAPTAIN_MOV';
  const canManage = isHOD || isMOV;
  const equipmentId = route.params?.equipmentId as string | undefined;
  const isEdit = !!equipmentId;
  const [loading, setLoading] = useState(true);
  const [vesselName, setVesselName] = useState('');
  const [title, setTitle] = useState('');
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => [...DEFAULT_CATEGORIES]);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const [data, setData] = useState<Record<string, SafetyItem[]>>(
    Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c, [emptyItem()]]))
  );

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
    if (!vesselId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        if (!equipmentId) {
          const existingPlans = await safetyEquipmentService.getByVessel(vesselId);
          if (!cancelled && existingPlans.length > 0) {
            setCategoryOrder([]);
            setData({});
          }
          return;
        }

        const item = await safetyEquipmentService.getById(equipmentId);
        if (item && !cancelled) {
          setTitle(item.title ?? '');
          const raw = item.data || {};
          const labels = (raw.customLabels as Record<string, string>) || {};
          setCustomLabels(labels);
          const order = getSafetyEquipmentCategoryOrder(raw, DEFAULT_CATEGORIES);
          setCategoryOrder(order);
          const next: Record<string, SafetyItem[]> = {};
          order.forEach((key) => {
            const rawItems = (raw[key] as (string | SafetyItem)[] | undefined) ?? [];
            const normalized = rawItems
              .map(normalizeSafetyItem)
              .filter((safetyItem) => safetyItem.location);
            next[key] = normalized.length ? normalized : [emptyItem()];
          });
          setData(next);
        }
      } catch (e) {
        console.error('Load safety equipment error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [equipmentId, vesselId]);

  const setLoc = (key: string, i: number, v: string) => {
    const arr = [...(data[key] || [emptyItem()])];
    arr[i] = { ...arr[i], location: v };
    setData({ ...data, [key]: arr });
  };

  const setDateField = (
    key: string,
    i: number,
    field: 'lastChecked' | 'expiryDate',
    value: string
  ) => {
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
    setCustomLabels((previous) => ({ ...previous, [key]: name }));
    setCategoryOrder((previous) => [key, ...previous]);
    setData((previous) => ({ ...previous, [key]: [emptyItem()] }));
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
          setCategoryOrder(nextOrder);
          const { [key]: _, ...rest } = data;
          setData(rest);
          if (key.startsWith('custom_')) {
            const { [key]: __, ...rest } = customLabels;
            setCustomLabels(rest);
          }
        },
      },
    ]);
  };

  const build = (): SafetyEquipmentData => {
    const out: SafetyEquipmentData = { vesselName, categoryOrder: [...categoryOrder] };
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
      <PageHeader
        title={isEdit ? 'Edit Safety Equipment' : 'Create Safety Equipment'}
        actions={<ExportButton active={false} onPress={onExport} />}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Plan title</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: themeColors.control,
              color: themeColors.textPrimary,
              borderColor: themeColors.border,
            },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="Safety Equipment Locations"
          placeholderTextColor={themeColors.textSecondary}
        />
        <View
          style={[
            styles.addSection,
            {
              backgroundColor: themeColors.accentSoft,
              borderColor: themeColors.borderStrong,
            },
          ]}
        >
          <Text style={[styles.addSectionLabel, { color: themeColors.textPrimary }]}>
            Add Equipment Type
          </Text>
          <View style={styles.addSectionRow}>
            <TextInput
              style={[
                styles.input,
                styles.flex,
                {
                  backgroundColor: themeColors.control,
                  color: themeColors.textPrimary,
                  borderColor: themeColors.border,
                },
              ]}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="e.g. Safety harnesses"
              placeholderTextColor={themeColors.textSecondary}
              onSubmitEditing={addEquipmentType}
            />
            <Button
              title="Add Equipment Type"
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
                style={styles.categoryDeleteButton}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${getLabel(key, customLabels)}`}
              >
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                <Text style={styles.categoryDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
            {(data[key] || [emptyItem()]).map((item, i) => (
              <View
                key={i}
                style={[
                  styles.itemCard,
                  {
                    backgroundColor: themeColors.surfaceElevated,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <View style={styles.row}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.flex,
                      {
                        backgroundColor: themeColors.control,
                        color: themeColors.textPrimary,
                        borderColor: themeColors.border,
                      },
                    ]}
                    value={item.location}
                    onChangeText={(v) => setLoc(key, i, v)}
                    placeholder="Location"
                    placeholderTextColor={themeColors.textSecondary}
                  />
                  <TouchableOpacity onPress={() => remLoc(key, i)}>
                    <Text style={[styles.rm, { color: COLORS.danger }]}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.dateRow}>
                  <View style={styles.dateCol}>
                    <DateOnlyPicker
                      label="Last checked"
                      value={item.lastChecked}
                      onChange={(value) => setDateField(key, i, 'lastChecked', value)}
                      title="Select last checked date"
                      placeholder={item.lastCheckedNA ? 'N/A' : 'Select date'}
                      disabled={item.lastCheckedNA}
                    />
                    <TouchableOpacity
                      style={styles.naRow}
                      onPress={() => toggleNA(key, i, 'lastChecked')}
                    >
                      <Ionicons
                        name={item.lastCheckedNA ? 'checkbox' : 'square-outline'}
                        size={15}
                        color={item.lastCheckedNA ? themeColors.accent : themeColors.textSecondary}
                      />
                      <Text style={[styles.naLabel, { color: themeColors.textSecondary }]}>
                        Mark N/A
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.dateCol}>
                    <DateOnlyPicker
                      label="Expiry / replace by"
                      value={item.expiryDate}
                      onChange={(value) => setDateField(key, i, 'expiryDate', value)}
                      title="Select expiry date"
                      placeholder={item.expiryDateNA ? 'N/A' : 'Select date'}
                      disabled={item.expiryDateNA}
                    />
                    <TouchableOpacity
                      style={styles.naRow}
                      onPress={() => toggleNA(key, i, 'expiryDate')}
                    >
                      <Ionicons
                        name={item.expiryDateNA ? 'checkbox' : 'square-outline'}
                        size={15}
                        color={item.expiryDateNA ? themeColors.accent : themeColors.textSecondary}
                      />
                      <Text style={[styles.naLabel, { color: themeColors.textSecondary }]}>
                        Mark N/A
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
            <TouchableOpacity onPress={() => addLoc(key)}>
              <Text style={[styles.add, { color: themeColors.accent }]}>+ Add Location</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Publish Safety Equipment'}
            onPress={onPublish}
            variant="primary"
            fullWidth
            style={styles.btn}
          />
        </View>
      </ScrollView>
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
  categoryDeleteButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
  },
  categoryDeleteText: {
    color: COLORS.danger,
    fontSize: FONTS.xs,
    fontWeight: '600',
  },
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
  rm: {},
  dateRow: { flexDirection: 'row', gap: SPACING.md },
  dateCol: { flex: 1 },
  naRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  naLabel: { fontSize: FONTS.xs },
  add: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
