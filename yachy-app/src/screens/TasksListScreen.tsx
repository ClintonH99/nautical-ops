/**
 * Tasks List Screen - List tasks for a category (Daily, Weekly, Monthly)
 * HOD can add/edit/delete; crew can view
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
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import { VesselTask, TaskCategory, Department } from '../types';
import { getTaskUrgencyColor } from '../utils/taskUrgency';

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
  const isHOD = user?.role === 'HOD';

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
    if (!isHOD) return;
    navigation.navigate('AddEditTask', { category, taskId: task.id });
  };

  const onDelete = (task: VesselTask) => {
    if (!isHOD) return;
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

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.surface, borderLeftColor: borderColor }]}
        onPress={() => onEdit(item)}
        activeOpacity={0.8}
        disabled={!isHOD}
      >
        <View style={styles.cardHeader}>
          <Text
            style={[styles.cardTitle, isComplete && styles.cardTitleComplete]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {isHOD && (
            <TouchableOpacity
              onPress={() => onDelete(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.cardMeta}>
          <Text style={[styles.deptBadge, { color: themeColors.textSecondary }]}>{item.department.charAt(0) + item.department.slice(1).toLowerCase()}</Text>
          {item.doneByDate && (
            <Text style={styles.cardDate}>
              Done by: {formatDate(item.doneByDate)}
              {isComplete && ' ✓'}
            </Text>
          )}
          {item.recurring && (
            <Text style={styles.recurringBadge}>
              {item.recurring === '7_DAYS' ? 'Every 7 days' : item.recurring === '14_DAYS' ? 'Every 14 days' : 'Every 30 days'}
            </Text>
          )}
        </View>
        {isComplete && item.completedByName && (
          <Text style={styles.completedBy}>Completed by: {item.completedByName}</Text>
        )}
        {item.notes ? (
          <Text style={styles.cardNotes} numberOfLines={2}>
            {item.notes}
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
    fontSize: FONTS.xs,
    backgroundColor: COLORS.gray100,
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
