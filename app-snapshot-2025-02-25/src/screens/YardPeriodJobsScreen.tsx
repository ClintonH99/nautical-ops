/**
 * Yard Period Jobs Screen
 * List of yard period jobs with Create New Job button
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import yardJobsService from '../services/yardJobs';
import { YardPeriodJob, Department } from '../types';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
import { Button } from '../components';
import { getTaskUrgencyColor } from '../utils/taskUrgency';

export const YardPeriodJobsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [jobs, setJobs] = useState<YardPeriodJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>({
    BRIDGE: true,
    ENGINEERING: true,
    EXTERIOR: true,
    INTERIOR: true,
    GALLEY: true,
  });
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const selectDepartment = (dept: Department) => {
    setVisibleDepartments({
      BRIDGE: dept === 'BRIDGE',
      ENGINEERING: dept === 'ENGINEERING',
      EXTERIOR: dept === 'EXTERIOR',
      INTERIOR: dept === 'INTERIOR',
      GALLEY: dept === 'GALLEY',
    });
  };

  const selectAllDepartments = () => {
    setVisibleDepartments({
      BRIDGE: true,
      ENGINEERING: true,
      EXTERIOR: true,
      INTERIOR: true,
      GALLEY: true,
    });
  };

  const filteredJobs = jobs.filter((j) => visibleDepartments[j.department ?? 'INTERIOR']);
  const isHOD = user?.role === 'HOD';

  const loadJobs = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await yardJobsService.getByVessel(vesselId);
      setJobs(data);
    } catch (e) {
      console.error('Load yard jobs error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadJobs();
    }, [loadJobs])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadJobs();
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const onAdd = () => {
    navigation.navigate('AddEditYardJob', {});
  };

  const onEdit = (job: YardPeriodJob) => {
    if (!isHOD) return;
    navigation.navigate('AddEditYardJob', { jobId: job.id });
  };

  const onDelete = (job: YardPeriodJob) => {
    if (!isHOD) return;
    Alert.alert(
      'Delete job',
      `Delete "${job.jobTitle}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await yardJobsService.delete(job.id);
              loadJobs();
            } catch (e) {
              Alert.alert('Error', 'Could not delete job');
            }
          },
        },
      ]
    );
  };

  const onMarkComplete = (job: YardPeriodJob) => {
    if (job.status === 'COMPLETED') return;
    if (!user?.id || !user?.name) {
      Alert.alert('Error', 'Could not identify user');
      return;
    }
    yardJobsService
      .markComplete(job.id, user.id, user.name)
      .then(() => loadJobs())
      .catch(() => Alert.alert('Error', 'Could not update job'));
  };

  const getPriorityColor = (p?: string) => {
    if (p === 'RED') return COLORS.danger;
    if (p === 'YELLOW') return COLORS.warning;
    return COLORS.success;
  };

  const renderItem = ({ item }: { item: YardPeriodJob }) => {
    const borderColor = item.priority
      ? getPriorityColor(item.priority)
      : getTaskUrgencyColor(item.doneByDate, item.createdAt, item.status);
    const isComplete = item.status === 'COMPLETED';

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.surface, borderLeftColor: borderColor }]}
        onPress={() => onEdit(item)}
        activeOpacity={0.8}
        disabled={!isHOD}
      >
        <View style={styles.cardHeader}>
          <Text
            style={[styles.cardTitle, isComplete && styles.cardTitleComplete, { color: isComplete ? themeColors.textSecondary : themeColors.textPrimary }]}
            numberOfLines={1}
          >
            {item.jobTitle}
          </Text>
          {item.department && (
            <View
              style={[
                styles.deptBadge,
                { backgroundColor: getDepartmentColor(item.department, overrides) },
              ]}
            >
              <Text style={styles.deptBadgeText}>
                {item.department.charAt(0) + item.department.slice(1).toLowerCase()}
              </Text>
            </View>
          )}
          {isHOD && (
            <TouchableOpacity
              onPress={() => onDelete(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          )}
        </View>
        {item.yardLocation ? (
          <Text style={[styles.cardSubtext, { color: themeColors.textSecondary }]}>📍 {item.yardLocation}</Text>
        ) : null}
        {item.contractorCompanyName ? (
          <Text style={[styles.cardSubtext, { color: themeColors.textSecondary }]}>🏢 {item.contractorCompanyName}</Text>
        ) : null}
        {item.doneByDate && (
          <Text style={[styles.cardDate, { color: themeColors.textSecondary }]}>
            Done by: {formatDate(item.doneByDate)}
            {isComplete && ' ✓'}
          </Text>
        )}
        {isComplete && item.completedByName && (
          <Text style={[styles.completedBy, { color: themeColors.textSecondary }]}>Completed by: {item.completedByName}</Text>
        )}
        {item.jobDescription ? (
          <Text style={[styles.cardNotes, { color: themeColors.textSecondary }]} numberOfLines={2}>
            {item.jobDescription}
          </Text>
        ) : null}
        {!isComplete && (
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={() => onMarkComplete(item)}
          >
            <Text style={styles.completeBtnText}>Mark complete</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see yard period jobs.</Text>
      </View>
    );
  }

  const departmentDisplayText = DEPARTMENTS.every((d) => visibleDepartments[d])
    ? 'All departments'
    : DEPARTMENTS.filter((d) => visibleDepartments[d])
        .map((d) => d.charAt(0) + d.slice(1).toLowerCase())
        .join(', ');

  const CalendarHeader = () => (
    <>
      <TouchableOpacity
        style={[styles.calendarCard, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('TasksCalendar')}
        activeOpacity={0.8}
      >
        <Text style={styles.calendarCardIcon}>📅</Text>
        <View style={styles.calendarCardContent}>
        <Text style={[styles.calendarCardTitle, { color: themeColors.textPrimary }]}>Yard Period Calendar</Text>
        <Text style={[styles.calendarCardHint, { color: themeColors.textSecondary }]}>Calendar view with department & urgency filters</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.filterBar}>
        <View style={styles.filterBarContent}>
          <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
          <TouchableOpacity
            style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
            onPress={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
            activeOpacity={0.7}
          >
            <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>{departmentDisplayText}</Text>
            <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>{departmentDropdownOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {departmentDropdownOpen && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentDropdownOpen(false)}>
            <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <TouchableOpacity
                style={[
                  styles.modalItem,
                  DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemSelected,
                ]}
                onPress={() => {
                  selectAllDepartments();
                  setDepartmentDropdownOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.modalItemText,
                    { color: themeColors.textPrimary },
                    DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemTextAll,
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
              {DEPARTMENTS.map((dept) => (
                <TouchableOpacity
                  key={dept}
                  style={[
                    styles.modalItem,
                    visibleDepartments[dept] && styles.modalItemSelected,
                  ]}
                  onPress={() => {
                    selectDepartment(dept);
                    setDepartmentDropdownOpen(false);
                  }}
                >
                <Text
                  style={[
                    styles.modalItemText,
                    { color: themeColors.textPrimary },
                    visibleDepartments[dept] && styles.modalItemTextAll,
                  ]}
                >
                    {dept.charAt(0) + dept.slice(1).toLowerCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}
      {isHOD && (
        <View style={styles.addRow}>
          <Button
            title="Create New Job"
            onPress={onAdd}
            variant="primary"
            style={styles.addButton}
          />
        </View>
      )}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : jobs.length === 0 ? (
        <ScrollView
          style={[styles.container, { backgroundColor: themeColors.background }]}
          contentContainerStyle={styles.emptyWrapper}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
          }
        >
          <CalendarHeader />
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔧</Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No yard period jobs yet</Text>
            {isHOD && (
              <Button
                title="Create first job"
                onPress={onAdd}
                variant="primary"
                style={styles.emptyBtn}
              />
            )}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={filteredJobs}
          keyExtractor={(j) => j.id}
          renderItem={renderItem}
          ListHeaderComponent={<CalendarHeader />}
          ListEmptyComponent={
            jobs.length > 0 ? (
              <View style={styles.emptyFilter}>
                <Text style={[styles.emptyFilterText, { color: themeColors.textSecondary }]}>No jobs in selected departments</Text>
                <Text style={[styles.emptyFilterHint, { color: themeColors.textSecondary }]}>Tap the Department dropdown to choose</Text>
              </View>
            ) : null
          }
          contentContainerStyle={[styles.list, filteredJobs.length === 0 && jobs.length > 0 && styles.listFlex]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    textAlign: 'center',
  },
  calendarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  calendarCardIcon: {
    fontSize: 36,
    marginRight: SPACING.lg,
  },
  calendarCardContent: {
    flex: 1,
  },
  calendarCardTitle: {
    fontSize: FONTS.xl,
    fontWeight: '600',
  },
  calendarCardHint: {
    fontSize: FONTS.sm,
    marginTop: 2,
  },
  filterBar: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  filterBarContent: { flex: 1 },
  filterLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
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
  dropdownText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  dropdownChevron: {
    fontSize: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.sm,
    minWidth: 200,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight + '20',
  },
  modalItemText: {
    fontSize: FONTS.base,
  },
  modalItemTextAll: {
    fontWeight: '600',
  },
  addRow: {
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  addButton: {},
  emptyWrapper: {
    flexGrow: 1,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  loader: {
    marginTop: SPACING.xl,
  },
  list: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  listFlex: {
    flexGrow: 1,
  },
  emptyFilter: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  emptyFilterText: {
    fontSize: FONTS.base,
  },
  emptyFilterHint: {
    fontSize: FONTS.sm,
    marginTop: SPACING.xs,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  deptBadgeText: {
    fontSize: FONTS.xs,
    color: COLORS.white,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    flex: 1,
  },
  cardTitleComplete: {
    textDecorationLine: 'line-through',
  },
  deleteBtn: {
    fontSize: FONTS.sm,
    color: COLORS.danger,
  },
  cardSubtext: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
  },
  cardDate: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
  },
  completedBy: {
    fontSize: FONTS.sm,
    color: COLORS.success,
    marginTop: SPACING.xs,
  },
  cardNotes: {
    fontSize: FONTS.sm,
    color: COLORS.textTertiary,
  },
  completeBtn: {
    marginTop: SPACING.sm,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.primaryLight,
    borderRadius: BORDER_RADIUS.sm,
  },
  completeBtnText: {
    fontSize: FONTS.sm,
    color: COLORS.white,
    fontWeight: '600',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.lg,
    marginBottom: SPACING.lg,
  },
  emptyBtn: {},
});
