import React, { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Department } from '../types';
import { FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { LabeledDropdown } from './LabeledDropdown';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

const departmentLabel = (department: Department) =>
  department.charAt(0) + department.slice(1).toLowerCase();

interface DepartmentSelectorProps {
  value: Department | null;
  onChange: (department: Department | null) => void;
  label?: string;
  includeAll?: boolean;
  allLabel?: string;
  emptyLabel?: string;
  tightTop?: boolean;
}

/**
 * A shared department picker. The selected value remains the existing
 * Department enum; this component only owns the presentation and open state.
 *
 * Options render in a bounded modal rather than an inline absolute menu so a
 * ScrollView, keyboard, or landscape viewport cannot clip them.
 */
export const DepartmentSelector: React.FC<DepartmentSelectorProps> = ({
  value,
  onChange,
  label = 'Department',
  includeAll = false,
  allLabel = 'All Departments',
  emptyLabel = 'Select department',
  tightTop = false,
}) => {
  const [open, setOpen] = useState(false);
  const themeColors = useThemeColors();
  const options: Array<Department | null> = includeAll ? [null, ...DEPARTMENTS] : DEPARTMENTS;
  const selectedLabel = value ? departmentLabel(value) : includeAll ? allLabel : emptyLabel;

  const select = (department: Department | null) => {
    onChange(department);
    setOpen(false);
  };

  const toggle = () => {
    setOpen((visible) => {
      if (!visible) Keyboard.dismiss();
      return !visible;
    });
  };

  return (
    <View style={styles.container}>
      <LabeledDropdown
        label={label}
        value={selectedLabel}
        open={open}
        onPress={toggle}
        tightTop={tightTop}
      />
      {open && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <KeyboardAvoidingView
            style={styles.modalRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close department selector"
            />
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: themeColors.surfaceElevated,
                  borderColor: themeColors.border,
                  shadowColor: themeColors.isDark ? '#000000' : '#22324a',
                },
              ]}
              accessibilityRole="menu"
              accessibilityViewIsModal
            >
              <ScrollView
                style={styles.optionList}
                contentContainerStyle={styles.optionListContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {options.map((department) => {
                  const isSelected = department === value;
                  const optionLabel = department ? departmentLabel(department) : allLabel;
                  return (
                    <TouchableOpacity
                      key={department ?? 'all'}
                      style={[
                        styles.option,
                        isSelected && {
                          backgroundColor: themeColors.controlSelected,
                        },
                      ]}
                      onPress={() => select(department)}
                      activeOpacity={0.72}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={optionLabel}
                    >
                      <View style={styles.selectionMark}>
                        {isSelected && (
                          <Ionicons name="checkmark" size={22} color={themeColors.textOnAccent} />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.optionText,
                          {
                            color: isSelected ? themeColors.textOnAccent : themeColors.textPrimary,
                          },
                          isSelected && styles.optionTextSelected,
                        ]}
                      >
                        {optionLabel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    zIndex: 1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '80%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    ...(Platform.OS === 'ios' ? SHADOWS.md : { elevation: 8 }),
  },
  optionList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  optionListContent: {
    paddingVertical: SPACING.xs,
  },
  option: {
    minHeight: 58,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionMark: {
    width: 30,
    alignItems: 'flex-start',
  },
  optionText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  optionTextSelected: {
    fontWeight: '700',
  },
});
