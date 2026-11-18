import React, { useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { formatLocalDateString } from '../utils';
import {
  clampDateOnly,
  isDateWithinBounds,
  localToday,
  parseDateOnly,
} from '../utils/dateOnlyPicker';
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
  const [manual, setManual] = useState(false);
  const [draftDate, setDraftDate] = useState('');
  const [error, setError] = useState('');
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
    setManual(false);
    setError('');
    setDraftDate(hasValue ? value! : localToday());
    setOpeningDate(clampDateOnly(hasValue ? value! : localToday(), minimumDate, maximumDate));
    fieldRef.current?.measureInWindow((x, y, _width, fieldHeight) =>
      setAnchor({ x, y, height: fieldHeight })
    );
    setVisible(true);
  };

  const applyTypedDate = () => {
    const next = draftDate.trim();
    if (!parseDateOnly(next)) {
      setError('Enter a valid date as YYYY-MM-DD, for example 2026-11-18.');
      return;
    }
    if (!isDateWithinBounds(next, minimumDate, maximumDate)) {
      setError(
        `Choose a date${minimumDate ? ` on or after ${minimumDate}` : ''}${maximumDate ? ` on or before ${maximumDate}` : ''}.`
      );
      return;
    }
    onChange(next);
    Keyboard.dismiss();
    setVisible(false);
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
                top: manual ? Math.min(top, insets.top + 24) : top,
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
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  setManual(!manual);
                  setError('');
                }}
                style={styles.modeButton}
              >
                <Text style={{ color: colors.textPrimary, textDecorationLine: 'underline' }}>
                  {manual ? 'Use calendar' : 'Type a date'}
                </Text>
              </TouchableOpacity>
              {manual ? (
                <View>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>
                    Date (YYYY-MM-DD)
                  </Text>
                  <TextInput
                    accessibilityLabel="Date (YYYY-MM-DD)"
                    value={draftDate}
                    onChangeText={(text) => {
                      setDraftDate(text);
                      setError('');
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    selectTextOnFocus
                    maxLength={10}
                    onSubmitEditing={applyTypedDate}
                    style={[
                      styles.manualInput,
                      {
                        color: colors.textPrimary,
                        backgroundColor: colors.control,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                  {error ? (
                    <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>
                      {error}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={applyTypedDate}
                    style={[
                      styles.applyButton,
                      { backgroundColor: colors.isDark ? '#B5D5FF' : colors.accent },
                    ]}
                  >
                    <Text
                      style={{ color: colors.isDark ? '#10213B' : '#FFFFFF', fontWeight: '700' }}
                    >
                      Use date
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
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
              )}
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  modeButton: { alignSelf: 'flex-start', paddingVertical: 12 },
  manualInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.base,
  },
  applyButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.sm,
  },
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
