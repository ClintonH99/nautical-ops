import { ScreenLoading } from '../components/ScreenLoading';
import { optimisticDelete } from '../utils/optimisticDelete';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Safety Equipment Screen
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import safetyEquipmentService, {
  getSafetyEquipmentCategoryOrder,
} from '../services/safetyEquipment';
import {
  Button,
  LoadingSpinner,
  PageHeader,
  ExportButton,
  ExportBar,
  ButtonTagCard,
} from '../components';
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
  themeColors: { textPrimary: string; textSecondary: string; border: string };
}) {
  const items: { key: string; label: string; locations: string }[] = [];
  getSafetyEquipmentCategoryOrder(data, Object.keys(CATEGORY_LABELS)).forEach((key) => {
    const val = data[key];
    const arr = Array.isArray(val) ? val.filter(Boolean) : [];
    const locations = arr.map((raw) => normalizeSafetyItem(raw as any).location).filter(Boolean);
    if (locations.length)
      items.push({ key, label: getLabel(key, data), locations: locations.join(', ') });
  });

  return (
    <View style={styles.preview}>
      {items.length === 0 ? (
        <Text style={[styles.previewEmpty, { color: themeColors.textSecondary }]}>
          No locations added
        </Text>
      ) : (
        <>
          {items.map(({ key, label, locations }) => (
            <View key={key} style={[styles.previewRow, { borderBottomColor: themeColors.border }]}>
              <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
                {label}
              </Text>
              <Text style={[styles.previewValue, { color: themeColors.textPrimary }]}>
                {locations}
              </Text>
            </View>
          ))}
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
  const [items, setItems] = useScreenState<SafetyEquipment[]>('items', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  }, [setItems, setLoading, vesselId]);

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
            await optimisticDelete(item, setItems, () => safetyEquipmentService.delete(item.id));
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
  if (loading) return <ScreenLoading title="Safety Equipment" />;

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
        contentContainerStyle={[styles.content, items.length === 0 && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
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
        {canManage && (
          <View style={styles.createSection}>
            <Button
              title="Create Safety Equipment"
              onPress={() => navigation.navigate('CreateSafetyEquipment')}
              variant="primary"
              fullWidth
            />
          </View>
        )}
        <View style={styles.listHeading}>
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Published Equipment Plans
          </Text>
          <Text style={[styles.recordCount, { color: themeColors.textSecondary }]}>
            {items.length} {items.length === 1 ? 'record' : 'records'}
          </Text>
        </View>
        {items.map((item) => {
          const categoryKeys = getSafetyEquipmentCategoryOrder(
            item.data,
            Object.keys(CATEGORY_LABELS)
          );
          const populatedCategories = categoryKeys.filter((key) => {
            const value = item.data[key];
            return (
              Array.isArray(value) && value.some((raw) => normalizeSafetyItem(raw as any).location)
            );
          });
          const locationCount = populatedCategories.reduce((total, key) => {
            const value = item.data[key];
            if (!Array.isArray(value)) return total;
            return total + value.filter((raw) => normalizeSafetyItem(raw as any).location).length;
          }, 0);

          return (
            <ButtonTagCard
              key={item.id}
              headerTitle={item.title}
              minimal
              showCheckbox={exportMode}
              checked={selectedIds.has(item.id)}
              onToggleSelect={exportMode ? () => toggleSelect(item.id) : undefined}
              collapsible={!exportMode}
              expanded={expandedId === item.id}
              onToggleExpand={() =>
                setExpandedId((current) => (current === item.id ? null : item.id))
              }
              onEdit={canManage && !exportMode ? () => onEdit(item) : undefined}
              onDelete={canManage && !exportMode ? () => onDelete(item) : undefined}
              summary={
                <Text style={[styles.cardSummary, { color: themeColors.textSecondary }]}>
                  {populatedCategories.length}{' '}
                  {populatedCategories.length === 1 ? 'equipment type' : 'equipment types'} ·{' '}
                  {locationCount} {locationCount === 1 ? 'recorded location' : 'recorded locations'}
                </Text>
              }
            >
              <SafetyEquipmentPreview data={item.data} themeColors={themeColors} />
            </ButtonTagCard>
          );
        })}
        {items.length === 0 && (
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No published plans yet.{canManage ? ' Tap Create Safety Equipment to add one.' : ''}
          </Text>
        )}
        {!canManage && (
          <Text style={[styles.crewNote, { color: themeColors.textSecondary }]}>
            Only HODs and Captain have access. Crew can export to PDF.
          </Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  contentEmpty: { flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: FONTS.base, fontWeight: '700' },
  recordCount: { fontSize: FONTS.sm },
  cardSummary: { fontSize: FONTS.sm, lineHeight: 19 },
  preview: {
    marginBottom: SPACING.sm,
  },
  previewRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewLabel: { flex: 1, fontSize: FONTS.xs, fontWeight: '700' },
  previewValue: { flex: 1.2, fontSize: FONTS.sm, lineHeight: 19 },
  previewEmpty: { fontSize: FONTS.sm, fontStyle: 'italic', marginTop: SPACING.sm },
  emptyText: { fontSize: FONTS.base, marginBottom: SPACING.xl, textAlign: 'center' },
  createSection: { marginBottom: SPACING.lg },
  crewNote: { fontSize: FONTS.sm, textAlign: 'center', marginTop: SPACING.md, fontStyle: 'italic' },
});
