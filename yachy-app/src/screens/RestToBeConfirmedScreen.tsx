/**
 * Rest to be Confirmed Screen
 * Captain-only review queue: shows every day this month grouped into three
 * sections that flow toward completion - "Not Complete" (missing or still
 * being filled in), "Complete" (submitted by crew, awaiting Captain
 * confirmation), and "Confirmed" (signed off). History tab covers past
 * months in the same layout.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { DayReview, DayReviewEntry, getMonthReview, getPastMonths } from '../services/restEntries';

const STATUS_LABEL: Record<string, string> = {
  missing: 'not complete',
  draft: 'not complete',
  pending_confirmation: 'complete - awaiting confirmation',
  confirmed: 'confirmed',
};

type DayCategory = 'not_complete' | 'complete' | 'confirmed';

function categorizeDay(entries: DayReviewEntry[]): DayCategory {
  const hasIncomplete = entries.some((e) => e.status === 'missing' || e.status === 'draft');
  if (hasIncomplete) return 'not_complete';
  const hasPending = entries.some((e) => e.status === 'pending_confirmation');
  if (hasPending) return 'complete';
  return 'confirmed';
}

export const RestToBeConfirmedScreen = () => {
  const navigation = useNavigation<any>();
  const themeColors = useThemeColors();
  const { user } = useAuthStore();

  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number } | null>(null);
  const [days, setDays] = useState<DayReview[]>([]);
  const [loading, setLoading] = useState(true);

  const pastMonths = getPastMonths(12);

  const loadCurrent = useCallback(async () => {
    if (!user?.vesselId) return;
    setLoading(true);
    const now = new Date();
    const result = await getMonthReview(user.vesselId, now.getFullYear(), now.getMonth() + 1);
    setDays(result);
    setLoading(false);
  }, [user?.vesselId]);

  const loadMonth = useCallback(async (year: number, month: number) => {
    if (!user?.vesselId) return;
    setLoading(true);
    const result = await getMonthReview(user.vesselId, year, month);
    setDays(result);
    setLoading(false);
  }, [user?.vesselId]);

  useFocusEffect(
    useCallback(() => {
      if (tab === 'current') loadCurrent();
    }, [tab, loadCurrent])
  );

  const notComplete = days.filter((d) => categorizeDay(d.entries) === 'not_complete');
  const complete = days.filter((d) => categorizeDay(d.entries) === 'complete');
  const confirmed = days.filter((d) => categorizeDay(d.entries) === 'confirmed');

  const openDay = (date: string, userId: string, userName: string) => {
    navigation.navigate('RestDayEntry', {
      date,
      targetUserId: userId,
      targetUserName: userName,
      isManagerEditing: true,
    });
  };

  const renderSection = (title: string, color: string, list: DayReview[]) => {
    if (list.length === 0) return null;
    return (
      <View style={{ marginBottom: SPACING.lg }}>
        <Text style={[styles.sectionLabel, { color }]}>{title}</Text>
        {list.map((day) => (
          <View key={day.date} style={[styles.dayCard, { borderColor: color }]}>
            <Text style={[styles.dayTitle, { color: themeColors.textPrimary, marginBottom: 4 }]}>{day.date}</Text>
            {day.entries.map((e) => (
              <TouchableOpacity key={e.userId} onPress={() => openDay(day.date, e.userId, e.userName)}>
                <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm, marginTop: 2 }}>
                  - {e.userName} - {STATUS_LABEL[e.status]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'current' && styles.tabActive]}
          onPress={() => { setTab('current'); setSelectedMonth(null); loadCurrent(); }}
        >
          <Text style={[styles.tabText, tab === 'current' && styles.tabTextActive]}>Current</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'history' && styles.tabActive]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>History</Text>
        </TouchableOpacity>
      </View>

      {tab === 'history' && !selectedMonth && (
        <View style={{ gap: SPACING.sm }}>
          {pastMonths.map((m) => (
            <TouchableOpacity
              key={`${m.year}-${m.month}`}
              style={[styles.monthRow, { borderColor: themeColors.textSecondary }]}
              onPress={() => { setSelectedMonth(m); loadMonth(m.year, m.month); }}
            >
              <Text style={{ color: themeColors.textPrimary }}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {(tab === 'current' || (tab === 'history' && selectedMonth)) && (
        <>
          {tab === 'history' && selectedMonth && (
            <TouchableOpacity onPress={() => setSelectedMonth(null)} style={{ marginBottom: SPACING.md }}>
              <Text style={{ color: COLORS.primary }}>Back to months</Text>
            </TouchableOpacity>
          )}

          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />
          ) : (
            <>
              {renderSection('Not Complete', '#dc2626', notComplete)}
              {renderSection('Complete', '#d97706', complete)}
              {renderSection('Confirmed', '#16a34a', confirmed)}
              {days.length === 0 && (
                <Text style={{ color: themeColors.textSecondary }}>No days to review yet.</Text>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.lg },
  tab: { flex: 1, padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: FONTS.sm },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  monthRow: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1 },
  sectionLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.sm },
  dayCard: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1, marginBottom: SPACING.sm },
  dayTitle: { fontSize: FONTS.base, fontWeight: '600' },
});
