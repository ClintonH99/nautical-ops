/**
 * Create Safety Equipment Screen
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import safetyEquipmentService from '../services/safetyEquipment';
import vesselService from '../services/vessel';
import { Button } from '../components';
import { generateSafetyEquipmentPdf } from '../utils/safetyEquipmentPdf';
import type { SafetyEquipmentData } from '../services/safetyEquipment';

const CATEGORIES = [
  'fireExtinguishers', 'firstAidKits', 'medicalBags', 'fireFightingEquipment', 'lifeRings', 'lifeRafts',
  'bilgePumps', 'fireHoses', 'emergencyOff', 'fireAlarmPanel', 'fireAlarmSwitches', 'flares', 'epirbs',
];

const LABELS: Record<string, string> = {
  fireExtinguishers: 'Fire extinguishers', firstAidKits: 'First aid kits', medicalBags: 'Medical bags',
  fireFightingEquipment: 'Fire fighting equipment', lifeRings: 'Life rings', lifeRafts: 'Life rafts',
  bilgePumps: 'Bilge pumps', fireHoses: 'Fire hoses', emergencyOff: 'Emergency OFF switches',
  fireAlarmPanel: 'Fire alarm panel', fireAlarmSwitches: 'Fire alarm switches', flares: 'Flares', epirbs: 'EPIRBs',
};

export const CreateSafetyEquipmentScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const equipmentId = route.params?.equipmentId as string | undefined;
  const isEdit = !!equipmentId;
  const [loading, setLoading] = useState(isEdit);
  const [vesselName, setVesselName] = useState('');
  const [title, setTitle] = useState('');
  const [data, setData] = useState<Record<string, string[]>>(Object.fromEntries(CATEGORIES.map((c) => [c, ['']])));

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
          const next: Record<string, string[]> = { ...Object.fromEntries(CATEGORIES.map((c) => [c, ['']])) };
          CATEGORIES.forEach((k) => {
            const arr = (item.data?.[k] as string[] | undefined)?.filter(Boolean);
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

  const build = (): SafetyEquipmentData => {
    const out: SafetyEquipmentData = { vesselName };
    CATEGORIES.forEach((k) => {
      const arr = (data[k] || []).filter(Boolean);
      if (arr.length) (out as any)[k] = arr;
    });
    return out;
  };

  const onExport = async () => {
    await generateSafetyEquipmentPdf(build(), title || vesselName || 'Safety Equipment', (title || 'Safety').replace(/[^a-z0-9]/gi, '_') + '.pdf');
  };

  const onPublish = async () => {
    if (!vesselId) return;
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

  if (!vesselId) return <View style={[styles.center, { backgroundColor: themeColors.background }]}><Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel.</Text></View>;
  if (loading) return <View style={[styles.center, { backgroundColor: themeColors.background }]}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: themeColors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Plan title</Text>
        <TextInput style={[styles.input, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]} value={title} onChangeText={setTitle} placeholder="Safety Equipment Locations" placeholderTextColor={COLORS.textTertiary} />
        {CATEGORIES.map((key) => (
          <View key={key} style={styles.cat}>
            <Text style={[styles.catLabel, { color: themeColors.textPrimary }]}>{LABELS[key]}</Text>
            {(data[key] || ['']).map((loc, i) => (
              <View key={i} style={styles.row}>
                <TextInput style={[styles.input, styles.flex, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]} value={loc} onChangeText={(v) => setLoc(key, i, v)} placeholder="Location" placeholderTextColor={COLORS.textTertiary} />
                <TouchableOpacity onPress={() => remLoc(key, i)}><Text style={styles.rm}>✕</Text></TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={() => addLoc(key)}><Text style={styles.add}>+ Add location</Text></TouchableOpacity>
          </View>
        ))}
        <View style={styles.actions}>
          <Button title="Export to PDF" onPress={onExport} variant="outline" fullWidth style={styles.btn} />
          <Button title={isEdit ? 'Save' : 'Publish'} onPress={onPublish} variant="primary" fullWidth style={styles.btn} />
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
  cat: { marginTop: SPACING.lg },
  catLabel: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  input: { borderRadius: BORDER_RADIUS.md, padding: SPACING.md, fontSize: FONTS.base, borderWidth: 1, borderColor: COLORS.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  flex: { flex: 1 },
  rm: { color: COLORS.primary },
  add: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600', marginBottom: SPACING.sm },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
