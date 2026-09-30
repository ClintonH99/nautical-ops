import React, { useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { formatLocalDateString } from '../utils';
import { clampDateOnly, localToday, parseDateOnly } from '../utils/dateOnlyPicker';
import { AppCalendar } from './AppCalendar';

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
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const fieldRef = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  const [openingDate, setOpeningDate] = useState(localToday);
  const [anchor, setAnchor] = useState({ x: 16, y: 100, height: 48 });
  const [cardHeight, setCardHeight] = useState(420);
  const hasValue = Boolean(parseDateOnly(value));
  const displayValue = hasValue ? formatLocalDateString(value!) : placeholder;
  const width = Math.min(400, window.width - insets.left - insets.right - 32);
  const maxHeight = window.height - insets.top - insets.bottom - 24;
  const height = Math.min(cardHeight, maxHeight);
  const below = anchor.y + anchor.height + 6;
  const top =
    below + height <= window.height - insets.bottom - 12
      ? below
      : Math.max(insets.top + 12, anchor.y - height - 6);
  const left = Math.max(
    insets.left + 16,
    Math.min(anchor.x, window.width - insets.right - width - 16)
  );

  const open = () => {
    Keyboard.dismiss();
    setOpeningDate(clampDateOnly(hasValue ? value! : localToday(), minimumDate, maximumDate));
    fieldRef.current?.measureInWindow((x, y, _width, fieldHeight) =>
      setAnchor({ x, y, height: fieldHeight })
    );
    setVisible(true);
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
      <View ref={fieldRef} collapsable={false}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${displayValue}`}
          accessibilityHint="Opens a calendar with month and year dropdowns"
          accessibilityState={{ expanded: visible, disabled }}
          disabled={disabled}
          onPress={open}
          activeOpacity={0.7}
          style={[
            styles.trigger,
            { backgroundColor: colors.control, borderColor: colors.border },
            disabled && styles.disabled,
          ]}
        >
          <Text
            style={[
              styles.triggerText,
              { color: hasValue ? colors.textPrimary : colors.textSecondary },
            ]}
          >
            {displayValue}
          </Text>
          <Ionicons
            name="calendar-outline"
            size={22}
            color={colors.isDark ? '#B5D5FF' : colors.accent}
          />
        </TouchableOpacity>
      </View>
      {hasValue && onClear ? (
        <TouchableOpacity onPress={onClear} style={styles.clearButton} accessibilityRole="button">
          <Text style={styles.clearText}>Clear {label.toLowerCase()}</Text>
        </TouchableOpacity>
      ) : null}
      {visible && (
        <Modal transparent animationType="fade" onRequestClose={() => setVisible(false)}>
          <Pressable
            accessibilityLabel="Dismiss date selector"
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={() => setVisible(false)}
          />
          <View
            accessibilityLabel={title ?? `Select ${label.toLowerCase()}`}
            onAccessibilityEscape={() => setVisible(false)}
            testID="date-picker-popover"
            style={[
              styles.card,
              {
                top,
                left,
                width,
                maxHeight,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={(_width, contentHeight) => setCardHeight(contentHeight + 24)}
            >
              <Text style={[styles.title, { color: colors.textPrimary }]}>{title ?? label}</Text>
              <AppCalendar
                current={openingDate}
                minDate={minimumDate}
                maxDate={maximumDate}
                hideArrows
                hideExtraDays
                inlineMenus
                markedDates={hasValue ? { [value!]: { selected: true } } : {}}
                onDayPress={({ dateString }) => {
                  onChange(dateString);
                  setVisible(false);
                }}
              />
            </ScrollView>
          </View>
        </Modal>
      )}
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
    gap: 8,
  },
  triggerText: { fontSize: FONTS.base, flexShrink: 1 },
  clearButton: { alignSelf: 'flex-start', paddingTop: SPACING.xs },
  clearText: { color: COLORS.danger, fontSize: FONTS.sm },
  disabled: { opacity: 0.45 },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.12)' },
  card: {
    position: 'absolute',
    padding: 12,
    borderWidth: 1,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
});
