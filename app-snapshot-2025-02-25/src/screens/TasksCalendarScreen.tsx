/**
 * Tasks Calendar Screen
 * Calendar view of tasks by date, with department filters and urgency/priority dropdown
 * Similar to Upcoming Trips - department color-coded, Show/Hide filters
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import yardJobsService from '../services/yardJobs';
import { PieDayComponent } from '../components/PieDayComponent';
import { VesselTask, YardPeriodJob, Department } from '../types';
import { getTaskUrgencyColor, getUrgencyLevel, UrgencyLevel } from '../utils/taskUrgency';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

const URGENCY_OPTIONS: { value: UrgencyLevel | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All priorities' },
  { value: 'GREEN', label: 'Green (on track)' },
  { value: 'YELLOW', label: 'Yellow (attention soon)' },
  { value: 'RED', label: 'Red (urgent)' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'NONE', label: 'No deadline' },
];

type MarkedDates = {
  [date: string]: {
    marked?: boolean;
    selected?: boolean;
    selectedColor?: string;
    selectedTextColor?: string;
    segmentColors?: string[];
  };
};

const YARD_JOB_COLOR = COLORS.yardPeriodColor ?? '#0D9488';

function getMarkedDatesFromTasksAndJobs(
  tasks: VesselTask[],
  yardJobs: YardPeriodJob[],
  visibleDepartments: Record<Department, boolean>,
  getDeptColor: (dept: string) => string
): MarkedDates {
  const byDate: Record<string, string[]> = {};

  const addColor = (dateKey: string, color: string) => {
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(color); // One color per task/job (pie segments = task count)
  };

  tasks.forEach((task) => {
    if (!task.doneByDate) return;
    if (!visibleDepartments[task.department]) return;
    addColor(task.doneByDate, getDeptColor(task.department) ?? COLORS.primary);
  });

  yardJobs.forEach((job) => {
    if (!job.doneByDate) return;
    if (!visibleDepartments[job.department ?? 'INTERIOR']) return;
    const color = job.department
      ? getDeptColor(job.department)
      : YARD_JOB_COLOR;
    addColor(job.doneByDate, color);
  });

  const marked: MarkedDates = {};
  Object.entries(byDate).forEach(([date, colors]) => {
    marked[date] = {
      selected: true,
      selectedColor: colors[0],
      selectedTextColor: '#FFFFFF',
      segmentColors: colors,
    };
  });
  return marked;
}

export const TasksCalendarScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const getDeptColor = useCallback((dept: string) => getDepartmentColor(dept, overrides), [overrides]);
  const [tasks, setTasks] = useState<VesselTask[]>([]);
  const [yardJobs, setYardJobs] = useState<YardPeriodJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyLevel | 'ALL'>('ALL');
  const [urgencyDropdownOpen, setUrgencyDropdownOpen] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';

  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>({
    BRIDGE: true,
    ENGINEERING: true,
    EXTERIOR: true,
    INTERIOR: true,
    GALLEY: true,
  });

  const toggleDepartment = (dept: Department) => {
    setVisibleDepartments((prev) => ({ ...prev, [dept]: !prev[dept] }));
  };

  const loadTasks = useCallback(async () => {
    if (!vesselId) return;
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 4, 0);
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);
      const [taskData, jobData] = await Promise.all([
        vesselTasksService.getTasksInDateRange(vesselId, startStr, endStr),
        yardJobsService.getByVessel(vesselId),
      ]);
      setTasks(taskData);
      setYardJobs(jobData.filter((j) => j.doneByDate && j.doneByDate >= startStr && j.doneByDate <= endStr));
    } catch (e) {
      console.error('Load tasks calendar error:', e);
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

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => visibleDepartments[t.department]);
    if (urgencyFilter !== 'ALL') {
      result = result.filter((task) => {
        const level = getUrgencyLevel(
          task.doneByDate,
          task.createdAt,
          task.status
        );
        return level === urgencyFilter;
      });
    }
    return result;
  }, [tasks, visibleDepartments, urgencyFilter]);

  const filteredYardJobs = useMemo(
    () => yardJobs.filter((j) => visibleDepartments[j.department ?? 'INTERIOR']),
    [yardJobs, visibleDepartments]
  );

  const markedDates = useMemo(
    () => getMarkedDatesFromTasksAndJobs(filteredTasks, filteredYardJobs, visibleDepartments, getDeptColor),
    [filteredTasks, filteredYardJobs, visibleDepartments, getDeptColor]
  );

  const tasksForSelectedDate = useMemo((): { tasks: VesselTask[]; yardJobs: YardPeriodJob[] } => {
    if (!selectedDate) return { tasks: [], yardJobs: [] };
    const dayTasks = filteredTasks.filter((t) => t.doneByDate === selectedDate);
    const dayJobs = filteredYardJobs.filter((j) => j.doneByDate === selectedDate);
    return { tasks: dayTasks, yardJobs: dayJobs };
  }, [filteredTasks, filteredYardJobs, selectedDate]);

  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: themeColors.textSecondary,
    selectedDayBackgroundColor: COLORS.primary,
    selectedDayTextColor: COLORS.white,
    todayTextColor: COLORS.primary,
    dayTextColor: themeColors.textPrimary,
    textDisabledColor: COLORS.gray400,
    arrowColor: COLORS.primary,
    monthTextColor: COLORS.primary,
    textDayHeaderFontSize: FONTS.sm,
    textMonthFontSize: FONTS.lg,
    textDayFontSize: FONTS.base,
  };

  const onMonthChange = () => {
    // Tasks loaded for wide range (5 months) - no refetch needed
  };

  const onEdit = (task: VesselTask) => {
    if (!isHOD) return;
    navigation.navigate('AddEditTask', { category: task.category, taskId: task.id });
  };

  const onEditYardJob = (job: YardPeriodJob) => {
    if (!isHOD) return;
    navigation.navigate('AddEditYardJob', { jobId: job.id });
  };

  const getPriorityColor = (p: string) => {
    if (p === 'RED') return COLORS.danger;
    if (p === 'YELLOW') return COLORS.warning;
    return COLORS.success;
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

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see the tasks calendar.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
      }
    >
      <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Urgency / Priority</Text>
      <TouchableOpacity
        style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
        onPress={() => setUrgencyDropdownOpen(!urgencyDropdownOpen)}
        activeOpacity={0.7}
      >
        <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
          {URGENCY_OPTIONS.find((o) => o.value === urgencyFilter)?.label ?? 'All priorities'}
        </Text>
        <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>{urgencyDropdownOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {urgencyDropdownOpen && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setUrgencyDropdownOpen(false)}>
            <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              {URGENCY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.modalItem, urgencyFilter === opt.value && styles.modalItemSelected]}
                  onPress={() => {
                    setUrgencyFilter(opt.value);
                    setUrgencyDropdownOpen(false);
                  }}
                >
                  <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}

      <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Department filters</Text>
      <Text style={[styles.filterHint, { color: themeColors.textSecondary }]}>Tap to show/hide on calendar</Text>
      <View style={styles.deptChips}>
        {DEPARTMENTS.map((dept) => (
          <TouchableOpacity
            key={dept}
            style={[
              styles.deptChip,
              { borderColor: getDeptColor(dept) ?? COLORS.primary },
              !visibleDepartments[dept] && styles.deptChipHidden,
            ]}
            onPress={() => toggleDepartment(dept)}
          >
            <View style={[styles.deptDot, { backgroundColor: getDeptColor(dept) ?? COLORS.primary }]} />
            <Text style={[styles.deptChipText, { color: visibleDepartments[dept] ? themeColors.textPrimary : themeColors.textSecondary }, !visibleDepartments[dept] && styles.deptChipTextDim]}>
              {dept.charAt(0) + dept.slice(1).toLowerCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Yard Period Calendar</Text>
      <View style={[styles.calendarCard, { backgroundColor: themeColors.surface }]}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
        ) : (
          <>
            <Calendar
              current={new Date().toISOString().slice(0, 10)}
              dayComponent={PieDayComponent as React.ComponentType<any>}
              markedDates={
                {
                  ...markedDates,
                  ...(selectedDate && {
                    [selectedDate]: {
                      ...(markedDates[selectedDate] ?? {}),
                      selected: true,
                      selectedColor: COLORS.primary,
                      selectedTextColor: COLORS.white,
                      segmentColors: markedDates[selectedDate]?.segmentColors,
                    },
                  }),
                } as Record<string, object>
              }
              theme={calendarTheme}
              onDayPress={({ dateString }) => setSelectedDate(dateString)}
              onMonthChange={onMonthChange}
              hideExtraDays
            />
            <View style={styles.legend}>
              {DEPARTMENTS.filter((d) => visibleDepartments[d]).map((dept) => (
                <View key={dept} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: getDeptColor(dept) }]} />
                  <Text style={[styles.legendText, { color: themeColors.textPrimary }]}>{dept.charAt(0) + dept.slice(1).toLowerCase()}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {selectedDate && (
        <>
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Tasks & Jobs for {formatDate(selectedDate)}</Text>
          {tasksForSelectedDate.tasks.length === 0 && tasksForSelectedDate.yardJobs.length === 0 ? (
            <Text style={[styles.emptyDate, { color: themeColors.textSecondary }]}>No tasks or yard jobs due on this date</Text>
          ) : (
            <View style={styles.taskList}>
              {tasksForSelectedDate.tasks.map((task) => {
                const urgencyColor = getTaskUrgencyColor(
                  task.doneByDate,
                  task.createdAt,
                  task.status
                );
                const isComplete = task.status === 'COMPLETED';
                return (
                  <TouchableOpacity
                    key={`task-${task.id}`}
                    style={[styles.taskCard, { backgroundColor: themeColors.surface, borderLeftColor: urgencyColor }]}
                    onPress={() => onEdit(task)}
                    activeOpacity={0.8}
                    disabled={!isHOD}
                  >
                    <View style={styles.taskHeader}>
                      <Text
                        style={[styles.taskTitle, { color: themeColors.textPrimary }, isComplete && styles.taskTitleComplete]}
                        numberOfLines={1}
                      >
                        {task.title}
                      </Text>
                      <View style={[styles.deptBadge, { backgroundColor: getDeptColor(task.department) ?? COLORS.gray300 }]}>
                        <Text style={styles.deptBadgeText}>
                          {task.department.charAt(0) + task.department.slice(1).toLowerCase()}
                        </Text>
                      </View>
                    </View>
                    {task.notes ? (
                      <Text style={[styles.taskNotes, { color: themeColors.textSecondary }]} numberOfLines={2}>
                        {task.notes}
                      </Text>
                    ) : null}
                    {!isComplete && (
                      <TouchableOpacity
                        style={styles.completeBtn}
                        onPress={() => onMarkComplete(task)}
                      >
                        <Text style={styles.completeBtnText}>Mark complete</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
              {tasksForSelectedDate.yardJobs.map((job) => {
                const priorityColor = getPriorityColor(job.priority ?? 'GREEN');
                const isComplete = job.status === 'COMPLETED';
                const dept = job.department ?? 'INTERIOR';
                return (
                  <TouchableOpacity
                    key={`job-${job.id}`}
                    style={[styles.taskCard, { backgroundColor: themeColors.surface, borderLeftColor: priorityColor }]}
                    onPress={() => onEditYardJob(job)}
                    activeOpacity={0.8}
                    disabled={!isHOD}
                  >
                    <View style={styles.taskHeader}>
                      <Text
                        style={[styles.taskTitle, { color: themeColors.textPrimary }, isComplete && styles.taskTitleComplete]}
                        numberOfLines={1}
                      >
                        {job.jobTitle} {isComplete ? '✓' : ''}
                      </Text>
                      <View style={[styles.deptBadge, { backgroundColor: getDeptColor(dept) ?? COLORS.gray300 }]}>
                        <Text style={styles.deptBadgeText}>
                          {dept.charAt(0) + dept.slice(1).toLowerCase()} · Yard
                        </Text>
                      </View>
                    </View>
                    {job.jobDescription ? (
                      <Text style={[styles.taskNotes, { color: themeColors.textSecondary }]} numberOfLines={2}>
                        {job.jobDescription}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
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
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  filterHint: {
    fontSize: FONTS.xs,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  dropdownText: {
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
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
    padding: SPACING.md,
    minWidth: 260,
    maxHeight: 400,
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
  deptChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  deptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
  },
  deptChipHidden: {
    opacity: 0.5,
  },
  deptDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deptChipText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  deptChipTextDim: {
    color: COLORS.textTertiary,
  },
  calendarCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  loader: {
    padding: SPACING.xl,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
  },
  emptyDate: {
    fontSize: FONTS.base,
    fontStyle: 'italic',
  },
  taskList: {
    gap: SPACING.md,
  },
  taskCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    borderLeftWidth: 4,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  taskTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    color: COLORS.textPrimary,
    flex: 1,
  },
  taskTitleComplete: {
    textDecorationLine: 'line-through',
    color: COLORS.textSecondary,
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
  taskNotes: {
    fontSize: FONTS.sm,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
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
});
