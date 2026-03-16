/**
 * Add / Edit Task Screen
 * Task Title, Task Notes, Done by Date (optional). Crew and HODs can create and edit.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import { TaskCategory, TaskRecurring, Department } from '../types';
import { Input, Button, LoadingSpinner } from '../components';

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

const RECURRING_OPTIONS: { value: TaskRecurring; label: string }[] = [
  { value: '7_DAYS', label: '7 Days' },
  { value: '14_DAYS', label: '14 Days' },
  { value: '30_DAYS', label: '30 Days' },
];

export const AddEditTaskScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const categoryFromRoute = route.params?.category as TaskCategory | undefined;
  const taskId = route.params?.taskId as string | undefined;
  const showCategoryPicker = categoryFromRoute === undefined;

  const [category, setCategory] = useState<TaskCategory>(categoryFromRoute ?? 'DAILY');
  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [doneByDate, setDoneByDate] = useState<string | null>(null);
  const [recurring, setRecurring] = useState<TaskRecurring>(null);
  const [recurringExpanded, setRecurringExpanded] = useState(false);
  const [loading, setLoading] = useState(!!taskId);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isEdit = !!taskId;
  const categoryLabel = CATEGORY_LABELS[category];

  useEffect(() => {
    if (categoryFromRoute) setCategory(categoryFromRoute);
  }, [categoryFromRoute]);

  useEffect(() => {
    navigation.setOptions({
      title: taskId
        ? `Edit ${categoryLabel} Task`
        : showCategoryPicker
          ? 'Create Task'
          : `Create ${categoryLabel} Task`,
    });
  }, [navigation, taskId, categoryLabel, showCategoryPicker]);

  useEffect(() => {
    if (!taskId) return;
    (async () => {
      try {
        const task = await vesselTasksService.getById(taskId);
        if (task) {
          setTitle(task.title);
          setNotes(task.notes ?? '');
          setDoneByDate(task.doneByDate ?? null);
          setCategory(task.category);
          setDepartment(task.department ?? user?.department ?? 'INTERIOR');
          setRecurring(task.recurring ?? null);
        }
      } catch (e) {
        console.error('Load task error:', e);
        Alert.alert('Error', 'Could not load task');
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId]);

  const markedDates: Record<string, { selected?: boolean; selectedColor?: string }> = doneByDate
    ? { [doneByDate]: { selected: true, selectedColor: COLORS.primary } }
    : {};

  const calendarTextColor = themeColors.isDark ? COLORS.white : COLORS.black;
  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: calendarTextColor,
    selectedDayBackgroundColor: COLORS.primary,
    selectedDayTextColor: COLORS.white,
    todayTextColor: calendarTextColor,
    dayTextColor: calendarTextColor,
    textDisabledColor: calendarTextColor,
    arrowColor: calendarTextColor,
    monthTextColor: calendarTextColor,
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }
    if (!vesselId) {
      Alert.alert('Error', 'You must be in a vessel to create tasks.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await vesselTasksService.update(taskId, {
          title: trimmed,
          notes: notes.trim() || undefined,
          department,
          doneByDate: doneByDate || null,
          recurring: recurring || undefined,
        });
        Alert.alert('Updated', 'Task updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await vesselTasksService.create({
          vesselId,
          category,
          department,
          title: trimmed,
          notes: notes.trim() || undefined,
          doneByDate: doneByDate || null,
          recurring: recurring || undefined,
        });
        Alert.alert('Created', 'Task added.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e) {
      console.error('Save task error:', e);
      Alert.alert('Error', 'Could not save task.');
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text
          style={[
            styles.message,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Join a vessel to add tasks.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Department</Text>
        <Text style={[styles.hint, { color: themeColors.textSecondary }]}>
          Tasks are scoped by department. Crew will filter by their department to see only relevant
          tasks.
        </Text>
        <TouchableOpacity
          style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
          onPress={() => setDepartmentDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
            {department.charAt(0) + department.slice(1).toLowerCase()}
          </Text>
          <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>▼</Text>
        </TouchableOpacity>
        {departmentDropdownOpen && (
          <Modal visible transparent animationType="fade">
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setDepartmentDropdownOpen(false)}
            >
              <View
                style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
                onStartShouldSetResponder={() => true}
              >
                {(['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'] as Department[]).map(
                  (dept) => (
                    <TouchableOpacity
                      key={dept}
                      style={[styles.modalItem, department === dept && styles.modalItemSelected]}
                      onPress={() => {
                        setDepartment(dept);
                        setDepartmentDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalItemText,
                          { color: themeColors.textPrimary },
                          department === dept && styles.modalItemTextSelected,
                        ]}
                      >
                        {dept.charAt(0) + dept.slice(1).toLowerCase()}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </Pressable>
          </Modal>
        )}
        {showCategoryPicker && (
          <>
            <Text style={[styles.label, { color: themeColors.textPrimary }]}>Task category</Text>
            <View style={styles.categoryRow}>
              {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryChip,
                    { backgroundColor: category === cat ? undefined : themeColors.surface },
                    category === cat && styles.categoryChipSelected,
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      { color: category === cat ? COLORS.white : themeColors.textPrimary },
                      category === cat && styles.categoryChipTextSelected,
                    ]}
                  >
                    {CATEGORY_LABELS[cat]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <Input
          label="Task title"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Check engine oil"
          autoCapitalize="words"
        />
        <Input
          label="Task notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Additional details..."
          multiline
          numberOfLines={3}
        />
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Recurring (optional)</Text>
        <TouchableOpacity
          style={[styles.recurringToggle, { backgroundColor: themeColors.surfaceAlt }]}
          onPress={() => setRecurringExpanded(!recurringExpanded)}
        >
          <Text style={[styles.recurringToggleText, { color: themeColors.textPrimary }]}>
            {recurring
              ? (RECURRING_OPTIONS.find((o) => o.value === recurring)?.label ?? 'Selected')
              : 'Off'}
          </Text>
          <Text
            style={[
              styles.recurringChevron,
              { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
            ]}
          >
            {recurringExpanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>
        {recurringExpanded && (
          <View style={styles.recurringOptions}>
            <TouchableOpacity
              style={[
                styles.recurringOption,
                styles.recurringOptionBorder,
                !recurring && styles.recurringOptionSelected,
              ]}
              onPress={() => {
                setRecurring(null);
                setRecurringExpanded(false);
              }}
            >
              <Text style={[styles.recurringOptionText, { color: themeColors.textPrimary }]}>
                Off
              </Text>
            </TouchableOpacity>
            {RECURRING_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.recurringOption,
                  i < RECURRING_OPTIONS.length - 1 && styles.recurringOptionBorder,
                  recurring === opt.value && styles.recurringOptionSelected,
                ]}
                onPress={() => {
                  setRecurring(opt.value);
                  setRecurringExpanded(false);
                }}
              >
                <Text style={[styles.recurringOptionText, { color: themeColors.textPrimary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>
          Done by date (optional)
        </Text>
        <Text
          style={[
            styles.hint,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Tasks with a deadline change color as time passes (green → yellow → red).
        </Text>
        <View style={[styles.calendarWrap, { backgroundColor: themeColors.surface }]}>
          <Calendar
            current={doneByDate || new Date().toISOString().slice(0, 10)}
            minDate={new Date().toISOString().slice(0, 10)}
            markedDates={markedDates}
            onDayPress={({ dateString }) =>
              setDoneByDate(doneByDate === dateString ? null : dateString)
            }
            theme={calendarTheme}
            hideExtraDays
            hideArrows={false}
          />
        </View>
        {doneByDate && (
          <TouchableOpacity style={styles.clearDate} onPress={() => setDoneByDate(null)}>
            <Text style={styles.clearDateText}>Clear deadline</Text>
          </TouchableOpacity>
        )}
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Update task' : 'Create task'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => navigation.goBack()}
            disabled={saving}
          >
            <Text
              style={[
                styles.cancelText,
                { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
              ]}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
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
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  hint: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.sm,
  },
  calendarWrap: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  clearDate: {
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  clearDateText: {
    fontSize: FONTS.sm,
    color: COLORS.danger,
  },
  actions: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  cancelBtn: {
    alignSelf: 'center',
    padding: SPACING.sm,
  },
  cancelText: {
    fontSize: FONTS.base,
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
    marginBottom: SPACING.lg,
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
    padding: SPACING.xl,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 320,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight + '22',
  },
  modalItemText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  modalItemTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.gray100,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  categoryChipSelected: {
    backgroundColor: COLORS.primary,
  },
  categoryChipText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  categoryChipTextSelected: {
    color: COLORS.white,
  },
  recurringToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  recurringToggleText: {
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
  },
  recurringChevron: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  recurringOptions: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
  },
  recurringOption: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  recurringOptionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  recurringOptionSelected: {
    backgroundColor: COLORS.primaryLight,
  },
  recurringOptionText: {
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
  },
});
