import { ScreenLoading } from '../components/ScreenLoading';
import { optimisticDelete } from '../utils/optimisticDelete';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Muster Station & Duties Screen
 * List of published muster stations, Create button, Download PDF per item
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import musterStationsService, { getMusterStationLocations } from '../services/musterStations';
import {
  Button,
  ButtonTagCard,
  LoadingSpinner,
  PageHeader,
  ExportButton,
  ExportBar,
} from '../components';
import { generateMusterStationListPdf } from '../utils/musterStationPdf';
import type { MusterStation, MusterStationData } from '../services/musterStations';

function MusterStationPreview({
  data,
  themeColors,
}: {
  data: MusterStationData;
  themeColors: { textPrimary: string; textSecondary: string };
}) {
  const d = data || {};
  const musterLocations = getMusterStationLocations(d);
  const medical = (d.medicalChest || []).filter(Boolean);
  const grabBag = (d.grabBag || []).filter(Boolean);
  const lifeRings = (d.lifeRings || []).filter(Boolean);
  const crew = (d.crewMembers || []).filter((c) => c?.roleName?.trim());
  const crewRoles = crew.map((c) => c.roleName.trim()).join(', ') || '-';

  return (
    <View style={styles.preview}>
      <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
        Muster Station Locations
      </Text>
      <Text style={[styles.previewValue, { color: themeColors.textPrimary }]}>
        {musterLocations.join(', ') || '-'}
      </Text>
      {(medical.length > 0 || grabBag.length > 0 || lifeRings.length > 0) && (
        <View style={styles.previewMetaWrap}>
          {medical.length > 0 && (
            <Text
              style={[styles.previewMeta, { color: themeColors.textSecondary }]}
              numberOfLines={1}
            >
              Medical bags: {medical.join(', ')}
            </Text>
          )}
          {grabBag.length > 0 && (
            <Text
              style={[styles.previewMeta, { color: themeColors.textSecondary }]}
              numberOfLines={1}
            >
              Grab bag: {grabBag.join(', ')}
            </Text>
          )}
          {lifeRings.length > 0 && (
            <Text
              style={[styles.previewMeta, { color: themeColors.textSecondary }]}
              numberOfLines={1}
            >
              Life rings: {lifeRings.join(', ')}
            </Text>
          )}
        </View>
      )}
      <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>Crew duties</Text>
      <Text style={[styles.previewValue, { color: themeColors.textPrimary }]} numberOfLines={2}>
        {crewRoles}
      </Text>
    </View>
  );
}

const MUSTER_STATION_INFO = {
  title: 'Muster Station & Duties',
  description: 'Assign crew muster stations and emergency duties.',
  features: [
    'Define muster stations for the vessel',
    'Assign crew roles and duties per station',
    'Keep emergency responsibilities clear',
    'Update assignments as crew changes',
  ],
};

export const MusterStationScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const [items, setItems] = useScreenState<MusterStation[]>('items', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingList, setExportingList] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await musterStationsService.getByVessel(vesselId);
      setItems(data);
    } catch (e) {
      console.error('Load muster stations error:', e);
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

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedStations = items.filter((i) => selectedIds.has(i.id));

  const onExportSelected = async () => {
    if (selectedStations.length === 0) {
      Alert.alert('Nothing selected', 'Tap the muster stations you want to include, then export.');
      return;
    }
    setExportingList(true);
    try {
      await generateMusterStationListPdf(
        selectedStations.map((m) => ({ title: m.title, data: m.data })),
        String(selectedStations[0]?.data?.vesselName ?? '')
      );
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not create the PDF. Please try again.');
    } finally {
      setExportingList(false);
    }
  };

  const onEdit = (item: MusterStation) => {
    if (!isHOD) return;
    navigation.navigate('CreateMusterStation', { musterStationId: item.id });
  };

  const onDelete = (item: MusterStation) => {
    if (!isHOD) return;
    Alert.alert('Delete muster station', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await optimisticDelete(item, setItems, () => musterStationsService.delete(item.id));
          } catch {
            Alert.alert('Error', 'Could not delete muster station');
          }
        },
      },
    ]);
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Muster Station & Duties.
        </Text>
      </View>
    );
  }

  if (loading) {
    return <ScreenLoading title="Muster Station & Duties" />;
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader
        title="Muster Station & Duties"
        info={MUSTER_STATION_INFO}
        infoScreenKey="muster_station"
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
          count={selectedStations.length}
          onConfirm={onExportSelected}
          exporting={exportingList}
          hint="Tap stations to select"
        />
      )}
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={[styles.content, items.length === 0 && styles.contentEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {isHOD && (
          <View style={styles.createSection}>
            <Button
              title="Create Muster Station"
              onPress={() => navigation.navigate('CreateMusterStation')}
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
            Published Muster Stations
          </Text>
          <Text style={[styles.recordCount, { color: themeColors.textSecondary }]}>
            {items.length} {items.length === 1 ? 'record' : 'records'}
          </Text>
        </View>
        {items.map((item) => {
          const locations = getMusterStationLocations(item.data).filter(Boolean);
          const crewCount = (item.data?.crewMembers ?? []).filter((crew) =>
            crew?.roleName?.trim()
          ).length;
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
              onEdit={isHOD && !exportMode ? () => onEdit(item) : undefined}
              onDelete={isHOD && !exportMode ? () => onDelete(item) : undefined}
              summary={
                <Text style={[styles.cardSummary, { color: themeColors.textSecondary }]}>
                  {locations.join(', ') || 'No location'} · {crewCount}{' '}
                  {crewCount === 1 ? 'crew duty' : 'crew duties'}
                </Text>
              }
            >
              <MusterStationPreview data={item.data} themeColors={themeColors} />
            </ButtonTagCard>
          );
        })}
        {items.length === 0 && (
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No published muster stations yet.
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
  createSection: { marginBottom: SPACING.lg },
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
    marginBottom: SPACING.md,
  },
  previewLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  previewValue: { fontSize: FONTS.sm, marginBottom: SPACING.sm },
  previewMetaWrap: { marginBottom: SPACING.sm },
  previewMeta: { fontSize: FONTS.xs },
  emptyText: { fontSize: FONTS.base, marginBottom: SPACING.xl, textAlign: 'center' },
});
