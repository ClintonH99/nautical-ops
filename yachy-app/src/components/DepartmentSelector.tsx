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
import { DEPARTMENT_OPTIONS, formatDepartmentLabel } from '../utils/departmentSelection';
import { LabeledDropdown } from './LabeledDropdown';

interface DepartmentSelectorProps {
  value: Department | null;
  onChange: (department: Department | null) => void;
  label?: string;
  includeAll?: boolean;
  allLabel?: string;
  emptyLabel?: string;
  tightTop?: boolean;
  presentation?: 'modal' | 'inline';
  layout?: 'row' | 'stacked';
}

/**
 * A shared department picker. The selected value remains the existing
 * Department enum; this component only owns the presentation and open state.
 *
 * Options render in a bounded modal rather than an inline absolute menu so a
 * ScrollView, keyboard, or landscape viewport cannot clip them. The inline
 * presentation is reserved for callers already inside a native Modal, because
 * React Native cannot reliably stack another native Modal on iOS.
 */
export const DepartmentSelector: React.FC<DepartmentSelectorProps> = ({
  value,
  onChange,
  label = 'Department',
  includeAll = false,
  allLabel = 'All Departments',
  emptyLabel = 'Select department',
  tightTop = false,
  presentation = 'modal',
  layout = 'row',
}) => {
  const [open, setOpen] = useState(false);
  const themeColors = useThemeColors();
  const options: Array<Department | null> = includeAll
    ? [null, ...DEPARTMENT_OPTIONS]
    : [...DEPARTMENT_OPTIONS];
  const selectedLabel = value ? formatDepartmentLabel(value) : includeAll ? allLabel : emptyLabel;
  const triggerColor = themeColors.isDark ? themeColors.textPrimary : COLORS.primary;

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

  const renderOptions = () => (
    <ScrollView
      style={styles.optionList}
      contentContainerStyle={styles.optionListContent}
      showsVerticalScrollIndicator
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {options.map((department) => {
        const isSelected = department === value;
        const optionLabel = department ? formatDepartmentLabel(department) : allLabel;
        return (
          <TouchableOpacity
            key={department ?? 'all'}
            style={[
              styles.option,
              isSelected && styles.optionSelected,
              isSelected &&
                themeColors.isDark && {
                  borderColor: themeColors.borderStrong,
                },
            ]}
            onPress={() => select(department)}
            activeOpacity={0.72}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={optionLabel}
          >
            <View style={styles.selectionMark}>
              {isSelected && <Ionicons name="checkmark" size={22} color={COLORS.white} />}
            </View>
            <Text
              style={[
                styles.optionText,
                {
                  color: isSelected ? COLORS.white : themeColors.textPrimary,
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
  );

  const renderHeader = () => (
    <View style={[styles.sheetHeader, { borderBottomColor: themeColors.border }]}>
      <Text style={[styles.sheetTitle, { color: themeColors.textPrimary }]}>Select department</Text>
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
      {open && presentation === 'inline' && (
        <View
          style={[
            styles.inlineSheet,
            {
              backgroundColor: themeColors.surfaceElevated,
              borderColor: themeColors.border,
            },
          ]}
          accessibilityRole="menu"
        >
          {renderHeader()}
          {renderOptions()}
        </View>
      )}
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
              {renderHeader()}
              {renderOptions()}
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
  inlineSheet: {
    width: '100%',
    maxHeight: 400,
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
