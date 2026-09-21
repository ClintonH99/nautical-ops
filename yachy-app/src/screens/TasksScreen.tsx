/**
 * Tasks Screen - Hub: Upcoming Tasks (button), Overdue, then Daily/Weekly/Monthly categories
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { TaskCategory } from '../types';
import { Button, PageHeader } from '../components';
import vesselTasksService from '../services/vesselTasks';

const CLEANUP_STORAGE_KEY = 'yachy_tasks_last_cleanup_month';

type TaskAction = {
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  params?: { category: TaskCategory };
};

const TASK_ACTIONS = [
  {
    key: 'upcoming',
    label: 'Upcoming Tasks',
    hint: 'Due in the next 3 days',
    icon: 'calendar-outline',
    route: 'UpcomingTasks',
  },
  {
    key: 'overdue',
    label: 'Overdue Tasks',
    hint: 'Past the deadline',
    icon: 'alert-circle-outline',
    route: 'OverdueTasks',
  },
  {
    key: 'completed',
    label: 'Completed Tasks',
    hint: 'Finished tasks',
    icon: 'checkmark-circle-outline',
    route: 'CompletedTasks',
  },
  {
    key: 'daily',
    label: 'Daily',
    hint: 'View & create tasks',
    icon: 'calendar-clear-outline',
    route: 'TasksList',
    params: { category: 'DAILY' },
  },
  {
    key: 'weekly',
    label: 'Weekly',
    hint: 'View & create tasks',
    icon: 'calendar-outline',
    route: 'TasksList',
    params: { category: 'WEEKLY' },
  },
  {
    key: 'monthly',
    label: 'Monthly',
    hint: 'View & create tasks',
    icon: 'bar-chart-outline',
    route: 'TasksList',
    params: { category: 'MONTHLY' },
  },
] satisfies TaskAction[];

const TASKS_INFO = {
  title: 'Tasks',
  description: 'Create, assign, and track tasks across the vessel.',
  features: [
    'Create tasks with due dates and departments',
    'View upcoming, overdue, and completed tasks',
    'Switch between list and calendar views',
    'Mark tasks complete as work gets done',
  ],
};

export const TasksScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;

  useEffect(() => {
    const runMonthlyCleanup = async () => {
      if (!vesselId) return;
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      try {
        const lastCleanup = await AsyncStorage.getItem(CLEANUP_STORAGE_KEY);
        if (lastCleanup === currentMonth) return;
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        await vesselTasksService.deleteCompletedTasksBefore(vesselId, firstDay);
        await AsyncStorage.setItem(CLEANUP_STORAGE_KEY, currentMonth);
      } catch (e) {
        console.error('Monthly cleanup error:', e);
      }
    };
    runMonthlyCleanup();
  }, [vesselId]);

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
    <View style={styles.pageWrap}>
      <PageHeader title="Tasks" info={TASKS_INFO} infoScreenKey="tasks" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Button
          title="Create Task"
          onPress={() => navigation.navigate('AddEditTask', {})}
          variant="primary"
          fullWidth
          style={styles.createButton}
        />
        <Text style={[styles.sectionLabel, { color: themeColors.textSecondary }]}>View Tasks</Text>
        <View style={styles.cardGrid}>
          {TASK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.key}
              style={[
                styles.card,
                { backgroundColor: themeColors.surface, borderColor: themeColors.border },
              ]}
              onPress={() => navigation.navigate(action.route, action.params)}
              activeOpacity={0.8}
            >
              <View style={[styles.cardIcon, { backgroundColor: themeColors.accentSoft }]}>
                <Ionicons name={action.icon} size={26} color={themeColors.accent} />
              </View>
              <View style={styles.cardLabelWrap}>
                <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>
                  {action.label}
                </Text>
                <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>
                  {action.hint}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
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
  createButton: {
    marginBottom: SPACING.xl,
    height: 56,
    borderRadius: BORDER_RADIUS.lg,
  },
  sectionLabel: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.md,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  card: {
    width: '47.5%',
    minHeight: 164,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    justifyContent: 'space-between',
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: FONTS.base,
    fontWeight: '700',
    lineHeight: 21,
  },
  cardLabelWrap: {
    gap: SPACING.xs,
  },
  cardHint: {
    fontSize: FONTS.sm,
    lineHeight: 19,
  },
});
