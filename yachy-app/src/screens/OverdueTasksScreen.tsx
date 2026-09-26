import { optimisticDelete } from '../utils/optimisticDelete';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Overdue Tasks Screen
 * Tasks with Done by Date that have passed and are not completed
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import { VesselTask, TaskCategory, Department } from '../types';
import { DepartmentSelector, LoadingSpinner, PageHeader, TaskPreviewCard } from '../components';

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

export const OverdueTasksScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [tasks, setTasks] = useScreenState<VesselTask[]>('tasks', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState<Department | ''>('');

  const vesselId = user?.vesselId ?? null;

  const filteredTasks = useMemo(() => {
    if (!departmentFilter) return tasks;
    return tasks.filter((t) => t.department === departmentFilter);
  }, [tasks, departmentFilter]);

  const loadTasks = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await vesselTasksService.getOverdueTasks(vesselId);
      setTasks(data);
    } catch (e) {
      console.error('Load overdue tasks error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setLoading, setTasks, vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [loadTasks])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadTasks();
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const onEdit = (task: VesselTask) => {
    navigation.navigate('AddEditTask', { category: task.category, taskId: task.id });
  };

  const onDelete = (task: VesselTask) => {
    Alert.alert('Delete task', `Delete "${task.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await optimisticDelete(task, setTasks, () => vesselTasksService.delete(task.id));
          } catch (e) {
            Alert.alert('Error', 'Could not delete task');
          }
        },
      },
    ]);
  };

  const onMarkComplete = (task: VesselTask) => {
    if (task.status === 'COMPLETED') return;
    if (!user?.id || !user?.name) {
      Alert.alert('Error', 'Could not identify user');
      return;
    }
    vesselTasksService
      .markComplete(task.id, user.id, user.name)
      .then(() => loadTasks())
      .catch(() => Alert.alert('Error', 'Could not update task'));
  };

  const renderItem = ({ item }: { item: VesselTask }) => {
    const recurringLabel = item.recurring
      ? item.recurring === '7_DAYS'
        ? 'Every 7 days'
        : item.recurring === '14_DAYS'
          ? 'Every 14 days'
          : 'Every 30 days'
      : undefined;

    return (
      <TaskPreviewCard
        title={item.title}
        department={item.department.charAt(0) + item.department.slice(1).toLowerCase()}
        category={CATEGORY_LABELS[item.category]}
        dateLabel="Was Due"
        dateValue={item.doneByDate ? formatDate(item.doneByDate) : undefined}
        dateIsOverdue
        recurring={recurringLabel}
        notes={item.notes}
        onPress={() => onEdit(item)}
        onEdit={() => onEdit(item)}
        onDelete={() => onDelete(item)}
        onMarkComplete={() => onMarkComplete(item)}
      />
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to see tasks.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Overdue Tasks" />
      {loading ? (
        <LoadingSpinner />
      ) : tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No overdue tasks
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.filterBar}>
            <View style={styles.filterBarContent}>
              <DepartmentSelector
                value={departmentFilter || null}
                onChange={(value) => setDepartmentFilter(value ?? '')}
                includeAll
                tightTop
              />
            </View>
            {departmentFilter ? (
              <TouchableOpacity onPress={() => setDepartmentFilter('')} style={styles.clearFilters}>
                <Text style={[styles.clearFiltersText, { color: themeColors.textPrimary }]}>
                  Clear filter
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <FlatList
            data={filteredTasks}
            keyExtractor={(t) => t.id}
            renderItem={renderItem}
            ListHeaderComponent={
              <Text style={[styles.sectionLabel, { color: themeColors.textSecondary }]}>
                OVERDUE TASKS
              </Text>
            }
            contentContainerStyle={[
              styles.list,
              filteredTasks.length === 0 && tasks.length > 0 && styles.listEmpty,
            ]}
            ListEmptyComponent={
              filteredTasks.length === 0 && tasks.length > 0 ? (
                <View style={styles.emptyFilter}>
                  <Text style={[styles.emptyFilterText, { color: themeColors.textSecondary }]}>
                    No tasks match the current filter
                  </Text>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[COLORS.primary]}
              />
            }
          />
        </>
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
  loader: {
    marginTop: SPACING.xl,
  },
  list: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  listEmpty: {
    flexGrow: 1,
  },
  filterBar: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
    gap: SPACING.xs,
  },
  filterBarContent: { width: '100%', alignSelf: 'stretch' },
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
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  clearFilters: {
    paddingVertical: SPACING.xs,
    alignSelf: 'flex-end',
  },
  clearFiltersText: {
    fontSize: FONTS.sm,
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
    padding: SPACING.md,
    minWidth: 260,
    maxHeight: 400,
  },
  modalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight,
  },
  modalItemText: {
    fontSize: FONTS.base,
  },
  emptyFilter: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  emptyFilterText: {
    fontSize: FONTS.base,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
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
    marginBottom: SPACING.xs,
  },
  cardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    flex: 1,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  cardDate: {
    fontSize: FONTS.sm,
    color: COLORS.danger,
  },
  categoryBadge: {
    fontSize: FONTS.xs,
    color: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
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
  emptyText: {
    fontSize: FONTS.lg,
  },
  sectionLabel: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: SPACING.md,
  },
});
