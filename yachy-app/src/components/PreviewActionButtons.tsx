import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface PreviewActionButtonsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  deleting?: boolean;
  disabled?: boolean;
}

/** Standard Maintenance Log action row for expanded preview panels. */
export function PreviewActionButtons({
  onEdit,
  onDelete,
  editLabel = 'Edit',
  deleteLabel = 'Delete',
  deleting = false,
  disabled = false,
}: PreviewActionButtonsProps) {
  const themeColors = useThemeColors();
  if (!onEdit && !onDelete) return null;

  const editColor = themeColors.isDark ? COLORS.white : COLORS.primary;

  return (
    <View style={styles.actions}>
      {onEdit ? (
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: editColor }]}
          onPress={onEdit}
          disabled={disabled}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={editLabel}
        >
          <Ionicons name="create-outline" size={18} color={editColor} />
          <Text style={[styles.actionText, { color: editColor }]}>{editLabel}</Text>
        </TouchableOpacity>
      ) : null}
      {onDelete ? (
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: COLORS.danger }]}
          onPress={onDelete}
          disabled={disabled || deleting}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
          <Text style={[styles.actionText, { color: COLORS.danger }]}>
            {deleting ? 'Deleting…' : deleteLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.xs,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  actionText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
});
