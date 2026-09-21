import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PreviewActionButtons } from './PreviewActionButtons';

interface TaskPreviewCardProps {
  title: string;
  department: string;
  category?: string;
  dateLabel?: string;
  dateValue?: string;
  recurring?: string;
  notes?: string | null;
  completedByLine?: string;
  completed?: boolean;
  dateIsOverdue?: boolean;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMarkComplete?: () => void;
  onUnmarkComplete?: () => void;
}

function DetailRow({
  label,
  value,
  valueColor,
  asBadge = false,
}: {
  label: string;
  value?: string | null;
  valueColor?: string;
  asBadge?: boolean;
}) {
  const themeColors = useThemeColors();
  if (!value) return null;

  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: themeColors.textSecondary }]}>{label}</Text>
      {asBadge ? (
        <View style={[styles.detailBadge, { backgroundColor: themeColors.surfaceAlt }]}>
          <Text style={[styles.detailBadgeText, { color: themeColors.textPrimary }]}>{value}</Text>
        </View>
      ) : (
        <Text style={[styles.detailValue, { color: valueColor ?? themeColors.textPrimary }]}>
          {value}
        </Text>
      )}
    </View>
  );
}

export function TaskPreviewCard({
  title,
  department,
  category,
  dateLabel,
  dateValue,
  recurring,
  notes,
  completedByLine,
  completed = false,
  dateIsOverdue = false,
  onPress,
  onEdit,
  onDelete,
  onMarkComplete,
  onUnmarkComplete,
}: TaskPreviewCardProps) {
  const themeColors = useThemeColors();
  const isCompleted = completed || !!completedByLine || !!onUnmarkComplete;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={[styles.title, { color: themeColors.textPrimary }]}>{title}</Text>

      {isCompleted ? (
        <>
          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: themeColors.surfaceAlt }]}>
              <Text style={[styles.chipText, { color: themeColors.textSecondary }]}>
                {department}
              </Text>
            </View>
            {category ? (
              <View style={[styles.chip, { backgroundColor: themeColors.surfaceAlt }]}>
                <Text style={[styles.chipText, { color: themeColors.textSecondary }]}>
                  {category}
                </Text>
              </View>
            ) : null}
          </View>
          {completedByLine ? (
            <Text style={[styles.completedBy, { color: themeColors.textSecondary }]}>
              {completedByLine}
            </Text>
          ) : null}
          {notes ? (
            <Text style={[styles.completedNotes, { color: themeColors.textPrimary }]}>{notes}</Text>
          ) : null}
        </>
      ) : (
        <View style={styles.details}>
          <DetailRow
            label={dateLabel ?? 'Date'}
            value={dateValue}
            valueColor={dateIsOverdue ? COLORS.danger : undefined}
          />
          <DetailRow label="Department" value={department} asBadge />
          <DetailRow label="Category" value={category} />
          <DetailRow label="Recurring" value={recurring} />
          <DetailRow label="Notes" value={notes} />
        </View>
      )}

      {onMarkComplete ? (
        <TouchableOpacity
          style={[styles.primaryAction, { backgroundColor: themeColors.controlSelected }]}
          onPress={onMarkComplete}
          activeOpacity={0.76}
          accessibilityRole="button"
          accessibilityLabel="Mark Complete"
        >
          <Text style={[styles.primaryActionText, { color: themeColors.textOnAccent }]}>
            Mark Complete
          </Text>
        </TouchableOpacity>
      ) : null}

      {onUnmarkComplete ? (
        <TouchableOpacity
          style={[
            styles.secondaryAction,
            { borderColor: themeColors.isDark ? COLORS.white : COLORS.primary },
          ]}
          onPress={onUnmarkComplete}
          activeOpacity={0.76}
          accessibilityRole="button"
          accessibilityLabel="Unmark Complete"
        >
          <Text
            style={[
              styles.secondaryActionText,
              { color: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
          >
            Unmark Complete
          </Text>
        </TouchableOpacity>
      ) : null}

      <PreviewActionButtons onEdit={onEdit} onDelete={onDelete} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    lineHeight: 27,
    marginBottom: SPACING.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  chip: {
    borderRadius: BORDER_RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: FONTS.sm,
    fontWeight: '500',
  },
  completedBy: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  completedNotes: {
    fontSize: FONTS.base,
    lineHeight: 22,
    marginBottom: SPACING.sm,
  },
  details: {
    gap: SPACING.md,
  },
  detailRow: {
    alignItems: 'flex-start',
  },
  detailLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: FONTS.base,
    lineHeight: 22,
  },
  detailBadge: {
    borderRadius: BORDER_RADIUS.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  detailBadgeText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  primaryAction: {
    minHeight: 48,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  primaryActionText: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  secondaryAction: {
    minHeight: 48,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  secondaryActionText: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
});
