import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Keyboard,
  Pressable,
  ScrollView,
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

const WHEEL_ITEM_HEIGHT = 44;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);

function formatPart(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTimePickerValue(value: Date): string {
  return `${formatPart(value.getHours())}:${formatPart(value.getMinutes())}`;
}

type TimeWheelColumnProps = {
  values: number[];
  selectedValue: number;
  onSelect: (value: number) => void;
  accessibilityLabel: string;
};

const TimeWheelColumn = ({
  values,
  selectedValue,
  onSelect,
  accessibilityLabel,
}: TimeWheelColumnProps) => {
  const themeColors = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, values.indexOf(selectedValue));

  const selectFromOffset = (offsetY: number) => {
    const nextIndex = Math.max(
      0,
      Math.min(values.length - 1, Math.round(offsetY / WHEEL_ITEM_HEIGHT))
    );
    onSelect(values[nextIndex]);
  };

  return (
    <View style={styles.wheelColumnWrap} accessibilityLabel={accessibilityLabel}>
      <ScrollView
        ref={scrollRef}
        style={styles.wheelColumn}
        contentContainerStyle={styles.wheelColumnContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        contentOffset={{ x: 0, y: selectedIndex * WHEEL_ITEM_HEIGHT }}
        onMomentumScrollEnd={(event) => selectFromOffset(event.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(event) => selectFromOffset(event.nativeEvent.contentOffset.y)}
      >
        {values.map((item) => {
          const selected = item === selectedValue;
          return (
            <TouchableOpacity
              key={item}
              activeOpacity={0.7}
              style={styles.wheelItem}
              onPress={() => {
                onSelect(item);
                scrollRef.current?.scrollTo({
                  y: values.indexOf(item) * WHEEL_ITEM_HEIGHT,
                  animated: true,
                });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={formatPart(item)}
            >
              <Text
                style={[
                  styles.wheelItemText,
                  { color: selected ? themeColors.textPrimary : themeColors.textMuted },
                  selected && styles.wheelItemTextSelected,
                ]}
              >
                {formatPart(item)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

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
  const [hour, setHour] = useState(value.getHours());
  const [minute, setMinute] = useState(value.getMinutes());

  const selectedTime = useMemo(() => {
    const next = new Date(value);
    next.setHours(hour, minute, 0, 0);
    return next;
  }, [hour, minute, value]);

  return (
    <View style={styles.sheetContent}>
      <View style={[styles.grabber, { backgroundColor: themeColors.border }]} />
      <Text style={[styles.sheetTitle, { color: themeColors.textPrimary }]}>{title}</Text>

      <View style={styles.wheelWrap}>
        <View
          pointerEvents="none"
          style={[
            styles.selectionFrame,
            {
              borderColor: themeColors.border,
              backgroundColor: themeColors.surfaceAlt,
            },
          ]}
        />
        <TimeWheelColumn
          values={HOURS}
          selectedValue={hour}
          onSelect={setHour}
          accessibilityLabel="Hour"
        />
        <Text style={[styles.colon, { color: themeColors.textPrimary }]}>:</Text>
        <TimeWheelColumn
          values={MINUTES}
          selectedValue={minute}
          onSelect={setMinute}
          accessibilityLabel="Minute"
        />
      </View>

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
          onPress={() => onDone(selectedTime)}
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
        <View
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
        </View>
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
  wheelWrap: {
    height: WHEEL_ITEM_HEIGHT * 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: SPACING.sm,
  },
  selectionFrame: {
    position: 'absolute',
    top: WHEEL_ITEM_HEIGHT,
    left: SPACING.lg,
    right: SPACING.lg,
    height: WHEEL_ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderRadius: BORDER_RADIUS.sm,
  },
  wheelColumnWrap: { width: 86, height: WHEEL_ITEM_HEIGHT * 3 },
  wheelColumn: { height: WHEEL_ITEM_HEIGHT * 3 },
  wheelColumnContent: { paddingVertical: WHEEL_ITEM_HEIGHT },
  wheelItem: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: { fontSize: FONTS.base },
  wheelItemTextSelected: { fontSize: FONTS.xl, fontWeight: '700' },
  colon: { width: 24, textAlign: 'center', fontSize: FONTS.xl, fontWeight: '700' },
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
