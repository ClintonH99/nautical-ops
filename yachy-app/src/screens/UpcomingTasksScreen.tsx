/**
 * Upcoming Tasks Screen
 * Tasks from Daily, Weekly, Monthly due in the next 3 days (not completed)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import { getTaskUrgencyColor } from '../utils/taskUrgency';
import { VesselTask, TaskCategory, Department } from '../types';
import {
  DepartmentSelector,
  LoadingSpinner,
  PageHeader,
  PreviewActionButtons,
} from '../components';

const UPCOMING_DAYS = 3;

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

export const UpcomingTasksScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [tasks, setTasks] = useState<VesselTask[]>([]);
  const [loading, setLoading] = useState(true);
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
      const data = await vesselTasksService.getUpcomingTasks(vesselId, UPCOMING_DAYS);
      setTasks(data);
    } catch (e) {
      console.error('Load upcoming tasks error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

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
            await vesselTasksService.delete(task.id);
            loadTasks();
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
    const borderColor = getTaskUrgencyColor(item.doneByDate, item.createdAt, item.status);
    const isComplete = item.status === 'COMPLETED';
    const categoryLabel = CATEGORY_LABELS[item.category];

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: themeColors.surface,
            borderColor: themeColors.border,
            borderLeftColor: borderColor,
          },
        ]}
        onPress={() => onEdit(item)}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <Text
            style={[
              styles.cardTitle,
              { color: isComplete ? themeColors.textMuted : themeColors.textPrimary },
              isComplete && styles.cardTitleComplete,
            ]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
        </View>
        <View style={styles.cardMeta}>
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
          <Text
            style={[
              styles.categoryBadge,
              { color: themeColors.accent, backgroundColor: themeColors.accentSoft },
            ]}
          >
            {categoryLabel}
          </Text>
          {item.doneByDate && (
            <Text style={[styles.cardDate, { color: themeColors.textSecondary }]}>
              Done by: {formatDate(item.doneByDate)}
              {isComplete && ' ✓'}
            </Text>
          )}
          {item.recurring && (
            <Text
              style={[
                styles.recurringBadge,
                { color: themeColors.accent, backgroundColor: themeColors.accentSoft },
              ]}
            >
              {item.recurring === '7_DAYS'
                ? 'Every 7 days'
                : item.recurring === '14_DAYS'
                  ? 'Every 14 days'
                  : 'Every 30 days'}
            </Text>
          )}
        </View>
        {isComplete && item.completedByName && (
          <Text style={styles.completedBy}>Completed by: {item.completedByName}</Text>
        )}
        {item.notes ? (
          <Text style={[styles.cardNotes, { color: themeColors.textMuted }]} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}
        {!isComplete && (
          <TouchableOpacity
            style={[styles.completeBtn, { backgroundColor: themeColors.controlSelected }]}
            onPress={() => onMarkComplete(item)}
          >
            <Text style={[styles.completeBtnText, { color: themeColors.textOnAccent }]}>
              Mark complete
            </Text>
          </TouchableOpacity>
        )}
        <PreviewActionButtons onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
      </TouchableOpacity>
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
      <PageHeader title="Upcoming Tasks" />
      {loading ? (
        <LoadingSpinner />
      ) : tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📋</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No tasks due in the next {UPCOMING_DAYS} days
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
  cardTitleComplete: {
    textDecorationLine: 'line-through',
    color: COLORS.textSecondary,
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
  categoryBadge: {
    fontSize: FONTS.xs,
    color: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  cardDate: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
  },
  recurringBadge: {
    fontSize: FONTS.xs,
    color: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
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
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});
