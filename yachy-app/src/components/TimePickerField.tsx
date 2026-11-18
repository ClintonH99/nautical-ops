import React, { useState } from 'react';
import {
  Modal,
  Keyboard,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BORDER_RADIUS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

function formatPart(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTimePickerValue(value: Date): string {
  return `${formatPart(value.getHours())}:${formatPart(value.getMinutes())}`;
}

export type TimePickerTriggerProps = {
  label: string;
  value: Date;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export const TimePickerTrigger = ({
  label,
  value,
  onPress,
  disabled = false,
  active = false,
  containerStyle,
  testID,
}: TimePickerTriggerProps) => {
  const themeColors = useThemeColors();

  return (
    <View style={containerStyle}>
      <Text style={[styles.label, { color: themeColors.textPrimary }]}>{label}</Text>
      <TouchableOpacity
        testID={testID}
        style={[
          styles.trigger,
          {
            backgroundColor: themeColors.control,
            borderColor: active ? themeColors.controlSelected : themeColors.border,
          },
          active && { shadowColor: themeColors.controlSelected },
          disabled && styles.disabled,
        ]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatTimePickerValue(value)}`}
        accessibilityHint="Opens the time selector"
      >
        <Text style={[styles.value, { color: themeColors.textPrimary }]}>
          {formatTimePickerValue(value)}
        </Text>
        <Ionicons name="time-outline" size={20} color={themeColors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
};

export type TimePickerSheetContentProps = {
  title: string;
  value: Date;
  onCancel: () => void;
  onDone: (value: Date) => void;
};

export const TimePickerSheetContent = ({
  title,
  value,
  onCancel,
  onDone,
}: TimePickerSheetContentProps) => {
  const themeColors = useThemeColors();
  const [hour, setHour] = useState(formatPart(value.getHours()));
  const [minute, setMinute] = useState(formatPart(value.getMinutes()));
  const [error, setError] = useState('');
  const done = () => {
    if (
      !/^\d{1,2}$/.test(hour) ||
      !/^\d{1,2}$/.test(minute) ||
      Number(hour) > 23 ||
      Number(minute) > 59
    ) {
      setError('Enter an hour from 00 to 23 and minutes from 00 to 59.');
      return;
    }
    const next = new Date(value);
    next.setHours(Number(hour), Number(minute), 0, 0);
    onDone(next);
  };

  return (
    <View style={styles.sheetContent}>
      <View style={[styles.grabber, { backgroundColor: themeColors.border }]} />
      <Text style={[styles.sheetTitle, { color: themeColors.textPrimary }]}>{title}</Text>

      <View style={styles.timeInputs}>
        {[
          { label: 'Hour (00–23)', text: hour, setText: setHour },
          { label: 'Minute (00–59)', text: minute, setText: setMinute },
        ].map(({ label, text, setText }) => (
          <View key={label} style={styles.timeInputColumn}>
            <Text style={[styles.label, { color: themeColors.textPrimary }]}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              value={text}
              onChangeText={(draft) => {
                setText(draft);
                setError('');
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              selectTextOnFocus
              onSubmitEditing={done}
              style={[
                styles.timeInput,
                {
                  color: themeColors.textPrimary,
                  backgroundColor: themeColors.control,
                  borderColor: themeColors.borderStrong,
                },
              ]}
            />
          </View>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: themeColors.textPrimary }}>
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { borderColor: themeColors.borderStrong }]}
          onPress={onCancel}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={[styles.actionText, { color: themeColors.textPrimary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            {
              backgroundColor: themeColors.controlSelected,
              borderColor: themeColors.controlSelected,
            },
          ]}
          onPress={done}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={[styles.actionText, { color: themeColors.textOnAccent }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export type TimePickerFieldProps = {
  label: string;
  value: Date;
  onChange: (value: Date) => void;
  title?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export const TimePickerField = ({
  label,
  value,
  onChange,
  title = `Select ${label}`,
  disabled = false,
  containerStyle,
  testID,
}: TimePickerFieldProps) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TimePickerTrigger
        label={label}
        value={value}
        onPress={() => {
          Keyboard.dismiss();
          setVisible(true);
        }}
        disabled={disabled}
        active={visible}
        containerStyle={containerStyle}
        testID={testID}
      />

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => setVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.overlay,
            {
              backgroundColor: themeColors.isDark ? 'rgba(0,0,0,0.64)' : 'rgba(15,23,42,0.48)',
            },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: themeColors.surfaceElevated,
                borderColor: themeColors.border,
                paddingBottom: Math.max(insets.bottom, SPACING.lg),
              },
            ]}
          >
            <TimePickerSheetContent
              key={`${value.getHours()}:${value.getMinutes()}:${visible ? 'open' : 'closed'}`}
              title={title}
              value={value}
              onCancel={() => setVisible(false)}
              onDone={(selected) => {
                onChange(selected);
                setVisible(false);
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  trigger: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  disabled: { opacity: 0.55 },
  value: { fontSize: FONTS.base, fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  sheetContent: { width: '100%' },
  grabber: {
    width: 42,
    height: 5,
    borderRadius: BORDER_RADIUS.full,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  sheetTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  timeInputs: { flexDirection: 'row', gap: SPACING.md, marginVertical: SPACING.md },
  timeInputColumn: { flex: 1 },
  timeInput: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    textAlign: 'center',
    fontSize: FONTS.xl,
  },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: FONTS.base, fontWeight: '700' },
});
