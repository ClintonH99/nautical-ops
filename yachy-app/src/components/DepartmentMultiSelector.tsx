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

interface DepartmentMultiSelectorProps {
  value: Department[];
  onChange: (departments: Department[]) => void;
  label?: string;
  includeAll?: boolean;
  allLabel?: string;
  emptyLabel?: string;
  minSelections?: number;
  maxSelections?: number;
  tightTop?: boolean;
}

/**
 * Shared multi-select counterpart to DepartmentSelector. It keeps the caller's
 * Department enum array intact and supplies the standard day/night UI in a
 * viewport-bounded modal, so its options cannot be clipped by a parent scroll
 * view, keyboard, or landscape viewport.
 */
export const DepartmentMultiSelector: React.FC<DepartmentMultiSelectorProps> = ({
  value,
  onChange,
  label = 'Department',
  includeAll = false,
  allLabel = 'All Departments',
  emptyLabel = 'Select departments',
  minSelections = 0,
  maxSelections,
  tightTop = false,
}) => {
  const [open, setOpen] = useState(false);
  const themeColors = useThemeColors();
  const selected = DEPARTMENTS.filter((department) => value.includes(department));
  const allSelected = selected.length === DEPARTMENTS.length;
  const selectedLabel = allSelected
    ? allLabel
    : selected.length
      ? selected.map(departmentLabel).join(', ')
      : emptyLabel;

  const toggleDepartment = (department: Department) => {
    if (allSelected) {
      onChange([department]);
      return;
    }

    if (selected.includes(department)) {
      if (selected.length <= minSelections) return;
      onChange(selected.filter((item) => item !== department));
      return;
    }

    if (maxSelections && selected.length >= maxSelections) return;
    onChange([...selected, department]);
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
        <Modal
          transparent
          statusBarTranslucent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable
              style={styles.backdrop}
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
                showsVerticalScrollIndicator
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {includeAll && (
                  <TouchableOpacity
                    style={[
                      styles.option,
                      allSelected && {
                        backgroundColor: themeColors.controlSelected,
                      },
                    ]}
                    onPress={() => onChange(DEPARTMENTS)}
                    activeOpacity={0.72}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: allSelected }}
                    accessibilityLabel={allLabel}
                  >
                    <View style={styles.selectionMark}>
                      {allSelected && (
                        <Ionicons name="checkmark" size={22} color={themeColors.textOnAccent} />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: allSelected ? themeColors.textOnAccent : themeColors.textPrimary,
                        },
                        allSelected && styles.optionTextSelected,
                      ]}
                    >
                      {allLabel}
                    </Text>
                  </TouchableOpacity>
                )}
                {DEPARTMENTS.map((department) => {
                  const isSelected = selected.includes(department);
                  return (
                    <TouchableOpacity
                      key={department}
                      style={[
                        styles.option,
                        isSelected && {
                          backgroundColor: themeColors.controlSelected,
                        },
                      ]}
                      onPress={() => toggleDepartment(department)}
                      activeOpacity={0.72}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={departmentLabel(department)}
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
                        {departmentLabel(department)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {maxSelections && (
                  <Text style={[styles.selectionHint, { color: themeColors.textSecondary }]}>
                    Select up to {maxSelections}
                  </Text>
                )}
              </ScrollView>
              <TouchableOpacity
                style={[styles.doneButton, { backgroundColor: themeColors.controlSelected }]}
                onPress={() => setOpen(false)}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel="Done selecting departments"
              >
                <Text style={[styles.doneText, { color: themeColors.textOnAccent }]}>Done</Text>
              </TouchableOpacity>
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
    width: '100%',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
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
    maxHeight: 420,
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
  selectionHint: {
    fontSize: FONTS.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  doneButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    margin: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
  },
  doneText: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
});
