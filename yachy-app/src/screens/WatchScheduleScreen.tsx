/**
 * Watch Schedule Screen
 * Published watch timetables - view and export as PDF
 */

import React, { useState, useCallback } from 'react';
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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader, ExportButton, ExportBar, Checkbox, PreviewActionButtons } from '../components';
import { useAuthStore } from '../store';
import watchKeepingService, { PublishedWatchTimetable } from '../services/watchKeeping';
import { formatLocalDateString } from '../utils';

export const WatchScheduleScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [publishedTimetables, setPublishedTimetables] = useState<PublishedWatchTimetable[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    }
  }, [vesselId]);

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

  // Newly generated timetables require a voyage start date. The fallback
  // keeps older published schedules readable if they predate that field.
  const scheduleDateStr = (t: { forDate: string | null; createdAt: string }): string =>
    t.forDate || t.createdAt.slice(0, 10);

  const slotTimeLabel = (slot: PublishedWatchTimetable['slots'][number]): string => {
    if (!slot.startDate) return `${slot.startTimeStr} – ${slot.endTimeStr}`;
    const startDate = formatLocalDateString(slot.startDate, { month: 'short', day: 'numeric' });
    if (slot.endDate && slot.endDate !== slot.startDate) {
      const endDate = formatLocalDateString(slot.endDate, { month: 'short', day: 'numeric' });
      return `${startDate} ${slot.startTimeStr} – ${endDate} ${slot.endTimeStr}`;
    }
    return `${startDate} · ${slot.startTimeStr} – ${slot.endTimeStr}`;
  };

  const handleDelete = async (timetable: PublishedWatchTimetable) => {
    Alert.alert(
      'Delete Watch Schedule',
      `Are you sure you want to delete the schedule for ${formatLocalDateString(scheduleDateStr(timetable), { month: 'short', day: 'numeric' })}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await watchKeepingService.delete(timetable.id);
              loadPublished();
              Alert.alert('Deleted', 'Watch Schedule has been deleted.');
            } catch (e) {
              console.error('Delete error:', e);
              Alert.alert('Error', 'Could not delete watch schedule.');
            } finally {
              setDeleting(false);
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

  const SLOTS_PER_PAGE = 30;

  const exportWatchSchedulesPdf = async (schedules: PublishedWatchTimetable[]) => {
    if (schedules.length === 0) {
      Alert.alert('Nothing selected', 'Tap the watch schedules you want to include, then export.');
      return;
    }

    setExportingPdf(true);
    try {
      const slotToRow = (s: PublishedWatchTimetable['slots'][number]) =>
        `<tr><td>${s.crewPosition || '—'}</td><td>${s.crewName}</td><td>${slotTimeLabel(s)}</td></tr>`;

      const pages = schedules.flatMap((schedule) => {
        const chunks: PublishedWatchTimetable['slots'][] = [];
        for (let i = 0; i < schedule.slots.length; i += SLOTS_PER_PAGE) {
          chunks.push(schedule.slots.slice(i, i + SLOTS_PER_PAGE));
        }
        if (chunks.length === 0) chunks.push([]);
        return chunks.map((slots) => ({ schedule, slots }));
      });

      const pageBlocks = pages.map(({ schedule, slots }, pageIndex) => {
        const dateStr = formatLocalDateString(scheduleDateStr(schedule), {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
        const headerMeta = `
          <h1>Watch Schedule</h1>
          <p class="subtitle">${dateStr}</p>
          <p class="meta"><strong>Schedule:</strong> ${schedule.watchTitle}</p>
          ${schedule.startLocation ? `<p class="meta"><strong>From:</strong> ${schedule.startLocation}</p>` : ''}
          ${schedule.destination ? `<p class="meta"><strong>To:</strong> ${schedule.destination}</p>` : ''}
          <p class="meta"><strong>Start:</strong> ${schedule.startTime}</p>`;
        const rows = slots.map(slotToRow).join('');
        const isLast = pageIndex === pages.length - 1;
        return `
          <div class="page" ${isLast ? '' : 'style="page-break-after: always;"'}>
            <div class="content">
              ${headerMeta}
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th class="col-position">Position</th>
                      <th class="col-crew">Crew</th>
                      <th class="col-time">Date and time</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
              ${pages.length > 1 ? `<p class="page-num">Page ${pageIndex + 1} of ${pages.length}</p>` : ''}
            </div>
          </div>`;
      });

      const html = `<!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Watch Schedule</title>
        <style>
          @page { size: A4 portrait; margin: 20mm 16mm; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; line-height: 1.4; }
          h1 { font-size: 20px; font-weight: 700; color: #1E3A8A; margin-bottom: 4px; }
          .subtitle { font-size: 11px; color: #666; margin-bottom: 16px; }
          .meta { font-size: 11px; color: #555; margin-bottom: 4px; }
          .table-container { width: 55%; margin-top: 14px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          thead tr { background: #1E3A8A; color: #fff; }
          th { padding: 8px 10px; text-align: left; font-weight: 600; }
          td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          tr:nth-child(even) td { background: #f9fafb; }
          .col-position { width: 25%; }
          .col-crew { width: 30%; }
          .col-time { width: 45%; }
          .page-num { font-size: 11px; color: #999; margin-top: 14px; text-align: right; }
        </style>
        </head>
        <body>${pageBlocks.join('')}</body>
        </html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const filename =
        schedules.length === 1
          ? `Watch_Schedule_${scheduleDateStr(schedules[0])}.pdf`
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
    <View style={styles.pageWrap}>
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
            refreshing={loading}
            onRefresh={loadPublished}
            colors={[COLORS.primary]}
          />
        }
      >
        {loading && publishedTimetables.length === 0 ? (
          <ActivityIndicator
            size="small"
            color={COLORS.primary}
            style={{ marginVertical: SPACING.xl }}
          />
        ) : publishedTimetables.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
            No Watch Schedules yet. Create a timetable in Create, generate it, then tap Export to
            add it here.
          </Text>
        ) : (
          publishedTimetables.map((t) => {
            const expanded = isHOD && expandedId === t.id && !exportMode;
            return (
              <View key={t.id} style={[styles.card, { backgroundColor: themeColors.surface }]}>
                <TouchableOpacity
                  style={styles.cardSummary}
                  onPress={() => {
                    if (exportMode) toggleSelect(t.id);
                    else if (isHOD) setExpandedId(expanded ? null : t.id);
                  }}
                  activeOpacity={exportMode || isHOD ? 0.8 : 1}
                >
                  <View style={styles.cardHeader}>
                    {exportMode && (
                      <Checkbox
                        checked={selectedIds.has(t.id)}
                        onPress={() => toggleSelect(t.id)}
                        surface={themeColors.surface}
                      />
                    )}
                    <Text
                      style={[styles.cardTitle, { color: themeColors.textPrimary }]}
                      numberOfLines={1}
                    >
                      {t.watchTitle}
                    </Text>
                    {!exportMode && isHOD && (
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={themeColors.textSecondary}
                      />
                    )}
                  </View>
                  <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                    {formatLocalDateString(scheduleDateStr(t), {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                  {t.startLocation ? (
                    <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                      From: {t.startLocation}
                    </Text>
                  ) : null}
                  {t.destination ? (
                    <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                      To: {t.destination}
                    </Text>
                  ) : null}
                  <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                    Start: {t.startTime}
                  </Text>
                </TouchableOpacity>

                {expanded && (
                  <View
                    style={[
                      styles.previewPanel,
                      {
                        borderTopColor: themeColors.isDark
                          ? 'rgba(255,255,255,0.14)'
                          : COLORS.border,
                      },
                    ]}
                  >
                    <PreviewActionButtons
                      onEdit={() => handleEdit(t)}
                      onDelete={() => handleDelete(t)}
                      deleting={deleting}
                    />
                  </View>
                )}
              </View>
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
  card: {
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  cardSummary: { padding: SPACING.lg },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  cardMeta: { fontSize: FONTS.sm, marginTop: SPACING.xs },
  previewPanel: {
    borderTopWidth: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
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
