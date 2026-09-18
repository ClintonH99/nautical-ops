/**
 * Completed Tasks Screen
 * Tasks that have been marked as completed
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import vesselTasksService from '../services/vesselTasks';
import { VesselTask, TaskCategory, Department } from '../types';
import { Button, DepartmentSelector, LoadingSpinner, PageHeader } from '../components';

const CLEANUP_STORAGE_KEY = 'yachy_tasks_last_cleanup_month';

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

export const CompletedTasksScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [tasks, setTasks] = useState<VesselTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState<Department | ''>('');

  const vesselId = user?.vesselId ?? null;
  const canUnmarkComplete = user?.role === 'CAPTAIN_MOV' || user?.role === 'HOD';

  const filteredTasks = useMemo(() => {
    if (!departmentFilter) return tasks;
    return tasks.filter((t) => t.department === departmentFilter);
  }, [tasks, departmentFilter]);

  const loadTasks = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await vesselTasksService.getCompletedTasks(vesselId);
      setTasks(data);
    } catch (e) {
      console.error('Load completed tasks error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      const runMonthlyCleanup = async () => {
        if (!vesselId) return;
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        try {
          const lastCleanup = await AsyncStorage.getItem(CLEANUP_STORAGE_KEY);
          if (lastCleanup === currentMonth) return;
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString()
            .slice(0, 10);
          await vesselTasksService.deleteCompletedTasksBefore(vesselId, firstDay);
          await AsyncStorage.setItem(CLEANUP_STORAGE_KEY, currentMonth);
        } catch (e) {
          console.error('Monthly cleanup error:', e);
        }
      };
      runMonthlyCleanup().then(() => loadTasks());
    }, [vesselId, loadTasks])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadTasks();
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const formatDateTime = (d: string) =>
    new Date(d).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

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

  const onUnmarkComplete = (task: VesselTask) => {
    Alert.alert(
      'Return to active tasks?',
      `“${task.title}” will leave Completed Tasks and return to its active task list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmark Complete',
          onPress: async () => {
            try {
              await vesselTasksService.unmarkComplete(task.id);
              await loadTasks();
            } catch (error: any) {
              Alert.alert('Could not return task', error?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: VesselTask }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: themeColors.surface }]}
      onPress={() => onEdit(item)}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <TouchableOpacity
          onPress={() => onDelete(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
        </TouchableOpacity>
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
        <Text style={[styles.categoryBadge, { color: themeColors.textSecondary }]}>
          {CATEGORY_LABELS[item.category]}
        </Text>
      </View>
      {item.completedByName && item.completedAt && (
        <Text style={[styles.completedBy, { color: themeColors.textSecondary }]}>
          Completed by {item.completedByName} on {formatDateTime(item.completedAt)}
        </Text>
      )}
      {item.notes ? (
        <Text style={styles.cardNotes} numberOfLines={2}>
          {item.notes}
        </Text>
      ) : null}
      {canUnmarkComplete ? (
        <Button
          title="Unmark Complete"
          variant="outline"
          size="small"
          fullWidth
          onPress={() => onUnmarkComplete(item)}
          style={styles.unmarkButton}
        />
      ) : null}
    </TouchableOpacity>
  );

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
      <PageHeader title="Completed Tasks" />
      {loading ? (
        <LoadingSpinner />
      ) : tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>✓</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No completed tasks yet
          </Text>
          <Text style={[styles.hintTextEmpty, { color: themeColors.textSecondary }]}>
            Completed tasks will refresh at the beginning of each month.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.hintBar}>
            <Text style={[styles.hintText, { color: themeColors.textSecondary }]}>
              Completed tasks will refresh at the beginning of each month.
            </Text>
          </View>
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
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  loader: {
    marginTop: SPACING.xl,
  },
  hintBar: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  hintText: { fontSize: FONTS.sm, fontStyle: 'italic' },
  hintTextEmpty: {
    fontSize: FONTS.sm,
    fontStyle: 'italic',
    marginTop: SPACING.md,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
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
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight,
  },
  modalItemText: { fontSize: FONTS.base },
  emptyFilter: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  emptyFilterText: { fontSize: FONTS.base },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
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
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  deleteBtn: {
    fontSize: FONTS.sm,
    color: COLORS.danger,
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
    backgroundColor: COLORS.gray100,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  completedBy: { fontSize: FONTS.sm, marginBottom: SPACING.xs },
  cardNotes: {
    fontSize: FONTS.sm,
    color: COLORS.textTertiary,
  },
  unmarkButton: { marginTop: SPACING.sm },
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
  emptyText: { fontSize: FONTS.lg },
});
