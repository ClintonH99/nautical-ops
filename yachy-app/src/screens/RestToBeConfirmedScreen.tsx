/**
 * Rest to be Confirmed Screen
 * Review queue for the Captain and department signers: shows every day
 * this month grouped into "Not Complete", "Complete", and "Confirmed".
 * A department filter narrows the crew shown - the Captain sees "All" by
 * default and can filter to one department, while a department-only
 * signer automatically sees just the department(s) they're assigned to.
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
  Pressable,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { DayReview, DayReviewEntry, Department, getMonthReview, getPastMonths } from '../services/restEntries';

const STATUS_LABEL: Record<string, string> = {
  missing: 'not complete',
  draft: 'not complete',
  pending_confirmation: 'complete - awaiting confirmation',
  confirmed: 'confirmed',
};

const DEPT_LABEL: Record<Department, string> = {
  BRIDGE: 'Bridge',
  ENGINEERING: 'Engineering',
  EXTERIOR: 'Exterior',
  INTERIOR: 'Interior',
  GALLEY: 'Galley',
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
  const route = useRoute<any>();
  const themeColors = useThemeColors();
  const { user } = useAuthStore();

  const managedDepartments: Department[] | 'ALL' = route.params?.managedDepartments ?? 'ALL';
  const filterOptions: Department[] =
    managedDepartments === 'ALL'
      ? ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY']
      : managedDepartments;
  const canSeeAll = managedDepartments === 'ALL';

  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number } | null>(null);
  const [selectedDept, setSelectedDept] = useState<Department | 'All'>(
    canSeeAll ? 'All' : filterOptions[0]
  );
  const [filterModalVisible, setFilterModalVisible] = useState(false);
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

  // Filter each day's entries down to the selected department, then drop
  // any day left with no entries at all (nobody in that department that day).
  const filteredDays: DayReview[] = days
    .map((day) => ({
      ...day,
      entries: day.entries.filter((e) => selectedDept === 'All' || e.department === selectedDept),
    }))
    .filter((day) => day.entries.length > 0);

  const notComplete = filteredDays.filter((d) => categorizeDay(d.entries) === 'not_complete');
  const complete = filteredDays.filter((d) => categorizeDay(d.entries) === 'complete');
  const confirmed = filteredDays.filter((d) => categorizeDay(d.entries) === 'confirmed');

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

      {(canSeeAll || filterOptions.length > 1) && (
        <View style={styles.filterBar}>
          <View style={styles.filterBarContent}>
            <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
            <TouchableOpacity
              style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
              onPress={() => setFilterModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
                {selectedDept === 'All' ? 'All Departments' : DEPT_LABEL[selectedDept]}
              </Text>
              <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
                {filterModalVisible ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {filterModalVisible && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setFilterModalVisible(false)}>
            <View
              style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
              onStartShouldSetResponder={() => true}
            >
              <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                Filter by department
              </Text>
              {canSeeAll && (
                <TouchableOpacity
                  style={[styles.modalItem, selectedDept === 'All' && styles.modalItemSelected]}
                  onPress={() => { setSelectedDept('All'); setFilterModalVisible(false); }}
                >
                  <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>All Departments</Text>
                </TouchableOpacity>
              )}
              {filterOptions.map((dept) => (
                <TouchableOpacity
                  key={dept}
                  style={[styles.modalItem, selectedDept === dept && styles.modalItemSelected]}
                  onPress={() => { setSelectedDept(dept); setFilterModalVisible(false); }}
                >
                  <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>{DEPT_LABEL[dept]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}

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
              {filteredDays.length === 0 && (
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
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  tab: { flex: 1, padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: FONTS.sm },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  filterBarContent: { flex: 1 },
  filterLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.sm },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    minWidth: 260,
    maxHeight: 400,
  },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemSelected: {
    backgroundColor: COLORS.gray200,
  },
  modalItemText: { fontSize: FONTS.base },
  monthRow: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1 },
  sectionLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.sm },
  dayCard: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1, marginBottom: SPACING.sm },
  dayTitle: { fontSize: FONTS.base, fontWeight: '600' },
});
