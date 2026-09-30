import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Calendar, CalendarProps, DateData } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  doesMonthOverlapBounds,
  getPickerYears,
  localToday,
  parseDateOnly,
} from '../utils/dateOnlyPicker';

export const CALENDAR_MONTHS = [
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
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ROW_HEIGHT = 44;
type Menu = 'month' | 'year';

export interface AppCalendarProps extends CalendarProps {
  /** A date-field popover already owns a Modal. Keep its menus in that same layer. */
  inlineMenus?: boolean;
}

function Weekdays({ firstDay = 0, hideDayNames }: { firstDay?: number; hideDayNames?: boolean }) {
  const colors = useThemeColors();
  if (hideDayNames) return null;
  return (
    <View style={styles.weekdays}>
      {WEEKDAYS.map((_, index) => (
        <Text key={index} style={[styles.weekday, { color: colors.textPrimary }]}>
          {WEEKDAYS[(index + firstDay) % 7]}
        </Text>
      ))}
    </View>
  );
}

/** Shared visual shell; the existing calendar still owns marks, ranges and day actions. */
export function AppCalendar({
  current,
  initialDate,
  minDate,
  maxDate,
  onMonthChange,
  theme,
  inlineMenus = false,
  style,
  ...props
}: AppCalendarProps) {
  const colors = useThemeColors();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState((initialDate || current || localToday()).slice(0, 7) + '-01');
  const notifiedMonth = useRef(month);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [calendarHeight, setCalendarHeight] = useState(400);
  const [anchor, setAnchor] = useState({ x: 16, y: 100, width: 160, height: 44 });
  const monthRef = useRef<View>(null);
  const yearRef = useRef<View>(null);
  const listRef = useRef<ScrollView>(null);
  const parts = parseDateOnly(month)!;
  const accent = colors.isDark ? '#B5D5FF' : colors.accent;
  const selectedText = colors.isDark ? '#10213B' : '#FFFFFF';

  useEffect(() => {
    const next = initialDate || current;
    if (parseDateOnly(next)) setMonth(next!.slice(0, 7) + '-01');
  }, [current, initialDate]);

  const years = useMemo(
    () => getPickerYears(parts.year, minDate, maxDate),
    [parts.year, minDate, maxDate]
  );
  const options =
    menu === 'month'
      ? CALENDAR_MONTHS.map((label, index) => ({
          value: index + 1,
          label,
          disabled: !doesMonthOverlapBounds(parts.year, index + 1, minDate, maxDate),
        }))
      : years.map((year) => ({ value: year, label: String(year), disabled: false }));
  const selected = menu === 'month' ? parts.month : parts.year;
  const offset =
    Math.max(0, options.findIndex((option) => option.value === selected) - 2) * ROW_HEIGHT;
  const availableHeight = Math.max(100, window.height - insets.top - insets.bottom - 32);
  const menuHeight = Math.min(
    308,
    availableHeight,
    inlineMenus ? Math.max(100, calendarHeight - 70) : availableHeight
  );

  const openMenu = (next: Menu) => {
    if (menu === next) {
      setMenu(null);
      return;
    }
    const ref = next === 'month' ? monthRef : yearRef;
    if (inlineMenus) {
      setMenu(next);
      return;
    }
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setMenu(next);
    });
  };
  const changeMonth = (year: number, nextMonth: number) => {
    // A new year may only have some months enabled. Go to its closest valid month.
    const validMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter((value) =>
      doesMonthOverlapBounds(year, value, minDate, maxDate)
    );
    if (!validMonths.length) return;
    const valid = validMonths.reduce((best, value) =>
      Math.abs(value - nextMonth) < Math.abs(best - nextMonth) ? value : best
    );
    setMonth(`${String(year).padStart(4, '0')}-${String(valid).padStart(2, '0')}-01`);
    setMenu(null);
  };
  const handleMonthChange = (date: DateData) => {
    const next = date.dateString.slice(0, 7) + '-01';
    setMonth(next);
    // The library also reports initialDate/theme reinitialization. Avoid redundant data loads.
    if (notifiedMonth.current !== next) {
      notifiedMonth.current = next;
      onMonthChange?.(date);
    }
  };
  const menuContent = menu && (
    <ScrollView
      ref={listRef}
      testID="calendar-options"
      style={{ maxHeight: menuHeight }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      contentOffset={{ x: 0, y: offset }}
      onContentSizeChange={() => listRef.current?.scrollTo({ y: offset, animated: false })}
    >
      {options.map((option) => (
        <TouchableOpacity
          key={option.value}
          accessibilityRole="button"
          accessibilityLabel={`${menu === 'month' ? 'Month' : 'Year'} ${option.label}`}
          accessibilityState={{ selected: option.value === selected, disabled: option.disabled }}
          disabled={option.disabled}
          onPress={() =>
            changeMonth(
              menu === 'year' ? option.value : parts.year,
              menu === 'month' ? option.value : parts.month
            )
          }
          style={[
            styles.option,
            option.value === selected && { backgroundColor: colors.isDark ? '#304E73' : '#E7EFFB' },
            option.disabled && styles.disabled,
          ]}
        >
          <Text
            style={[
              styles.optionText,
              { color: colors.textPrimary },
              option.value === selected && styles.bold,
            ]}
          >
            {option.label}
          </Text>
          {option.value === selected && <Ionicons name="checkmark" size={20} color={accent} />}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
  const menuStyle = [
    styles.menu,
    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
  ];
  const popoverWidth = Math.min(Math.max(170, anchor.width), window.width - 32);
  const popoverTop = Math.max(
    insets.top + 8,
    Math.min(anchor.y + anchor.height + 4, window.height - insets.bottom - menuHeight - 16)
  );

  return (
    <View
      style={styles.container}
      onLayout={(event) => setCalendarHeight(event.nativeEvent.layout.height)}
    >
      <View style={styles.header}>
        {(['month', 'year'] as const).map((kind) => (
          <View
            key={kind}
            ref={kind === 'month' ? monthRef : yearRef}
            collapsable={false}
            style={[styles.controlWrap, kind === 'month' && { flex: 1.25 }]}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                kind === 'month'
                  ? `Choose month, ${CALENDAR_MONTHS[parts.month - 1]}`
                  : `Choose year, ${parts.year}`
              }
              accessibilityState={{ expanded: menu === kind }}
              onPress={() => openMenu(kind)}
              style={[
                styles.control,
                {
                  backgroundColor: colors.control,
                  borderColor: menu === kind ? accent : colors.border,
                },
              ]}
            >
              <Text numberOfLines={1} style={[styles.controlText, { color: colors.textPrimary }]}>
                {kind === 'month' ? CALENDAR_MONTHS[parts.month - 1] : parts.year}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <Calendar
        {...props}
        key={colors.isDark ? 'night' : 'day'}
        current={month}
        initialDate={month}
        minDate={minDate}
        maxDate={maxDate}
        onMonthChange={handleMonthChange}
        customHeader={Weekdays}
        theme={{
          ...theme,
          calendarBackground: colors.surface,
          dayTextColor: colors.textPrimary,
          textSectionTitleColor: colors.textPrimary,
          textDisabledColor: colors.textMuted,
          todayTextColor: colors.textPrimary,
          todayBackgroundColor: colors.isDark ? '#334B6B' : '#E7EFFB',
          selectedDayBackgroundColor: accent,
          selectedDayTextColor: selectedText,
          textDayFontSize: 16,
        }}
        style={style}
      />
      {menu && inlineMenus && (
        <>
          <Pressable
            accessibilityLabel="Close calendar menu"
            style={[StyleSheet.absoluteFill, styles.inlineBackdrop]}
            onPress={() => setMenu(null)}
          />
          <View
            style={[...menuStyle, styles.inlineMenu, menu === 'month' ? { left: 0 } : { right: 0 }]}
          >
            {menuContent}
          </View>
        </>
      )}
      {menu && !inlineMenus && (
        <Modal transparent animationType="fade" onRequestClose={() => setMenu(null)}>
          <Pressable
            accessibilityLabel="Close calendar menu"
            style={StyleSheet.absoluteFill}
            onPress={() => setMenu(null)}
          />
          <View
            style={[
              ...menuStyle,
              {
                position: 'absolute',
                width: popoverWidth,
                top: popoverTop,
                left: Math.max(16, Math.min(anchor.x, window.width - popoverWidth - 16)),
              },
            ]}
          >
            {menuContent}
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  controlWrap: { flex: 1, minWidth: 0 },
  control: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  controlText: { fontSize: 15, flexShrink: 1 },
  weekdays: { flexDirection: 'row', paddingVertical: 12 },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 12, fontWeight: '600' },
  menu: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  inlineBackdrop: { zIndex: 2 },
  inlineMenu: { position: 'absolute', top: 58, width: '53%', zIndex: 3 },
  option: {
    minHeight: ROW_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  optionText: { fontSize: 16 },
  bold: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
