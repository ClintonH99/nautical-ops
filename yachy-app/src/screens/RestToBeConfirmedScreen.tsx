/**
 * Rest to be Confirmed Screen
 * Captain-only review queue: shows every day this month grouped into
 * "Not Complete", "Complete", and "Confirmed". A department filter lets
 * the Captain narrow the crew shown to one department at a time,
 * defaulting to All. A single "Export to PDF" button opens a
 * multi-select list (with Select All) to export the currently viewed
 * month for any number of crew.
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
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader, ExportButton, LabeledDropdown } from '../components';
import { DayReview, DayReviewEntry, Department, getMonthReview, getPastMonths, getMonthDataForPdf } from '../services/restEntries';
import { generateHoursOfRestPdf } from '../utils/hoursOfRestPdf';
import { canAccessVesselManagement } from '../utils/access';

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
  const themeColors = useThemeColors();
  const { user } = useAuthStore();

  const filterOptions: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number } | null>(null);
  const [selectedDept, setSelectedDept] = useState<Department | 'All'>('All');
  const [days, setDays] = useState<DayReview[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

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
      if (!canAccessVesselManagement(user)) {
        navigation.goBack();
        return;
      }
      if (tab === 'current') loadCurrent();
    }, [user, navigation, tab, loadCurrent])
  );

  const filteredDays: DayReview[] = days
    .map((day) => ({
      ...day,
      entries: day.entries.filter((e) => selectedDept === 'All' || e.department === selectedDept),
    }))
    .filter((day) => day.entries.length > 0);

  const notComplete = filteredDays.filter((d) => categorizeDay(d.entries) === 'not_complete');
  const complete = filteredDays.filter((d) => categorizeDay(d.entries) === 'complete');
  const confirmed = filteredDays.filter((d) => categorizeDay(d.entries) === 'confirmed');

  // Unique crew members currently visible (after department filter), for the export list
  const uniqueCrew = Array.from(
    new Map(filteredDays.flatMap((d) => d.entries).map((e) => [e.userId, e.userName])).entries()
  ).map(([userId, userName]) => ({ userId, userName }));

  const openDay = (date: string, userId: string, userName: string) => {
    navigation.navigate('RestDayEntry', {
      date,
      targetUserId: userId,
      targetUserName: userName,
      isManagerEditing: true,
    });
  };

  const toggleExportSelection = (userId: string) => {
    setSelectedExportIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedExportIds.size === uniqueCrew.length) {
      setSelectedExportIds(new Set());
    } else {
      setSelectedExportIds(new Set(uniqueCrew.map((c) => c.userId)));
    }
  };

  const handleExportSelected = async () => {
    if (selectedExportIds.size === 0) return;
    setExporting(true);
    try {
      const now = new Date();
      const { year, month } = tab === 'history' && selectedMonth
        ? selectedMonth
        : { year: now.getFullYear(), month: now.getMonth() + 1 };

      for (const userId of selectedExportIds) {
        const crewMember = uniqueCrew.find((c) => c.userId === userId);
        const data = await getMonthDataForPdf(userId, year, month);
        if (!data || data.days.length === 0) continue;
        const filename = `HoursOfRest_${(crewMember?.userName ?? 'crew').replace(/\s+/g, '_')}_${year}-${String(month).padStart(2, '0')}.pdf`;
        await generateHoursOfRestPdf(data, filename);
      }
      setExportModalVisible(false);
      setSelectedExportIds(new Set());
    } catch (e) {
      console.error('Bulk export error:', e);
      Alert.alert('Error', 'Could not export one or more PDFs.');
    } finally {
      setExporting(false);
    }
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
    <View style={styles.pageWrap}>
      <PageHeader
        title="Rest to be Confirmed"
        actions={
          uniqueCrew.length > 0 ? (
            <ExportButton
              active={false}
              busy={exporting}
              onPress={() => {
                setSelectedExportIds(new Set());
                setExportModalVisible(true);
              }}
            />
          ) : undefined
        }
      />
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

        <View style={styles.filterBar}>
          <View style={styles.filterBarContent}>
            <LabeledDropdown
              label="Department"
              value={selectedDept === 'All' ? 'All Departments' : DEPT_LABEL[selectedDept]}
              open={filterModalVisible}
              onPress={() => setFilterModalVisible(true)}
            />
          </View>
        </View>

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
                <TouchableOpacity
                  style={[styles.modalItem, selectedDept === 'All' && styles.modalItemSelected]}
                  onPress={() => { setSelectedDept('All'); setFilterModalVisible(false); }}
                >
                  <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>All Departments</Text>
                </TouchableOpacity>
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

        {exportModalVisible && (
          <Modal visible transparent animationType="fade">
            <Pressable style={styles.modalBackdrop} onPress={() => !exporting && setExportModalVisible(false)}>
              <View
                style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                  Select crew to export
                </Text>

                <TouchableOpacity style={styles.modalItem} onPress={toggleSelectAll}>
                  <Text style={[styles.modalItemText, { color: COLORS.primary, fontWeight: '600' }]}>
                    {selectedExportIds.size === uniqueCrew.length ? 'Deselect all' : 'Select all'}
                  </Text>
                </TouchableOpacity>

                {uniqueCrew.map((c) => (
                  <TouchableOpacity
                    key={c.userId}
                    style={[styles.modalItem, selectedExportIds.has(c.userId) && styles.modalItemSelected]}
                    onPress={() => toggleExportSelection(c.userId)}
                  >
                    <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                      {selectedExportIds.has(c.userId) ? '\u2713 ' : ''}{c.userName}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  style={[styles.reviewButton, { marginTop: SPACING.md, opacity: exporting || selectedExportIds.size === 0 ? 0.6 : 1 }]}
                  onPress={handleExportSelected}
                  disabled={exporting || selectedExportIds.size === 0}
                >
                  <Text style={styles.reviewButtonText}>
                    {exporting ? 'Exporting...' : `Export (${selectedExportIds.size})`}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
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
    maxHeight: 500,
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
  reviewButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginBottom: SPACING.lg },
  reviewButtonText: { color: '#fff', fontWeight: '600' },
});
