import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { FONTS, SPACING } from '../constants/theme';
import { logMonthLabel } from '../utils/vesselLogHistory';

export function VesselLogPeriodBar({
  month,
  onHistory,
}: {
  month: string;
  onHistory?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.month, { color: colors.textPrimary }]}>{logMonthLabel(month)}</Text>
      {onHistory ? (
        <Button title="History" variant="outline" size="small" onPress={onHistory} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg },
  month: { flex: 1, fontSize: FONTS.lg, fontWeight: '600' },
});
