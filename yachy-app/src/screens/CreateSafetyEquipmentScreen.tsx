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
import safetyEquipmentService from '../services/safetyEquipment';
import vesselService from '../services/vessel';
import { Button, LoadingSpinner } from '../components';
import { generateSafetyEquipmentPdf } from '../utils/safetyEquipmentPdf';
import type { SafetyEquipmentData } from '../services/safetyEquipment';

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
  const [data, setData] = useState<Record<string, string[]>>(
    Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c, ['']]))
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
          const next: Record<string, string[]> = {};
          order.forEach((k) => {
            const arr = (raw[k] as string[] | undefined)?.filter(Boolean);
            next[k] = arr?.length ? arr : [''];
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
    const arr = [...(data[key] || [''])];
    arr[i] = v;
    setData({ ...data, [key]: arr });
  };
  const addLoc = (key: string) => setData({ ...data, [key]: [...(data[key] || []), ''] });
  const remLoc = (key: string, i: number) => {
    const arr = (data[key] || []).filter((_, idx) => idx !== i);
    setData({ ...data, [key]: arr.length ? arr : [''] });
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
    setData({ ...data, [key]: [''] });
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
            setData(Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c, ['']])));
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
      const arr = (data[k] || []).filter(Boolean);
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
          Only HOD or MOV can create or edit safety equipment. Crew can export to PDF.
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
            {(data[key] || ['']).map((loc, i) => (
              <View key={i} style={styles.row}>
                <TextInput
                  style={[
                    styles.input,
                    styles.flex,
                    { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
                  ]}
                  value={loc}
                  onChangeText={(v) => setLoc(key, i, v)}
                  placeholder="Location"
                  placeholderTextColor={COLORS.textTertiary}
                />
                <TouchableOpacity onPress={() => remLoc(key, i)}>
                  <Text style={styles.rm}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={() => addLoc(key)}>
              <Text style={styles.add}>+ Add location</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.actions}>
          <Button
            title="Export to PDF"
            onPress={onExport}
            variant="outline"
            fullWidth
            style={styles.btn}
          />
          <Button
            title={isEdit ? 'Save' : 'Publish'}
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
  input: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  flex: { flex: 1 },
  rm: { color: COLORS.primary },
  add: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600', marginBottom: SPACING.sm },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
