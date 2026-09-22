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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  areAllDepartmentsSelected,
  canSelectAllDepartments,
  DEPARTMENT_OPTIONS,
  formatDepartmentLabel,
  getDepartmentSelectionLimits,
  getSelectedDepartments,
  isIndividualDepartmentSelected,
  selectDepartmentFromAggregate,
  toggleDepartmentSelection,
} from '../utils/departmentSelection';
import { LabeledDropdown } from './LabeledDropdown';

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
  presentation?: 'modal' | 'inline';
  layout?: 'row' | 'stacked';
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
  presentation = 'modal',
  layout = 'row',
}) => {
  const [open, setOpen] = useState(false);
  const themeColors = useThemeColors();
  const selected = getSelectedDepartments(value);
  const allSelected = areAllDepartmentsSelected(selected);
  const showAllOption = includeAll && canSelectAllDepartments(maxSelections);
  const aggregateSelected = showAllOption && allSelected;
  const { minimum, maximum } = getDepartmentSelectionLimits(minSelections, maxSelections);
  const selectedLabel = aggregateSelected
    ? allLabel
    : selected.length
      ? selected.map(formatDepartmentLabel).join(', ')
      : emptyLabel;
  const triggerColor = themeColors.isDark ? themeColors.textPrimary : COLORS.primary;
  const selectionHint =
    maxSelections !== undefined
      ? minimum > 0
        ? `Select ${minimum} to ${maximum}`
        : `Select up to ${maximum}`
      : minimum > 0
        ? `Select at least ${minimum}`
        : null;

  const toggleDepartment = (department: Department) => {
    onChange(
      aggregateSelected
        ? selectDepartmentFromAggregate(department, minSelections, maxSelections)
        : toggleDepartmentSelection(selected, department, minSelections, maxSelections)
    );
  };

  const toggle = () => {
    setOpen((visible) => {
      if (!visible) Keyboard.dismiss();
      return !visible;
    });
  };

  const selectedRowStyle = (isSelected: boolean) => [
    styles.option,
    isSelected && styles.optionSelected,
    isSelected &&
      themeColors.isDark && {
        borderColor: themeColors.borderStrong,
      },
  ];

  const renderHeader = () => (
    <View style={[styles.sheetHeader, { borderBottomColor: themeColors.border }]}>
      <Text style={[styles.sheetTitle, { color: themeColors.textPrimary }]}>
        Select departments
      </Text>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => setOpen(false)}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel="Close department selector"
      >
        <Ionicons name="close" size={22} color={themeColors.textPrimary} />
      </TouchableOpacity>
    </View>
  );

  const renderOptions = () => (
    <ScrollView
      style={styles.optionList}
      contentContainerStyle={styles.optionListContent}
      showsVerticalScrollIndicator
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {showAllOption && (
        <TouchableOpacity
          style={selectedRowStyle(allSelected)}
          onPress={() => onChange([...DEPARTMENT_OPTIONS])}
          activeOpacity={0.72}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: allSelected }}
          accessibilityLabel={allLabel}
        >
          <View style={styles.selectionMark}>
            {allSelected && <Ionicons name="checkmark" size={22} color={COLORS.white} />}
          </View>
          <Text
            style={[
              styles.optionText,
              { color: allSelected ? COLORS.white : themeColors.textPrimary },
              allSelected && styles.optionTextSelected,
            ]}
          >
            {allLabel}
          </Text>
        </TouchableOpacity>
      )}
      {DEPARTMENT_OPTIONS.map((department) => {
        // When every department is active, the single "All Departments" row
        // communicates that state without six competing highlights.
        const isSelected = isIndividualDepartmentSelected(department, selected, aggregateSelected);
        const isActuallySelected = selected.includes(department);
        const isDisabled = isActuallySelected
          ? selected.length <= minimum
          : selected.length >= maximum;
        return (
          <TouchableOpacity
            key={department}
            style={[
              selectedRowStyle(isSelected),
              isDisabled && !isActuallySelected && styles.optionDisabled,
            ]}
            onPress={() => toggleDepartment(department)}
            disabled={isDisabled}
            activeOpacity={0.72}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: isSelected, disabled: isDisabled }}
            accessibilityLabel={formatDepartmentLabel(department)}
          >
            <View style={styles.selectionMark}>
              {isSelected && <Ionicons name="checkmark" size={22} color={COLORS.white} />}
            </View>
            <Text
              style={[
                styles.optionText,
                { color: isSelected ? COLORS.white : themeColors.textPrimary },
                isSelected && styles.optionTextSelected,
              ]}
            >
              {formatDepartmentLabel(department)}
            </Text>
          </TouchableOpacity>
        );
      })}
      {selectionHint && (
        <Text style={[styles.selectionHint, { color: themeColors.textSecondary }]}>
          {selectionHint}
        </Text>
      )}
    </ScrollView>
  );

  const renderSheet = (inline = false) => (
    <View
      style={[
        inline ? styles.inlineSheet : styles.sheet,
        {
          backgroundColor: themeColors.surfaceElevated,
          borderColor: themeColors.border,
          ...(!inline ? { shadowColor: themeColors.isDark ? '#000000' : '#22324a' } : {}),
        },
      ]}
      accessibilityRole="menu"
      accessibilityViewIsModal={!inline}
    >
      {renderHeader()}
      {renderOptions()}
      <TouchableOpacity
        style={styles.doneButton}
        onPress={() => setOpen(false)}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel="Done selecting departments"
      >
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <LabeledDropdown
        label={label}
        value={selectedLabel}
        open={open}
        onPress={toggle}
        tightTop={tightTop}
        layout={layout}
        valueColor={triggerColor}
        iconColor={triggerColor}
      />
      {open && presentation === 'inline' && renderSheet(true)}
      {open && presentation === 'modal' && (
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
            {renderSheet()}
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
  inlineSheet: {
    width: '100%',
    maxHeight: 460,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  optionList: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: 326,
  },
  optionListContent: {
    paddingVertical: SPACING.xs,
  },
  option: {
    minHeight: 52,
    marginHorizontal: SPACING.xs,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: BORDER_RADIUS.sm,
  },
  optionSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionDisabled: {
    opacity: 0.48,
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
    backgroundColor: COLORS.primary,
  },
  doneText: {
    fontSize: FONTS.base,
    fontWeight: '700',
    color: COLORS.white,
  },
  sheetHeader: {
    minHeight: 56,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
