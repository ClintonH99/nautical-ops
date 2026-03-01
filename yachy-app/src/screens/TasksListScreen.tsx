/**
 * Tasks List Screen - List tasks for a category (Daily, Weekly, Monthly)
 * Crew and HODs can add/edit/delete tasks.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import { VesselTask, TaskCategory, Department } from '../types';
import { getTaskUrgencyColor } from '../utils/taskUrgency';
import { ButtonTagCard, ButtonTagRow } from '../components';

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

  const [tasks, setTasks] = useState<VesselTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState<Department | ''>('');
  const [departmentModalVisible, setDepartmentModalVisible] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const filteredTasks = useMemo(() => {
    if (!departmentFilter) return tasks;
    return tasks.filter((t) => t.department === departmentFilter);
  }, [tasks, departmentFilter]);

  const DEPARTMENT_OPTIONS: { value: Department | ''; label: string }[] = [
    { value: '', label: 'All Departments' },
    { value: 'BRIDGE', label: 'Bridge' },
    { value: 'ENGINEERING', label: 'Engineering' },
    { value: 'EXTERIOR', label: 'Exterior' },
    { value: 'INTERIOR', label: 'Interior' },
    { value: 'GALLEY', label: 'Galley' },
  ];

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
  }, [vesselId, category]);

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
    Alert.alert(
      'Delete task',
      `Delete "${task.title}"?`,
      [
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
      ]
    );
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
    const borderColor = getTaskUrgencyColor(
      item.doneByDate,
      item.createdAt,
      item.status
    );
    const isComplete = item.status === 'COMPLETED';
    const recurringLabel = item.recurring
      ? item.recurring === '7_DAYS' ? 'Every 7 days' : item.recurring === '14_DAYS' ? 'Every 14 days' : 'Every 30 days'
      : '';

    const dateVal = item.doneByDate
      ? `${formatDate(item.doneByDate)}${isComplete ? ' ✓' : ''}`
      : '';
    return (
      <ButtonTagCard
        headerTitle={item.title ?? ''}
        accentColor={borderColor}
        onEdit={() => onEdit(item)}
        onDelete={() => onDelete(item)}
        onPress={() => onEdit(item)}
        footer={isComplete && item.completedByName ? `Completed by ${item.completedByName}` : undefined}
      >
        {dateVal ? <ButtonTagRow label="Date" value={dateVal} /> : null}
        <ButtonTagRow label="Department" value={item.department.charAt(0) + item.department.slice(1).toLowerCase()} />
        <ButtonTagRow label="Recurring" value={recurringLabel} />
        <ButtonTagRow label="Notes" value={item.notes ?? ''} />
        {!isComplete && (
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={(e) => { e?.stopPropagation?.(); onMarkComplete(item); }}
          >
            <Text style={styles.completeBtnText}>Mark complete</Text>
          </TouchableOpacity>
        )}
      </ButtonTagCard>
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see tasks.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📋</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No {categoryLabel.toLowerCase()} tasks yet</Text>
        </View>
      ) : (
        <>
          <View style={styles.filterBar}>
            <View style={styles.filterBarContent}>
              <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
              <TouchableOpacity
                style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
                onPress={() => setDepartmentModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
                  {departmentFilter ? DEPARTMENT_OPTIONS.find((o) => o.value === departmentFilter)?.label ?? departmentFilter : 'All departments'}
                </Text>
                <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
                  {departmentModalVisible ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>
            </View>
            {departmentFilter ? (
              <TouchableOpacity onPress={() => setDepartmentFilter('')} style={styles.clearFilters}>
                <Text style={[styles.clearFiltersText, { color: themeColors.textPrimary }]}>Clear filter</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {departmentModalVisible && (
            <Modal visible transparent animationType="fade">
              <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentModalVisible(false)}>
                <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
                  <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>Filter by department</Text>
                  {DEPARTMENT_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value || 'all'}
                      style={[styles.modalItem, departmentFilter === opt.value && styles.modalItemSelected]}
                      onPress={() => {
                        setDepartmentFilter(opt.value);
                        setDepartmentModalVisible(false);
                      }}
                    >
                      <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Pressable>
            </Modal>
          )}
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
                <Text style={[styles.emptyFilterText, { color: themeColors.textSecondary }]}>No tasks match the current filter</Text>
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
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
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
});
