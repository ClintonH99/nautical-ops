/**
 * Tasks Screen - Hub: Upcoming Tasks (button), Overdue, then Daily/Weekly/Monthly categories
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { TaskCategory } from '../types';
import { Button } from '../components';
import vesselTasksService from '../services/vesselTasks';

const CLEANUP_STORAGE_KEY = 'yachy_tasks_last_cleanup_month';

const CATEGORIES: { key: TaskCategory; label: string; icon: string }[] = [
  { key: 'DAILY', label: 'Daily', icon: '📅' },
  { key: 'WEEKLY', label: 'Weekly', icon: '📆' },
  { key: 'MONTHLY', label: 'Monthly', icon: '🗓️' },
];

export const TasksScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';

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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see tasks.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
        Choose a category to view and manage tasks
      </Text>
      {isHOD && (
        <Button
          title="Create Task"
          onPress={() => navigation.navigate('AddEditTask', {})}
          variant="primary"
          fullWidth
          style={styles.createButton}
        />
      )}

      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('UpcomingTasks')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardIcon}>📋</Text>
        <View style={styles.cardLabelWrap}>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>Upcoming Tasks</Text>
          <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>Tasks due in the next 3 days</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.card, styles.overdueCard, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('OverdueTasks')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardIcon}>⚠️</Text>
        <View style={styles.cardLabelWrap}>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>Overdue Tasks</Text>
          <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>Tasks past their deadline</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('CompletedTasks')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardIcon}>✓</Text>
        <View style={styles.cardLabelWrap}>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>Completed Tasks</Text>
          <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>Tasks you've finished</Text>
        </View>
      </TouchableOpacity>
      {CATEGORIES.map((cat) => (
        <TouchableOpacity
          key={cat.key}
          style={[styles.card, { backgroundColor: themeColors.surface }]}
          onPress={() => navigation.navigate('TasksList', { category: cat.key })}
          activeOpacity={0.8}
        >
          <Text style={styles.cardIcon}>{cat.icon}</Text>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>{cat.label}</Text>
          <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>View & create tasks</Text>
        </TouchableOpacity>
      ))}
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
  subtitle: {
    fontSize: FONTS.base,
    marginBottom: SPACING.lg,
  },
  createButton: {
    marginBottom: SPACING.xl,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardIcon: {
    fontSize: 36,
    marginRight: SPACING.lg,
  },
  cardLabel: {
    flex: 1,
    fontSize: FONTS.xl,
    fontWeight: '600',
  },
  cardLabelWrap: {
    flex: 1,
  },
  cardHint: {
    fontSize: FONTS.sm,
  },
  overdueCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.danger,
  },
});
