import { optimisticDelete } from '../utils/optimisticDelete';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Tasks List Screen - List tasks for a category (Daily, Weekly, Monthly)
 * Crew and HODs can add/edit/delete tasks.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import { VesselTask, TaskCategory, Department } from '../types';
import { toYYYYMMDD } from '../utils';
import { DepartmentSelector, LoadingSpinner, PageHeader, TaskPreviewCard } from '../components';

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

export const TasksListScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const category = (route.params?.category ?? 'DAILY') as TaskCategory;
  const categoryLabel = CATEGORY_LABELS[category];

  const [tasks, setTasks] = useScreenState<VesselTask[]>('tasks', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState<Department | ''>('');

  const vesselId = user?.vesselId ?? null;

  const filteredTasks = useMemo(() => {
    if (!departmentFilter) return tasks;
    return tasks.filter((t) => t.department === departmentFilter);
  }, [tasks, departmentFilter]);

  useEffect(() => {
    navigation.setOptions({ title: `${categoryLabel} Tasks` });
  }, [navigation, categoryLabel]);

  const loadTasks = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await vesselTasksService.getByVesselAndCategory(vesselId, category);
      setTasks(data);
    } catch (e) {
      console.error('Load tasks error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId, category, setTasks, setLoading]);

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
    navigation.navigate('AddEditTask', { category, taskId: task.id });
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
    const isComplete = item.status === 'COMPLETED';
    const isOverdue = !isComplete && !!item.doneByDate && item.doneByDate < toYYYYMMDD(new Date());
    const recurringLabel = item.recurring
      ? item.recurring === '7_DAYS'
        ? 'Every 7 days'
        : item.recurring === '14_DAYS'
          ? 'Every 14 days'
          : 'Every 30 days'
      : '';

    return (
      <TaskPreviewCard
        title={item.title ?? ''}
        department={item.department.charAt(0) + item.department.slice(1).toLowerCase()}
        dateValue={item.doneByDate ? formatDate(item.doneByDate) : undefined}
        dateIsOverdue={isOverdue}
        recurring={recurringLabel}
        notes={item.notes}
        completedByLine={
          isComplete && item.completedByName ? `Completed by ${item.completedByName}` : undefined
        }
        completed={isComplete}
        onEdit={() => onEdit(item)}
        onDelete={() => onDelete(item)}
        onPress={() => onEdit(item)}
        onMarkComplete={!isComplete ? () => onMarkComplete(item) : undefined}
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
      <PageHeader title={`${categoryLabel} Tasks`} />
      {loading ? (
        <LoadingSpinner />
      ) : tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No {categoryLabel.toLowerCase()} tasks yet
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
                {categoryLabel.toUpperCase()} TASKS
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
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyText: {
    fontSize: FONTS.lg,
    color: COLORS.textSecondary,
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
  sectionLabel: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: SPACING.md,
  },
});
