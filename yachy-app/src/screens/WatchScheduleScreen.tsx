import { optimisticDelete } from '../utils/optimisticDelete';
import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Watch Schedule Screen
 * Published watch timetables - view and export as PDF
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { printStandardPdf } from '../utils/standardPdf';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader, ExportButton, ExportBar, ButtonTagCard } from '../components';
import { useAuthStore } from '../store';
import watchKeepingService, {
  PublishedWatchTimetable,
  TimetableSlot,
} from '../services/watchKeeping';
import { formatLocalDateString } from '../utils';
import { buildWatchSchedulePdfHtml, getWatchScheduleDate } from '../utils/watchSchedulePdf';
import { formatWatchHours, getPublishedWatchDurations } from '../utils/watchTimetable';

function formatSlotDate(slot: TimetableSlot, fallbackDate: string): string {
  const startDate = slot.startDate || fallbackDate;
  const startLabel = formatLocalDateString(startDate, { month: 'short', day: 'numeric' });
  if (slot.endDate && slot.endDate !== startDate) {
    const endLabel = formatLocalDateString(slot.endDate, { month: 'short', day: 'numeric' });
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel;
}

function formatDurationLabel(hours: number | null): string {
  if (hours === null) return '—';
  return `${formatWatchHours(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
}

export const WatchScheduleScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [publishedTimetables, setPublishedTimetables] = useScreenState<PublishedWatchTimetable[]>(
    'publishedTimetables',
    []
  );
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';

  const loadPublished = useCallback(async () => {
    if (!vesselId) return;
    setLoading(true);
    try {
      const data = await watchKeepingService.getByVessel(vesselId);
      setPublishedTimetables(data);
      return data;
    } catch (e) {
      console.error('Load published timetables error:', e);
      return [];
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setLoading, setPublishedTimetables, vesselId]);

  useFocusEffect(
    useCallback(() => {
      if (!vesselId) return;
      const timetableId = route?.params?.timetableId;
      loadPublished().then((data) => {
        if (timetableId && data && data.length > 0) {
          const timetable = data.find((t) => t.id === timetableId);
          if (timetable) {
            setExpandedId(timetable.id);
            navigation.setParams({ timetableId: undefined });
          }
        }
      });
    }, [vesselId, loadPublished, route?.params?.timetableId, navigation])
  );

  const handleDelete = async (timetable: PublishedWatchTimetable) => {
    Alert.alert(
      'Delete Watch Schedule',
      `Are you sure you want to delete the schedule for ${formatLocalDateString(getWatchScheduleDate(timetable), { month: 'short', day: 'numeric' })}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await optimisticDelete(timetable, setPublishedTimetables, () =>
                watchKeepingService.delete(timetable.id)
              );
              Alert.alert('Deleted', 'Watch Schedule has been deleted.');
            } catch (e) {
              console.error('Delete error:', e);
              Alert.alert('Error', 'Could not delete watch schedule.');
            }
          },
        },
      ]
    );
  };

  const handleEdit = (timetable: PublishedWatchTimetable) => {
    navigation.navigate('CreateWatchTimetable', { timetableId: timetable.id });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedSchedules = publishedTimetables.filter((timetable) =>
    selectedIds.has(timetable.id)
  );

  const exportWatchSchedulesPdf = async (schedules: PublishedWatchTimetable[]) => {
    if (schedules.length === 0) {
      Alert.alert('Nothing selected', 'Tap the watch schedules you want to include, then export.');
      return;
    }

    setExportingPdf(true);
    try {
      const html = buildWatchSchedulePdfHtml(schedules);
      const { uri } = await printStandardPdf({ html, title: 'Watch Schedule' });
      const filename =
        schedules.length === 1
          ? `Watch_Schedule_${getWatchScheduleDate(schedules[0])}.pdf`
          : 'Watch_Schedules.pdf';
      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.moveAsync({ from: uri, to: newUri });
      await Sharing.shareAsync(newUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Export Watch Schedules as PDF',
      });
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Export failed', 'Could not generate PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Watch Schedule.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Watch Schedule"
        actions={
          <ExportButton
            active={exportMode}
            busy={exportingPdf}
            onPress={() => {
              if (exportMode) setSelectedIds(new Set());
              if (!exportMode) setExpandedId(null);
              setExportMode(!exportMode);
            }}
          />
        }
      />
      {exportMode && (
        <ExportBar
          count={selectedSchedules.length}
          onConfirm={() => exportWatchSchedulesPdf(selectedSchedules)}
          exporting={exportingPdf}
          hint="Tap schedules to select"
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
              void loadPublished();
            }}
            colors={[themeColors.accent]}
            tintColor={themeColors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && publishedTimetables.length === 0 ? (
          <ActivityIndicator
            size="small"
            color={themeColors.accent}
            style={{ marginVertical: SPACING.xl }}
          />
        ) : publishedTimetables.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
            No Watch Schedules yet. Create a timetable in Create, generate it, then tap Publish to
            add it here.
          </Text>
        ) : (
          publishedTimetables.map((t) => {
            const expanded = expandedId === t.id && !exportMode;
            const date = formatLocalDateString(getWatchScheduleDate(t), {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
            const route = [t.startLocation, t.destination].filter(Boolean).join(' to ');
            const collapsedDetails = [route, `Start ${t.startTime}`].filter(Boolean).join(' · ');
            const publishedDurations = getPublishedWatchDurations(t.slots);
            return (
              <ButtonTagCard
                key={t.id}
                headerTitle={t.watchTitle}
                minimal
                collapsible
                expanded={expanded}
                onToggleExpand={() => setExpandedId(expanded ? null : t.id)}
                summary={
                  <View>
                    <Text style={[styles.recordDate, { color: themeColors.textSecondary }]}>
                      {date}
                    </Text>
                    {collapsedDetails ? (
                      <Text style={[styles.recordSummary, { color: themeColors.textSecondary }]}>
                        {collapsedDetails}
                      </Text>
                    ) : null}
                  </View>
                }
                showCheckbox={exportMode}
                checked={selectedIds.has(t.id)}
                selected={selectedIds.has(t.id)}
                onToggleSelect={() => toggleSelect(t.id)}
                onEdit={isHOD ? () => handleEdit(t) : undefined}
                onDelete={isHOD ? () => handleDelete(t) : undefined}
              >
                <View
                  style={[
                    styles.routePanel,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <View style={styles.routeGrid}>
                    <View style={styles.routeItem}>
                      <Text style={[styles.routeLabel, { color: themeColors.textSecondary }]}>
                        From
                      </Text>
                      <Text style={[styles.routeValue, { color: themeColors.textPrimary }]}>
                        {t.startLocation || '—'}
                      </Text>
                    </View>
                    <View style={styles.routeItem}>
                      <Text style={[styles.routeLabel, { color: themeColors.textSecondary }]}>
                        To
                      </Text>
                      <Text style={[styles.routeValue, { color: themeColors.textPrimary }]}>
                        {t.destination || '—'}
                      </Text>
                    </View>
                    <View style={[styles.routeItem, styles.startItem]}>
                      <Text style={[styles.routeLabel, { color: themeColors.textSecondary }]}>
                        Start
                      </Text>
                      <Text style={[styles.routeValue, { color: themeColors.textPrimary }]}>
                        {t.startTime}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.crewRestSection, { borderTopColor: themeColors.border }]}>
                    <Text style={[styles.crewRestTitle, { color: themeColors.accent }]}>
                      Crew Watch and Rest
                    </Text>
                    <View style={styles.crewRestGrid}>
                      <View style={styles.crewRestMetric}>
                        <Text style={[styles.crewRestLabel, { color: themeColors.textSecondary }]}>
                          Watch Duration p/p
                        </Text>
                        <Text style={[styles.crewRestValue, { color: themeColors.textPrimary }]}>
                          {formatDurationLabel(publishedDurations.watchDurationHours)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.crewRestMetric,
                          styles.crewRestMetricDivider,
                          { borderLeftColor: themeColors.border },
                        ]}
                      >
                        <Text style={[styles.crewRestLabel, { color: themeColors.textSecondary }]}>
                          Duration Rest p/p
                        </Text>
                        <Text style={[styles.crewRestValue, { color: themeColors.textPrimary }]}>
                          {formatDurationLabel(publishedDurations.restDurationHours)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
                {t.notes ? (
                  <View style={styles.notesBlock}>
                    <Text style={[styles.routeLabel, { color: themeColors.textSecondary }]}>
                      Notes
                    </Text>
                    <Text style={[styles.routeValue, { color: themeColors.textPrimary }]}>
                      {t.notes}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.assignmentsSection}>
                  <Text style={[styles.assignmentsTitle, { color: themeColors.textPrimary }]}>
                    Watch assignments
                  </Text>
                  {t.slots.length === 0 ? (
                    <Text style={[styles.noAssignments, { color: themeColors.textSecondary }]}>
                      No watch assignments
                    </Text>
                  ) : (
                    t.slots.map((slot, index) => (
                      <View
                        key={`${slot.crewId}-${slot.startDate || ''}-${slot.startTimeStr}-${index}`}
                        style={[
                          styles.assignmentRow,
                          {
                            borderColor: themeColors.border,
                            backgroundColor: themeColors.control,
                          },
                        ]}
                      >
                        <View style={styles.assignmentCrew}>
                          <Text style={[styles.assignmentName, { color: themeColors.textPrimary }]}>
                            {slot.crewName}
                          </Text>
                          <Text
                            style={[
                              styles.assignmentPosition,
                              { color: themeColors.textSecondary },
                            ]}
                          >
                            {slot.crewPosition || 'Crew'}
                          </Text>
                        </View>
                        <View style={styles.assignmentTimeBlock}>
                          <Text
                            style={[styles.assignmentDate, { color: themeColors.textSecondary }]}
                          >
                            {formatSlotDate(slot, getWatchScheduleDate(t))}
                          </Text>
                          <Text style={[styles.assignmentTime, { color: themeColors.textPrimary }]}>
                            {slot.startTimeStr} – {slot.endTimeStr}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </ButtonTagCard>
            );
          })
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
  empty: { fontSize: FONTS.base, padding: SPACING.xl },
  recordDate: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
  },
  recordSummary: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  routePanel: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  routeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  routeItem: {
    minWidth: '44%',
    flexGrow: 1,
  },
  startItem: {
    flexBasis: '100%',
  },
  routeLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  routeValue: {
    fontSize: FONTS.base,
    lineHeight: 20,
  },
  crewRestSection: {
    borderTopWidth: 1,
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
  },
  crewRestTitle: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  crewRestGrid: {
    flexDirection: 'row',
  },
  crewRestMetric: {
    flex: 1,
    minWidth: 0,
  },
  crewRestMetricDivider: {
    borderLeftWidth: 1,
    paddingLeft: SPACING.md,
    marginLeft: SPACING.md,
  },
  crewRestLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    lineHeight: 17,
    minHeight: 34,
  },
  crewRestValue: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    lineHeight: 24,
    marginTop: SPACING.xs,
  },
  notesBlock: {
    marginTop: SPACING.md,
  },
  assignmentsSection: {
    marginTop: SPACING.lg,
  },
  assignmentsTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  noAssignments: {
    fontSize: FONTS.sm,
    paddingVertical: SPACING.sm,
  },
  assignmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  assignmentCrew: {
    flex: 1,
  },
  assignmentName: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  assignmentPosition: {
    fontSize: FONTS.sm,
    marginTop: 2,
  },
  assignmentTimeBlock: {
    flexShrink: 0,
    alignItems: 'flex-end',
    maxWidth: '52%',
  },
  assignmentDate: {
    fontSize: FONTS.xs,
    marginBottom: 2,
    textAlign: 'right',
  },
  assignmentTime: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
  viewModal: { flex: 1 },
  viewModalContent: { paddingBottom: SIZES.bottomScrollPadding },
  viewHeader: { padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  viewTitle: { fontSize: FONTS.xl, fontWeight: '700', color: COLORS.primary },
  viewDate: { fontSize: FONTS.base, marginTop: SPACING.xs },
  viewContent: { padding: SPACING.lg },
  viewMeta: { fontSize: FONTS.base, marginBottom: SPACING.xs },
  slots: { marginTop: SPACING.lg },
  slotRow: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.sm },
  slotCrew: { fontSize: FONTS.base, fontWeight: '600' },
  slotRole: { fontSize: FONTS.sm, marginTop: 2 },
  slotTime: { fontSize: FONTS.sm, color: COLORS.primary, fontWeight: '600', marginTop: SPACING.xs },
  viewActions: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.sm,
  },
  exportBtn: {
    padding: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  exportBtnText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  editBtn: {
    padding: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    opacity: 0.9,
  },
  editBtnText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  deleteBtn: {
    padding: SPACING.md,
    backgroundColor: '#dc2626',
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  closeBtn: { padding: SPACING.sm, alignItems: 'center' },
  closeBtnText: { fontSize: FONTS.base },
});
