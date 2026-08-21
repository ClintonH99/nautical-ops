/**
 * Safety Equipment Screen
 */

import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import safetyEquipmentService from '../services/safetyEquipment';
import { Button, LoadingSpinner, PageHeader, ExportButton, ExportBar, Checkbox } from '../components';
import { generateSafetyEquipmentListPdf } from '../utils/safetyEquipmentPdf';
import type { SafetyEquipment, SafetyEquipmentData } from '../services/safetyEquipment';
import { normalizeSafetyItem } from '../services/safetyEquipment';

const CATEGORY_LABELS: Record<string, string> = {
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

function getLabel(key: string, data: SafetyEquipmentData): string {
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return data.customLabels?.[key] ?? key.replace(/^custom_/, '').replace(/_/g, ' ');
}

function SafetyEquipmentPreview({
  data,
  themeColors,
}: {
  data: SafetyEquipmentData;
  themeColors: { textPrimary: string; textSecondary: string };
}) {
  const items: { key: string; label: string; locations: string }[] = [];
  Object.entries(data || {}).forEach(([key, val]) => {
    if (key === 'vesselName' || key === 'customLabels') return;
    const arr = Array.isArray(val) ? val.filter(Boolean) : [];
    const locations = arr.map((raw) => normalizeSafetyItem(raw as any).location).filter(Boolean);
    if (locations.length) items.push({ key, label: getLabel(key, data), locations: locations.join(', ') });
  });

  return (
    <View style={styles.preview}>
      {items.length === 0 ? (
        <Text style={[styles.previewEmpty, { color: themeColors.textSecondary }]}>
          No locations added
        </Text>
      ) : (
        <>
          {items.slice(0, 5).map(({ key, label, locations }) => (
            <Text
              key={key}
              style={[styles.previewRow, { color: themeColors.textPrimary }]}
              numberOfLines={1}
            >
              <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
                {label}:{' '}
              </Text>
              {locations}
            </Text>
          ))}
          {items.length > 5 && (
            <Text style={[styles.previewMore, { color: themeColors.textSecondary }]}>
              +{items.length - 5} more
            </Text>
          )}
        </>
      )}
    </View>
  );
}


const SAFETY_EQUIPMENT_INFO = {
            title: 'Safety Equipment',
            description: 'Log and track safety equipment on-board.',
            features: [
              'Record safety equipment and locations',
              'Track service and expiry dates',
              'Keep an auditable safety inventory',
              'Update records after inspections',
            ],
          };

export const SafetyEquipmentScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const isMOV = user?.role === 'CAPTAIN_MOV';
  const canManage = isHOD || isMOV;
  const [items, setItems] = useState<SafetyEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingList, setExportingList] = useState(false);

  const load = useCallback(async () => {
    if (!vesselId) return;
    try {
      setItems(await safetyEquipmentService.getByVessel(vesselId));
    } catch (e) {
      console.error('Load safety equipment error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedPlans = items.filter((i) => selectedIds.has(i.id));

  const onExportSelected = async () => {
    if (selectedPlans.length === 0) {
      Alert.alert('Nothing selected', 'Tap the plans you want to include, then export.');
      return;
    }
    setExportingList(true);
    try {
      await generateSafetyEquipmentListPdf(
        selectedPlans.map((p) => ({ title: p.title, data: p.data })),
        String(selectedPlans[0]?.data?.vesselName ?? '')
      );
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not create the PDF. Please try again.');
    } finally {
      setExportingList(false);
    }
  };

  const onEdit = (item: SafetyEquipment) => {
    if (!canManage) return;
    navigation.navigate('CreateSafetyEquipment', { equipmentId: item.id });
  };

  const onDelete = (item: SafetyEquipment) => {
    if (!canManage) return;
    Alert.alert('Delete safety equipment', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await safetyEquipmentService.delete(item.id);
            load();
          } catch (e) {
            Alert.alert('Error', 'Could not delete');
          }
        },
      },
    ]);
  };

  if (!vesselId)
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Safety Equipment.
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
    <View style={styles.pageWrap}>
      <PageHeader
        title="Safety Equipment"
        info={SAFETY_EQUIPMENT_INFO}
        infoScreenKey="safety_equipment"
        actions={
          <ExportButton
            active={exportMode}
            onPress={() => {
              if (exportMode) setSelectedIds(new Set());
              setExportMode(!exportMode);
            }}
          />
        }
      />
      {exportMode && (
        <ExportBar
          count={selectedPlans.length}
          onConfirm={onExportSelected}
          exporting={exportingList}
          hint="Tap plans to select"
        />
      )}
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>Published</Text>
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.card, { backgroundColor: themeColors.surface }]}
            onPress={() => (exportMode ? toggleSelect(item.id) : onEdit(item))}
            activeOpacity={canManage || exportMode ? 0.8 : 1}
          >
            <View style={styles.cardHeader}>
              {exportMode && (
                <Checkbox
                  checked={selectedIds.has(item.id)}
                  onPress={() => toggleSelect(item.id)}
                  surface={themeColors.surface}
                />
              )}
              <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
                {item.title}
              </Text>
              {canManage && (
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    onPress={() => onEdit(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="pencil-outline" size={20} color={themeColors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDelete(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <SafetyEquipmentPreview data={item.data} themeColors={themeColors} />
          </TouchableOpacity>
        ))}
        {items.length === 0 && (
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No published plans yet.{canManage ? ' Create one below.' : ''}
          </Text>
        )}
        {!canManage && (
          <Text style={[styles.crewNote, { color: themeColors.textSecondary }]}>
            Only HODs and Captain have access. Crew can export to PDF.
          </Text>
        )}
        {canManage && (
          <View style={styles.createSection}>
            <Button
              title="Create"
              onPress={() => navigation.navigate('CreateSafetyEquipment')}
              variant="primary"
              fullWidth
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  sectionTitle: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.md },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  preview: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  previewRow: { fontSize: FONTS.sm, marginBottom: 2 },
  previewLabel: { fontWeight: '600' },
  previewMore: { fontSize: FONTS.xs, marginTop: 2 },
  previewEmpty: { fontSize: FONTS.sm, fontStyle: 'italic', marginTop: SPACING.sm },
  emptyText: { fontSize: FONTS.base, marginBottom: SPACING.xl, textAlign: 'center' },
  createSection: { marginTop: SPACING.lg },
  crewNote: { fontSize: FONTS.sm, textAlign: 'center', marginTop: SPACING.md, fontStyle: 'italic' },
});
