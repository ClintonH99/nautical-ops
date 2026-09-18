import React, { useState } from 'react';
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
import { BORDER_RADIUS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

export interface FuelSelectOption<T extends string = string> {
  label: string;
  value: T;
  description?: string;
}

interface FuelSelectFieldProps<T extends string = string> {
  label: string;
  value: T | null | undefined;
  options: FuelSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * A compact, touch-friendly selector used by the fuel flows.
 *
 * Native select controls render very differently on iOS, Android and web.
 * Keeping the options in a small bottom sheet gives all three platforms the
 * same interaction and preserves readable contrast in night mode.
 */
export function FuelSelectField<T extends string = string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled = false,
  title,
}: FuelSelectFieldProps<T>) {
  const themeColors = useThemeColors();
  const [visible, setVisible] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: themeColors.textPrimary }]}>{label}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityHint="Opens a list of choices"
        activeOpacity={0.7}
        disabled={disabled}
        onPress={() => setVisible(true)}
        style={[
          styles.trigger,
          {
            backgroundColor: themeColors.control,
            borderColor: themeColors.border,
          },
          disabled && styles.disabled,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.triggerText,
            { color: selected ? themeColors.textPrimary : themeColors.textSecondary },
          ]}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color={themeColors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View style={[styles.sheet, { backgroundColor: themeColors.surfaceElevated }]}>
            <View style={[styles.handle, { backgroundColor: themeColors.surfaceAlt }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: themeColors.textPrimary }]}>
                {title ?? `Select ${label.toLowerCase()}`}
              </Text>
              <TouchableOpacity
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close selector"
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={themeColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.optionScroll}
              contentContainerStyle={styles.optionList}
              showsVerticalScrollIndicator={false}
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    activeOpacity={0.75}
                    onPress={() => {
                      onChange(option.value);
                      setVisible(false);
                    }}
                    style={[
                      styles.option,
                      {
                        backgroundColor: isSelected
                          ? themeColors.controlSelected
                          : themeColors.control,
                        borderColor: isSelected ? themeColors.borderStrong : themeColors.border,
                      },
                    ]}
                  >
                    <View style={styles.optionCopy}>
                      <Text
                        style={[
                          styles.optionLabel,
                          {
                            color: isSelected ? themeColors.textOnAccent : themeColors.textPrimary,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text
                          style={[
                            styles.optionDescription,
                            {
                              color: isSelected
                                ? themeColors.textOnAccent
                                : themeColors.textSecondary,
                            },
                          ]}
                        >
                          {option.description}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={24}
                        color={themeColors.textOnAccent}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: SPACING.md },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  trigger: {
    minHeight: 48,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  triggerText: { flex: 1, fontSize: FONTS.base },
  disabled: { opacity: 0.5 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: BORDER_RADIUS['2xl'],
    borderTopRightRadius: BORDER_RADIUS['2xl'],
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sheetTitle: { flex: 1, fontSize: FONTS.xl, fontWeight: '700' },
  closeButton: { padding: SPACING.xs },
  optionScroll: { flexGrow: 0 },
  optionList: { gap: SPACING.sm, paddingBottom: SPACING.sm },
  option: {
    minHeight: 58,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  optionCopy: { flex: 1 },
  optionLabel: { fontSize: FONTS.base, fontWeight: '600' },
  optionDescription: { fontSize: FONTS.sm, marginTop: 2 },
});
