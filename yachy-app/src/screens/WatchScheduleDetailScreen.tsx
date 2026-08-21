/**
 * Watch Schedule Detail Screen
 * Full view of one published watch schedule - was previously a Modal on
 * WatchScheduleScreen, converted to a real screen so it gets a proper
 * header (correctly below the status bar) and the standard swipe-back
 * gesture, matching every other screen in the app.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import watchKeepingService, { PublishedWatchTimetable } from '../services/watchKeeping';
import { formatLocalDateString } from '../utils';

function scheduleDateStr(t: { forDate: string | null; createdAt: string }): string {
  return t.forDate || t.createdAt.slice(0, 10);
}

export const WatchScheduleDetailScreen = ({ navigation, route }: any) => {
  const schedule = route.params?.schedule as PublishedWatchTimetable;
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportPdf = async () => {
    setExportingPdf(true);
    try {
      const dateStr = formatLocalDateString(scheduleDateStr(schedule), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const rows = schedule.slots
        .map((s) => `<tr><td>${s.crewName}</td><td>${s.crewPosition || ''}</td><td>${s.startTimeStr} - ${s.endTimeStr}</td></tr>`)
        .join('');
      const html = `
        <!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          @page { size: A4 portrait; margin: 20mm 16mm; }
          body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
          h1 { font-size: 20px; color: #1E3A8A; }
          .subtitle { color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
          thead tr { background: #1E3A8A; color: #fff; }
        </style></head>
        <body>
          <h1>Watch Schedule</h1>
          <p class="subtitle">${dateStr}</p>
          ${schedule.startLocation ? `<p><strong>From:</strong> ${schedule.startLocation}</p>` : ''}
          ${schedule.destination ? `<p><strong>To:</strong> ${schedule.destination}</p>` : ''}
          <p><strong>Start:</strong> ${schedule.startTime}</p>
          <table><thead><tr><th>Crew</th><th>Role</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
        </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const filename = `Watch_Schedule_${scheduleDateStr(schedule)}.pdf`;
      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.moveAsync({ from: uri, to: newUri });
      await Sharing.shareAsync(newUri, { mimeType: 'application/pdf', dialogTitle: 'Export Watch Schedule as PDF' });
    } catch (e) {
      Alert.alert('Error', 'Could not export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleEdit = () => {
    navigation.navigate('CreateWatchTimetable', { timetableId: schedule.id });
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Watch Schedule',
      `Are you sure you want to delete the schedule for ${formatLocalDateString(scheduleDateStr(schedule), { month: 'short', day: 'numeric' })}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await watchKeepingService.delete(schedule.id);
              navigation.goBack();
            } catch (e) {
              Alert.alert('Error', 'Could not delete watch schedule.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Watch Schedule" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
        <Text style={[styles.viewDate, { color: themeColors.textSecondary }]}>
          {formatLocalDateString(scheduleDateStr(schedule), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </Text>
        {schedule.startLocation ? <Text style={[styles.viewMeta, { color: themeColors.textSecondary }]}>From: {schedule.startLocation}</Text> : null}
        {schedule.destination ? <Text style={[styles.viewMeta, { color: themeColors.textSecondary }]}>To: {schedule.destination}</Text> : null}
        <Text style={[styles.viewMeta, { color: themeColors.textSecondary }]}>Start: {schedule.startTime}</Text>
        <View style={styles.slots}>
          {schedule.slots.map((slot, idx) => (
            <View key={idx} style={[styles.slotRow, { backgroundColor: themeColors.surface }]}>
              <Text style={[styles.slotCrew, { color: themeColors.textPrimary }]}>{slot.crewName}</Text>
              {slot.crewPosition ? <Text style={[styles.slotRole, { color: themeColors.textSecondary }]}>{slot.crewPosition}</Text> : null}
              <Text style={styles.slotTime}>{slot.startTimeStr} - {slot.endTimeStr}</Text>
            </View>
          ))}
        </View>
        <View style={styles.viewActions}>
          <TouchableOpacity style={styles.exportBtn} onPress={exportPdf} disabled={exportingPdf}>
            <Text style={styles.exportBtnText}>{exportingPdf ? 'Exporting...' : 'Export to PDF'}</Text>
          </TouchableOpacity>
          {isHOD && (
            <>
              <TouchableOpacity style={styles.editBtn} onPress={handleEdit} disabled={deleting}>
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
                <Text style={styles.deleteBtnText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  viewDate: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  viewMeta: { fontSize: FONTS.sm, marginBottom: 4 },
  slots: { marginTop: SPACING.lg, gap: SPACING.sm },
  slotRow: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md },
  slotCrew: { fontSize: FONTS.base, fontWeight: '600' },
  slotRole: { fontSize: FONTS.xs, marginTop: 2 },
  slotTime: { fontSize: FONTS.sm, color: COLORS.primary, marginTop: 4, fontWeight: '600' },
  viewActions: { marginTop: SPACING.xl, gap: SPACING.md },
  exportBtn: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.primary, alignItems: 'center' },
  exportBtnText: { color: '#fff', fontWeight: '600' },
  editBtn: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center' },
  editBtnText: { color: COLORS.primary, fontWeight: '600' },
  deleteBtn: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.danger, alignItems: 'center' },
  deleteBtnText: { color: COLORS.danger, fontWeight: '600' },
});
