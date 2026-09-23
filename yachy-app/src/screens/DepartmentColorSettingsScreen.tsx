/**
 * Department Color Settings Screen
 * Crew can choose a color scheme per department or "No color"
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import { useDepartmentColorStore, getDepartmentColor, useAuthStore } from '../store';
import { Department } from '../types';
import { canAccessDepartmentColorSettings } from '../utils/access';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

const DEPARTMENT_LABELS: Record<Department, string> = {
  BRIDGE: 'Bridge',
  ENGINEERING: 'Engineering',
  EXTERIOR: 'Exterior',
  INTERIOR: 'Interior',
  GALLEY: 'Galley',
};

const COLOR_SWATCHES = COLORS.tripColorSwatches;

export const DepartmentColorSettingsScreen = () => {
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const { overrides, loaded, loadOverrides, setOverride } = useDepartmentColorStore();
  const [pickingDepartment, setPickingDepartment] = useState<Department | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!canAccessDepartmentColorSettings(user)) {
        navigation.goBack();
        return;
      }
      loadOverrides();
    }, [loadOverrides, navigation, user])
  );

  const handleSelectColor = async (dept: Department, color: string | null) => {
    await setOverride(dept, color);
    setPickingDepartment(null);
  };

  if (!loaded) {
    return null;
  }

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Department Colors" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: themeColors.textSecondary }]}>
          Choose the identifying color used for each department.
        </Text>

        <View
          style={[
            styles.section,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
              borderWidth: 1,
            },
          ]}
        >
          {DEPARTMENTS.map((dept, index) => {
            const effectiveColor = getDepartmentColor(dept, overrides);
            const isNoColor = overrides[dept] === null;
            const isLast = index === DEPARTMENTS.length - 1;
            return (
              <TouchableOpacity
                key={dept}
                style={[
                  styles.row,
                  { borderBottomColor: themeColors.border },
                  isLast && styles.rowLast,
                ]}
                onPress={() => setPickingDepartment(dept)}
                activeOpacity={0.7}
              >
                <Text style={[styles.rowLabel, { color: themeColors.textPrimary }]}>
                  {DEPARTMENT_LABELS[dept]}
                </Text>
                <View style={styles.rowRight}>
                  {isNoColor ? (
                    <Text style={[styles.noColorLabel, { color: themeColors.textSecondary }]}>
                      No color
                    </Text>
                  ) : (
                    <View style={[styles.swatch, { backgroundColor: effectiveColor }]} />
                  )}
                  <Ionicons name="chevron-forward" size={18} color={themeColors.textSecondary} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Modal visible={!!pickingDepartment} transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setPickingDepartment(null)}>
            <View
              style={[
                styles.modalBox,
                {
                  backgroundColor: themeColors.surfaceElevated,
                  borderColor: themeColors.border,
                  borderWidth: themeColors.isDark ? 1 : 0,
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              {pickingDepartment && (
                <>
                  <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                    {DEPARTMENT_LABELS[pickingDepartment]}
                  </Text>
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleSelectColor(pickingDepartment, null)}
                  >
                    <View
                      style={[
                        styles.swatch,
                        styles.swatchNoColor,
                        {
                          backgroundColor: themeColors.isDark
                            ? themeColors.surfaceAlt
                            : COLORS.gray300,
                          borderColor: themeColors.isDark
                            ? themeColors.borderStrong
                            : COLORS.border,
                        },
                      ]}
                    />
                    <Text style={[styles.modalOptionText, { color: themeColors.textPrimary }]}>
                      No color
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.swatchRow}>
                    {COLOR_SWATCHES.map((hex) => (
                      <TouchableOpacity
                        key={hex}
                        style={[styles.swatch, styles.swatchSmall, { backgroundColor: hex }]}
                        onPress={() => handleSelectColor(pickingDepartment, hex)}
                      />
                    ))}
                  </View>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setPickingDepartment(null)}
                  >
                    <Text style={[styles.cancelButtonText, { color: themeColors.textSecondary }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Pressable>
        </Modal>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },

  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  intro: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 62,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  noColorLabel: { fontSize: FONTS.sm },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  swatchNoColor: {
    backgroundColor: COLORS.gray300,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  modalOptionText: { fontSize: FONTS.base },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  swatchSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  cancelButton: {
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: FONTS.base },
});
