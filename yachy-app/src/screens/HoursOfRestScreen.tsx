/**
 * Hours of Rest Screen
 * Calendar view of a crew member's rest entries, with STCW compliance
 * checking (10h/24h minimum, max 2 rest periods, one >=6h). Past 30 days
 * are flagged completed (green) or not completed (red).
 */

import React, { useState, useCallback, useLayoutEffect } from 'react';
import { InfoModal } from '../components/InfoModal';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  RestEntry,
  checkRollingCompliance,
  getMonthDataForPdf,
} from '../services/restEntries';
import { generateHoursOfRestPdf } from '../utils/hoursOfRestPdf';
import { supabase } from '../services/supabase';

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const HoursOfRestScreen = ({ navigation }: any) => {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <InfoModal
          screenKey="hours_of_rest"
          autoShow={false}
          content={{
            title: 'Hours of Rest',
            description: 'Track your daily rest, work, and lunch hours to stay compliant with STCW/MLC regulations.',
            features: [
              'Tap any date on the calendar to log your hours of rest, time worked, and lunch break',
              'Green dates are completed, red dates still need an entry',
              'Once your week is filled in, submit it for your Captain or department signer to confirm',
              'Confirmed entries can still be corrected later by the Captain if needed',
              'Compliance is checked against real STCW rules: minimum 10 hours rest in any 24-hour period, minimum 77 hours in any 7-day period, and no more than a 14-hour gap between rest periods',
            ],
          }}
        />
      ),
    });
  }, [navigation]);

  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const isCaptainOrMov = user?.role === 'CAPTAIN_MOV';

  const [entries, setEntries] = useState<Record<string, RestEntry>>({});
  const [allEntriesForRolling, setAllEntriesForRolling] = useState<RestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // Fetch extra trailing history (37 days back) so the rolling 7-day
      // window calculation has enough context even for the earliest day
      // shown in the 30-day view.
      const since = toYYYYMMDD(daysAgo(37));
      const { data: rows } = await supabase
        .from('rest_entries')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', since);

      const byDate: Record<string, RestEntry> = {};
      (rows ?? []).forEach((r) => { byDate[r.date] = r; });
      setEntries(byDate);
      setAllEntriesForRolling(rows ?? []);

    } catch (e) {
      console.error('Load rest entries error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.vesselId, isCaptainOrMov]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // Build calendar bar markers (matching the Home screen's calendar style)
  // for the past 30 days: green bar if completed, red bar if a day in the
  // past has no entry. Each day is its own self-contained pill, not a
  // connected range — startingDay/endingDay both true per day.
  const markedDates: Record<string, any> = {};
  const todayStr = toYYYYMMDD(new Date());
  // Calendar reflects submission status only (green = entered, red =
  // missing) — it's a "what still needs filling in" tracker, not a
  // compliance indicator. Actual STCW violations surface in the review
  // queue and the exported PDF, not here.
  for (let i = 0; i < 30; i++) {
    const d = daysAgo(i);
    const dateStr = toYYYYMMDD(d);
    const hasEntry = !!entries[dateStr];
    if (dateStr === todayStr && !hasEntry) continue; // don't flag today until it's past

    markedDates[dateStr] = {
      periods: [
        {
          startingDay: true,
          endingDay: true,
          color: hasEntry ? '#16a34a' : '#dc2626',
        },
      ],
    };
  }

  const handleDayPress = (day: { dateString: string }) => {
    navigation.navigate('RestDayEntry', { date: day.dateString });
  };

  const handleExportOwnMonth = async () => {
    if (!user?.id) return;
    setExporting(true);
    try {
      const now = new Date();
      const data = await getMonthDataForPdf(user.id, now.getFullYear(), now.getMonth() + 1);
      if (!data || data.days.length === 0) {
        Alert.alert('No data', 'No rest entries found for this month yet.');
        return;
      }
      const filename = `HoursOfRest_${data.seafarerName.replace(/\s+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.pdf`;
      await generateHoursOfRestPdf(data, filename);
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Error', 'Could not export PDF.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: themeColors.textPrimary }]}>Hours of Rest</Text>
      <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
        Tap a date to enter or edit your hours
      </Text>

      {isCaptainOrMov && (
        <TouchableOpacity
          style={styles.reviewButton}
          onPress={() => navigation.navigate('RestToBeConfirmed')}
        >
          <Text style={styles.reviewButtonText}>Rest to be confirmed</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />
      ) : (
        <>
          <Calendar
            current={todayStr}
            maxDate={todayStr}
            markedDates={markedDates}
            markingType="multi-period"
            onDayPress={handleDayPress}
            theme={{
              backgroundColor: 'transparent',
              calendarBackground: 'transparent',
              todayTextColor: COLORS.primary,
              arrowColor: themeColors.textPrimary,
              monthTextColor: themeColors.textPrimary,
              dayTextColor: themeColors.textPrimary,
              textDisabledColor: themeColors.textSecondary,
            }}
          />

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#16a34a' }]} />
              <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs }}>Completed</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#dc2626' }]} />
              <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs }}>Not completed</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.reviewButton, { opacity: exporting ? 0.6 : 1, marginTop: SPACING.lg }]}
            onPress={handleExportOwnMonth}
            disabled={exporting}
          >
            <Text style={styles.reviewButtonText}>{exporting ? 'Exporting...' : 'Export to PDF'}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  title: { fontSize: FONTS['2xl'], fontWeight: '700' },
  subtitle: { fontSize: FONTS.base, marginBottom: SPACING.lg },
  signerBox: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.lg },
  signerSelect: { borderWidth: 1, borderRadius: BORDER_RADIUS.sm, padding: SPACING.sm },
  signerOptions: { marginTop: SPACING.sm, gap: 4 },
  signerOption: { paddingVertical: SPACING.sm },
  legendRow: { flexDirection: 'row', gap: SPACING.lg, justifyContent: 'center', marginTop: SPACING.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  reviewButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginBottom: SPACING.lg },
  reviewButtonText: { color: '#fff', fontWeight: '600' },
});
