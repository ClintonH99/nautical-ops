import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { Button } from './Button';
import { Input } from './Input';

interface FuelVoidReasonModalProps {
  visible: boolean;
  title: string;
  description: string;
  reason: string;
  onChangeReason: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  submitting?: boolean;
}

/**
 * Explicit confirmation used for audit-preserving fuel voids. A free-text
 * reason is mandatory because the original record remains discoverable.
 */
export function FuelVoidReasonModal({
  visible,
  title,
  description,
  reason,
  onChangeReason,
  onCancel,
  onConfirm,
  submitting = false,
}: FuelVoidReasonModalProps) {
  const themeColors = useThemeColors();
  const cancel = () => {
    if (!submitting) onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close void confirmation"
          style={StyleSheet.absoluteFill}
          onPress={cancel}
        />
        <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
          <View style={[styles.icon, { backgroundColor: themeColors.surfaceAlt }]}>
            <Ionicons name="warning-outline" size={26} color={COLORS.danger} />
          </View>
          <Text style={[styles.title, { color: themeColors.textPrimary }]}>{title}</Text>
          <Text style={[styles.description, { color: themeColors.textSecondary }]}>
            {description}
          </Text>
          <Input
            label="Reason for voiding"
            value={reason}
            onChangeText={onChangeReason}
            placeholder="Required: explain why this record is invalid"
            multiline
            maxLength={2000}
            editable={!submitting}
          />
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="outline"
              onPress={cancel}
              disabled={submitting}
              style={styles.action}
            />
            <Button
              title="Void Record"
              variant="danger"
              onPress={onConfirm}
              loading={submitting}
              disabled={!reason.trim()}
              style={styles.action}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  title: { fontSize: FONTS.xl, fontWeight: '800', marginBottom: SPACING.sm },
  description: { fontSize: FONTS.sm, lineHeight: 20, marginBottom: SPACING.md },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  action: { flex: 1 },
});
