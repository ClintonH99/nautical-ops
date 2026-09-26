import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { useInventoryAutoSave } from '../hooks/useInventoryAutoSave';
import { FONTS, SPACING } from '../constants/theme';

export function InventoryAutoSaveControl() {
  const { state, queue } = useInventoryAutoSave();
  const theme = useThemeColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>
        Auto Save {state.enabled ? 'On' : 'Off'}
      </Text>
      <Button
        title={state.enabled ? 'Disable Auto Save' : 'Enable Auto Save'}
        variant="outline"
        size="small"
        disabled={!state.ready}
        onPress={() => {
          void queue.setEnabled(!state.enabled);
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  label: { fontSize: FONTS.sm, fontWeight: '600' },
});
