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
  Modal,
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
import { useAuthStore } from '../store';
import watchKeepingService, { PublishedWatchTimetable } from '../services/watchKeeping';
import { formatLocalDateString } from '../utils';

export const WatchScheduleScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [publishedTimetables, setPublishedTimetables] = useState<PublishedWatchTimetable[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingSchedule, setViewingSchedule] = useState<PublishedWatchTimetable | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';

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
            setViewingSchedule(timetable);
            navigation.setParams({ timetableId: undefined });
          }
        }
      });
    }, [vesselId, loadPublished, route?.params?.timetableId, navigation])
  );

  const handleDelete = async (timetable: PublishedWatchTimetable) => {
    Alert.alert(
      'Delete Watch Schedule',
      `Are you sure you want to delete the schedule for ${formatLocalDateString(timetable.forDate, { month: 'short', day: 'numeric' })}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await watchKeepingService.delete(timetable.id);
              setViewingSchedule(null);
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
    setViewingSchedule(null);
    navigation.navigate('CreateWatchTimetable', { timetableId: timetable.id });
  };

  const SLOTS_PER_PAGE = 30;

  const exportWatchSchedulePdf = async (t: PublishedWatchTimetable) => {
    setExportingPdf(true);
    try {
      const dateStr = formatLocalDateString(t.forDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const headerMeta = `
          <h1>Watch Schedule</h1>
          <p class="subtitle">${dateStr}</p>
          ${t.startLocation ? `<p class="meta"><strong>From:</strong> ${t.startLocation}</p>` : ''}
          ${t.destination ? `<p class="meta"><strong>To:</strong> ${t.destination}</p>` : ''}
          <p class="meta"><strong>Start:</strong> ${t.startTime}</p>`;

      const slotToRow = (s: (typeof t.slots)[0]) =>
        `<tr><td>${s.crewPosition || '—'}</td><td>${s.crewName}</td><td>${s.startTimeStr} – ${s.endTimeStr}</td></tr>`;

      const chunks: (typeof t.slots)[] = [];
      for (let i = 0; i < t.slots.length; i += SLOTS_PER_PAGE) {
        chunks.push(t.slots.slice(i, i + SLOTS_PER_PAGE));
      }

      const pageBlocks = chunks.map((chunk, pageIndex) => {
        const rows = chunk.map(slotToRow).join('');
        const isLast = pageIndex === chunks.length - 1;
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
                      <th class="col-time">Time</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
              ${chunks.length > 1 ? `<p class="page-num">Page ${pageIndex + 1} of ${chunks.length}</p>` : ''}
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
          .col-position { width: 30%; }
          .col-crew { width: 35%; }
          .col-time { width: 35%; }
          .page-num { font-size: 11px; color: #999; margin-top: 14px; text-align: right; }
        </style>
        </head>
        <body>${pageBlocks.join('')}</body>
        </html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const filename = `Watch_Schedule_${t.forDate}.pdf`;
      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.moveAsync({ from: uri, to: newUri });
      await Sharing.shareAsync(newUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Export Watch Schedule as PDF',
      });
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Watch Schedule.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={loadPublished} colors={[COLORS.primary]} />
      }
    >
      {loading && publishedTimetables.length === 0 ? (
        <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: SPACING.xl }} />
      ) : publishedTimetables.length === 0 ? (
        <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
          No Watch Schedules yet. Create a timetable in Create, generate it, then tap Export to add it here.
        </Text>
      ) : (
        publishedTimetables.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.card, { backgroundColor: themeColors.surface }]}
            onPress={() => setViewingSchedule(t)}
            activeOpacity={0.8}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>{t.watchTitle}</Text>
              {isHOD && (
                <TouchableOpacity
                  onPress={() => handleDelete(t)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  disabled={deleting}
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>{formatLocalDateString(t.forDate, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            {t.startLocation ? <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>From: {t.startLocation}</Text> : null}
            {t.destination ? <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>To: {t.destination}</Text> : null}
            <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>Start: {t.startTime}</Text>
          </TouchableOpacity>
        ))
      )}

      {viewingSchedule && (
        <Modal visible animationType="slide">
          <ScrollView
            style={[styles.viewModal, { backgroundColor: themeColors.background }]}
            contentContainerStyle={styles.viewModalContent}
            showsVerticalScrollIndicator
          >
            <View style={[styles.viewHeader, { backgroundColor: themeColors.surface }]}>
              <Text style={styles.viewTitle}>Watch Schedule</Text>
              <Text style={[styles.viewDate, { color: themeColors.textSecondary }]}>
                {formatLocalDateString(viewingSchedule.forDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>
            <View style={styles.viewContent}>
              {viewingSchedule.startLocation ? <Text style={[styles.viewMeta, { color: themeColors.textSecondary }]}>From: {viewingSchedule.startLocation}</Text> : null}
              {viewingSchedule.destination ? <Text style={[styles.viewMeta, { color: themeColors.textSecondary }]}>To: {viewingSchedule.destination}</Text> : null}
              <Text style={[styles.viewMeta, { color: themeColors.textSecondary }]}>Start: {viewingSchedule.startTime}</Text>
              <View style={styles.slots}>
                {viewingSchedule.slots.map((slot, idx) => (
                  <View key={idx} style={[styles.slotRow, { backgroundColor: themeColors.surface }]}>
                    <Text style={[styles.slotCrew, { color: themeColors.textPrimary }]}>{slot.crewName}</Text>
                    {slot.crewPosition ? <Text style={[styles.slotRole, { color: themeColors.textSecondary }]}>{slot.crewPosition}</Text> : null}
                    <Text style={styles.slotTime}>{slot.startTimeStr} – {slot.endTimeStr}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.viewActions}>
              <TouchableOpacity
                style={styles.exportBtn}
                onPress={() => exportWatchSchedulePdf(viewingSchedule)}
                disabled={exportingPdf}
              >
                <Text style={styles.exportBtnText}>{exportingPdf ? 'Exporting...' : 'Export as PDF'}</Text>
              </TouchableOpacity>
              {isHOD && (
                <>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => handleEdit(viewingSchedule)}
                    disabled={deleting}
                  >
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(viewingSchedule)}
                    disabled={deleting}
                  >
                    <Text style={styles.deleteBtnText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={styles.closeBtn} onPress={() => setViewingSchedule(null)}>
                <Text style={[styles.closeBtnText, { color: themeColors.textSecondary }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Modal>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  empty: { fontSize: FONTS.base, padding: SPACING.xl },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.xs },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  cardMeta: { fontSize: FONTS.sm, marginTop: SPACING.xs },
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
  viewActions: { padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border, gap: SPACING.sm },
  exportBtn: { padding: SPACING.md, backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  exportBtnText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  editBtn: { padding: SPACING.md, backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, alignItems: 'center', opacity: 0.9 },
  editBtnText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  deleteBtn: { padding: SPACING.md, backgroundColor: '#dc2626', borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  deleteBtnText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  closeBtn: { padding: SPACING.sm, alignItems: 'center' },
  closeBtnText: { fontSize: FONTS.base },
});
