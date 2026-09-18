import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { formatLocalDateString } from '../utils';
import {
  clampDateOnly,
  dateOnlyToString,
  daysInMonth,
  doesMonthOverlapBounds,
  getMonthDayGrid,
  getPickerYearRow,
  getPickerYears,
  isDateWithinBounds,
  localToday,
  parseDateOnly,
} from '../utils/dateOnlyPicker';

type PickerStep = 'year' | 'month' | 'day';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const YEAR_COLUMN_COUNT = 3;
const YEAR_ROW_HEIGHT = 46 + SPACING.sm;

export interface DateOnlyPickerProps {
  label: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  title?: string;
  placeholder?: string;
  minimumDate?: string;
  maximumDate?: string;
  onClear?: () => void;
  disabled?: boolean;
}

export const DateOnlyPicker = ({
  label,
  value,
  onChange,
  title,
  placeholder = 'Select date',
  minimumDate,
  maximumDate,
  onClear,
  disabled = false,
}: DateOnlyPickerProps) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<PickerStep>('year');
  const [draft, setDraft] = useState(() => localToday());
  const yearScrollRef = useRef<ScrollView>(null);

  const open = () => {
    const base = parseDateOnly(value) ? value! : localToday();
    setDraft(clampDateOnly(base, minimumDate, maximumDate));
    setStep('year');
    setVisible(true);
  };

  const parts = parseDateOnly(draft)!;
  const years = useMemo(
    () => getPickerYears(parts.year, minimumDate, maximumDate),
    [parts.year, minimumDate, maximumDate]
  );
  const selectedYearOffset =
    getPickerYearRow(years, parts.year, YEAR_COLUMN_COUNT) * YEAR_ROW_HEIGHT;

  // A parent can change bounds or an existing value while this picker is open.
  useEffect(() => {
    if (visible) setDraft((current) => clampDateOnly(current, minimumDate, maximumDate));
  }, [visible, minimumDate, maximumDate]);

  useEffect(() => {
    if (!visible || step !== 'year') return;
    const frame = requestAnimationFrame(() => {
      yearScrollRef.current?.scrollTo({ y: selectedYearOffset, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedYearOffset, step, visible]);

  const updateParts = (nextYear: number, nextMonth: number, nextDay: number) => {
    const day = Math.min(nextDay, daysInMonth(nextYear, nextMonth));
    setDraft(
      clampDateOnly(
        dateOnlyToString({ year: nextYear, month: nextMonth, day }),
        minimumDate,
        maximumDate
      )
    );
  };

  const selectYear = (year: number) => {
    updateParts(year, parts.month, parts.day);
    setStep('month');
  };
  const selectMonth = (month: number) => {
    updateParts(parts.year, month, parts.day);
    setStep('day');
  };
  const selectDay = (day: number) => {
    const next = dateOnlyToString({ year: parts.year, month: parts.month, day });
    if (isDateWithinBounds(next, minimumDate, maximumDate)) setDraft(next);
  };
  const changeMonth = (offset: number) => {
    const next = new Date(parts.year, parts.month - 1 + offset, 1);
    const nextYear = next.getFullYear();
    const nextMonth = next.getMonth() + 1;
    if (!doesMonthOverlapBounds(nextYear, nextMonth, minimumDate, maximumDate)) return;
    updateParts(nextYear, nextMonth, parts.day);
  };

  const hasValue = Boolean(parseDateOnly(value));
  const displayValue = hasValue ? formatLocalDateString(value!) : placeholder;
  const pickerTitle = title ?? `Select ${label.toLowerCase()}`;
  const dayGrid = getMonthDayGrid(parts.year, parts.month);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: themeColors.textPrimary }]}>{label}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${displayValue}`}
        accessibilityHint="Opens a year, month and day selector"
        disabled={disabled}
        onPress={open}
        activeOpacity={0.7}
        style={[
          styles.trigger,
          { backgroundColor: themeColors.control, borderColor: themeColors.border },
          disabled && styles.disabled,
        ]}
      >
        <Text
          style={[
            styles.triggerText,
            { color: hasValue ? themeColors.textPrimary : themeColors.textSecondary },
          ]}
        >
          {displayValue}
        </Text>
        <Ionicons name="calendar-outline" size={22} color={themeColors.textSecondary} />
      </TouchableOpacity>
      {hasValue && onClear ? (
        <TouchableOpacity onPress={onClear} style={styles.clearButton} accessibilityRole="button">
          <Text style={styles.clearText}>Clear {label.toLowerCase()}</Text>
        </TouchableOpacity>
      ) : null}

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: themeColors.surface,
                paddingBottom: Math.max(SPACING.lg, insets.bottom + SPACING.sm),
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: themeColors.surfaceAlt }]} />
            <Text style={[styles.title, { color: themeColors.textPrimary }]}>{pickerTitle}</Text>

            <View style={styles.steps}>
              {(
                [
                  ['year', 'Year', String(parts.year)],
                  ['month', 'Month', MONTHS[parts.month - 1]],
                  ['day', 'Day', String(parts.day)],
                ] as [PickerStep, string, string][]
              ).map(([key, stepLabel, stepValue]) => {
                const isActive = step === key;
                const isComplete =
                  (key === 'year' && step !== 'year') || (key === 'month' && step === 'day');
                return (
                  <TouchableOpacity
                    key={key}
                    accessibilityRole="button"
                    onPress={() => setStep(key)}
                    style={[
                      styles.step,
                      {
                        backgroundColor: isActive
                          ? themeColors.controlSelected
                          : themeColors.control,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.stepBadge,
                        {
                          backgroundColor: isActive
                            ? themeColors.surfaceElevated
                            : themeColors.accent,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepBadgeText,
                          {
                            color: isActive ? themeColors.accent : themeColors.textOnAccent,
                          },
                        ]}
                      >
                        {isComplete ? '✓' : key === 'year' ? '1' : key === 'month' ? '2' : '3'}
                      </Text>
                    </View>
                    <View style={styles.stepCopy}>
                      <Text
                        style={[
                          styles.stepLabel,
                          {
                            color: isActive ? themeColors.textOnAccent : themeColors.accent,
                          },
                        ]}
                      >
                        {stepLabel}
                      </Text>
                      <Text
                        style={[
                          styles.stepValue,
                          {
                            color: isActive ? themeColors.textOnAccent : themeColors.textSecondary,
                          },
                        ]}
                      >
                        {stepValue}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.pickerBody}>
              {step === 'year' ? (
                <ScrollView
                  ref={yearScrollRef}
                  testID="date-only-year-list"
                  style={styles.pickerScroll}
                  contentContainerStyle={styles.yearGrid}
                  contentOffset={{ x: 0, y: selectedYearOffset }}
                  onLayout={() =>
                    yearScrollRef.current?.scrollTo({ y: selectedYearOffset, animated: false })
                  }
                  showsVerticalScrollIndicator={false}
                >
                  {years.map((year) => (
                    <TouchableOpacity
                      key={year}
                      onPress={() => selectYear(year)}
                      style={[
                        styles.yearButton,
                        {
                          backgroundColor: themeColors.control,
                          borderColor:
                            year === parts.year ? themeColors.borderStrong : themeColors.border,
                        },
                        year === parts.year && { backgroundColor: themeColors.controlSelected },
                      ]}
                    >
                      <Text
                        style={{
                          color:
                            year === parts.year
                              ? themeColors.textOnAccent
                              : themeColors.textPrimary,
                          fontSize: FONTS.base,
                          fontWeight: '600',
                        }}
                      >
                        {year}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : step === 'month' ? (
                <ScrollView
                  style={styles.pickerScroll}
                  contentContainerStyle={styles.monthGrid}
                  showsVerticalScrollIndicator={false}
                >
                  {MONTHS.map((monthName, index) => {
                    const disabledMonth = !doesMonthOverlapBounds(
                      parts.year,
                      index + 1,
                      minimumDate,
                      maximumDate
                    );
                    const selected = index + 1 === parts.month;
                    return (
                      <TouchableOpacity
                        key={monthName}
                        disabled={disabledMonth}
                        onPress={() => selectMonth(index + 1)}
                        style={[
                          styles.monthButton,
                          {
                            backgroundColor: themeColors.control,
                            borderColor: selected ? themeColors.borderStrong : themeColors.border,
                          },
                          selected && { backgroundColor: themeColors.controlSelected },
                          disabledMonth && styles.disabled,
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? themeColors.textOnAccent : themeColors.textPrimary,
                            fontSize: FONTS.sm,
                            fontWeight: '600',
                          }}
                        >
                          {monthName.slice(0, 3)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <ScrollView
                  style={styles.pickerScroll}
                  contentContainerStyle={styles.dayContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.monthNav}>
                    <TouchableOpacity
                      onPress={() => changeMonth(-1)}
                      style={styles.navButton}
                      accessibilityLabel="Previous month"
                    >
                      <Ionicons name="chevron-back" size={28} color={themeColors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.monthHeading, { color: themeColors.textPrimary }]}>
                      {MONTHS[parts.month - 1]} {parts.year}
                    </Text>
                    <TouchableOpacity
                      onPress={() => changeMonth(1)}
                      style={styles.navButton}
                      accessibilityLabel="Next month"
                    >
                      <Ionicons name="chevron-forward" size={28} color={themeColors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.weekGrid}>
                    {WEEKDAYS.map((weekday) => (
                      <Text
                        key={weekday}
                        style={[styles.weekday, { color: themeColors.textSecondary }]}
                      >
                        {weekday}
                      </Text>
                    ))}
                    {dayGrid.map((day, index) => {
                      if (day === null)
                        return <View key={`empty-${index}`} style={styles.dayCell} />;
                      const dayValue = dateOnlyToString({
                        year: parts.year,
                        month: parts.month,
                        day,
                      });
                      const selected = day === parts.day;
                      const disabledDay = !isDateWithinBounds(dayValue, minimumDate, maximumDate);
                      return (
                        <TouchableOpacity
                          key={dayValue}
                          disabled={disabledDay}
                          onPress={() => selectDay(day)}
                          style={[
                            styles.dayCell,
                            selected && [
                              styles.selectedDay,
                              { backgroundColor: themeColors.controlSelected },
                            ],
                            disabledDay && styles.disabled,
                          ]}
                        >
                          <Text
                            style={{
                              color: selected
                                ? themeColors.textOnAccent
                                : disabledDay
                                  ? themeColors.textSecondary
                                  : themeColors.textPrimary,
                              fontSize: FONTS.base,
                              fontWeight: selected ? '700' : '400',
                            }}
                          >
                            {day}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => setVisible(false)}
                style={[
                  styles.action,
                  styles.cancelAction,
                  { borderColor: themeColors.borderStrong },
                ]}
              >
                <Text style={[styles.cancelText, { color: themeColors.textSecondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  onChange(draft);
                  setVisible(false);
                }}
                style={[
                  styles.action,
                  styles.confirmAction,
                  { backgroundColor: themeColors.controlSelected },
                ]}
              >
                <Text style={[styles.confirmText, { color: themeColors.textOnAccent }]}>
                  Set Date
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  field: { marginBottom: SPACING.md },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  trigger: {
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerText: { fontSize: FONTS.base },
  clearButton: { alignSelf: 'flex-start', paddingTop: SPACING.xs },
  clearText: { color: COLORS.danger, fontSize: FONTS.sm },
  disabled: { opacity: 0.45 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    borderTopLeftRadius: BORDER_RADIUS['2xl'],
    borderTopRightRadius: BORDER_RADIUS['2xl'],
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    height: 5,
    width: 48,
    borderRadius: 999,
    marginBottom: SPACING.lg,
  },
  title: { fontSize: FONTS['2xl'], fontWeight: '700', marginBottom: SPACING.lg },
  steps: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  pickerBody: { flexShrink: 1, minHeight: 0 },
  pickerScroll: { flexShrink: 1 },
  step: {
    flex: 1,
    minHeight: 72,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { fontWeight: '700', fontSize: FONTS.sm },
  stepCopy: { flex: 1 },
  stepLabel: { fontWeight: '700', fontSize: FONTS.sm },
  stepValue: { fontSize: FONTS.sm, marginTop: 2 },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingBottom: SPACING.sm },
  yearButton: {
    width: '30%',
    minHeight: 46,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingBottom: SPACING.md },
  monthButton: {
    width: '30%',
    minHeight: 46,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  navButton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthHeading: { fontSize: FONTS.xl, fontWeight: '700' },
  dayContent: { paddingBottom: SPACING.xs },
  weekGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: SPACING.md },
  weekday: {
    width: '14.2857%',
    textAlign: 'center',
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  selectedDay: { borderRadius: 999 },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  action: {
    flex: 1,
    minHeight: 52,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelAction: { borderWidth: 1 },
  confirmAction: {},
  cancelText: { fontSize: FONTS.lg, fontWeight: '600' },
  confirmText: { fontSize: FONTS.lg, fontWeight: '700' },
});
