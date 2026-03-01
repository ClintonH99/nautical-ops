/**
 * Button Tag Card
 * Standard interactive card design per ADMIN/App Design/BUTTON_TAG_STANDARD.md
 * Use for list items where users tap to view/edit and items show multiple fields.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

export interface ButtonTagCardProps {
  /** Main identifier shown in header (title first per design standard). Required. */
  headerTitle?: string;
  headerLeft?: React.ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  onPress?: () => void;
  selected?: boolean;
  showCheckbox?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  footer?: string;
  accentColor?: string;
  children: React.ReactNode;
}

function Checkbox({
  checked,
  onPress,
  themeColors,
}: {
  checked: boolean;
  onPress: () => void;
  themeColors: { surface: string };
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.checkbox,
        !checked && { backgroundColor: themeColors.surface },
        checked && styles.checkboxChecked,
      ]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {checked && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

export function ButtonTagCard({
  headerTitle,
  headerLeft,
  onEdit,
  onDelete,
  onPress,
  selected,
  showCheckbox,
  checked,
  onToggleSelect,
  footer,
  accentColor,
  children,
}: ButtonTagCardProps) {
  const themeColors = useThemeColors();

  const handlePress = () => {
    if (showCheckbox && onToggleSelect) {
      onToggleSelect();
    } else if (onPress) {
      onPress();
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.surface },
        accentColor && { borderLeftWidth: 4, borderLeftColor: accentColor },
        selected && styles.cardSelected,
      ]}
      onPress={handlePress}
      activeOpacity={0.85}
      disabled={!showCheckbox && !onPress}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeft}>
          {showCheckbox && onToggleSelect !== undefined && (
            <Checkbox
              checked={!!checked}
              onPress={onToggleSelect}
              themeColors={themeColors}
            />
          )}
          {headerLeft ?? (headerTitle != null ? (
            <View style={styles.cardMeta}>
              {headerTitle != null && (
                <Text style={[styles.cardTitle, { color: COLORS.primary }]} numberOfLines={1}>
                  {headerTitle}
                </Text>
              )}
            </View>
          ) : null)}
        </View>
        <View style={styles.cardActions}>
          {onDelete && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onDelete(); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          )}
          {onEdit && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onEdit(); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.editBtn}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {children}

      {footer && (
        <Text style={[styles.cardCreatedBy, { color: themeColors.textSecondary }]}>
          {footer}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function ButtonTagRow({ label, value }: { label: string; value: string }) {
  const themeColors = useThemeColors();
  if (!value) return null;
  return (
    <View style={styles.cardRow}>
      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: { borderColor: COLORS.primary },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flex: 1, minWidth: 0 },
  cardTitle: { fontSize: FONTS.base, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: SPACING.md },
  editBtn: { fontSize: FONTS.sm, color: COLORS.primary, fontWeight: '600' },
  cardRow: { marginBottom: SPACING.sm },
  cardLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  cardValue: { fontSize: FONTS.base, lineHeight: 20 },
  cardCreatedBy: { fontSize: FONTS.xs, marginTop: SPACING.xs, fontStyle: 'italic' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.gray300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkmark: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
});
