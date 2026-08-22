/**
 * Muster Station & Duties Screen
 * List of published muster stations, Create button, Download PDF per item
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
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import musterStationsService from '../services/musterStations';
import { Button, LoadingSpinner, PageHeader, ExportButton, ExportBar, Checkbox } from '../components';
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
  const musterLoc = d.musterStation?.trim() || '-';
  const medical = (d.medicalChest || []).filter(Boolean);
  const grabBag = (d.grabBag || []).filter(Boolean);
  const lifeRings = (d.lifeRings || []).filter(Boolean);
  const crew = (d.crewMembers || []).filter((c) => c?.roleName?.trim());
  const crewRoles = crew.map((c) => c.roleName.trim()).join(', ') || '-';

  return (
    <View style={styles.preview}>
      <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
        Muster Station
      </Text>
      <Text style={[styles.previewValue, { color: themeColors.textPrimary }]}>{musterLoc}</Text>
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
  const [items, setItems] = useState<MusterStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingList, setExportingList] = useState(false);

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
  }, [vesselId]);

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
            await musterStationsService.delete(item.id);
            load();
          } catch (e) {
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
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
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
      >
        <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>Published</Text>
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.card, { backgroundColor: themeColors.surface }]}
            onPress={() =>
              exportMode ? toggleSelect(item.id) : isHOD && onEdit(item)
            }
            activeOpacity={isHOD || exportMode ? 0.8 : 1}
            disabled={!isHOD && !exportMode}
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
              {isHOD && (
                <TouchableOpacity
                  onPress={() => onDelete(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              )}
            </View>
            <MusterStationPreview data={item.data} themeColors={themeColors} />
          </TouchableOpacity>
        ))}
        {items.length === 0 && (
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No published muster stations yet.{isHOD ? ' Create one below.' : ''}
          </Text>
        )}
        {isHOD && (
          <View style={styles.createSection}>
            <Button
              title="Create"
              onPress={() => navigation.navigate('CreateMusterStation')}
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
  contentEmpty: { flexGrow: 1 },
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
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  preview: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
  createSection: { marginTop: SPACING.lg },
});
