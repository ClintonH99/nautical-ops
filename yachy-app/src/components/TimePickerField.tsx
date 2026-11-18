import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Keyboard,
  Pressable,
  ScrollView,
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

const ROW_HEIGHT = 44;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** Shared wheel: ordinary scroll events work on web as well as native momentum. */
const TimeWheel = ({
  values,
  selected,
  onSelect,
  label,
}: {
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
  label: string;
}) => {
  const colors = useThemeColors();
  const scroll = useRef<ScrollView>(null);
  const initialOffset = useRef({ x: 0, y: selected * ROW_HEIGHT }).current;
  const latestOffset = useRef(initialOffset.y);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSettle = () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  };
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    []
  );
  const indexAt = (offset: number) =>
    Math.max(0, Math.min(values.length - 1, Math.round(offset / ROW_HEIGHT)));
  const align = (index: number) => {
    clearSettle();
    latestOffset.current = index * ROW_HEIGHT;
    scroll.current?.scrollTo({ y: latestOffset.current, animated: false });
  };
  const select = (index: number) => {
    const bounded = Math.max(0, Math.min(values.length - 1, index));
    onSelect(values[bounded]);
    align(bounded);
  };

  return (
    <View
      style={styles.wheelColumn}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: 0,
        max: values.length - 1,
        now: selected,
        text: formatPart(selected),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'increment') select(selected + 1);
        if (nativeEvent.actionName === 'decrement') select(selected - 1);
      }}
    >
      <ScrollView
        ref={scroll}
        testID={`time-wheel-${label.toLowerCase()}`}
        style={styles.wheelScroll}
        contentContainerStyle={styles.wheelContent}
        contentOffset={initialOffset}
        onContentSizeChange={() => align(selected)}
        onLayout={() => align(selected)}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        bounces={false}
        snapToInterval={ROW_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const offset = nativeEvent.contentOffset.y;
          if (!Number.isFinite(offset)) return;
          latestOffset.current = offset;
          onSelect(values[indexAt(offset)]);
          // React Native Web does not reliably emit native drag/momentum-end events.
          // Record the selection during scrolling, then align when scrolling is idle.
          if (Platform.OS === 'web') {
            clearSettle();
            settleTimer.current = setTimeout(() => {
              const index = indexAt(latestOffset.current);
              if (Math.abs(latestOffset.current - index * ROW_HEIGHT) > 0.5) align(index);
            }, 180);
          }
        }}
        onMomentumScrollEnd={({ nativeEvent }) => select(indexAt(nativeEvent.contentOffset.y))}
      >
        {values.map((item) => {
          const distance = Math.abs(item - selected);
          return (
            <TouchableOpacity
              key={item}
              onPress={() => select(item)}
              style={styles.wheelRow}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${formatPart(item)}`}
              accessibilityState={{ selected: item === selected }}
            >
              <Text
                style={[
                  styles.wheelNumber,
                  {
                    color: colors.textPrimary,
                    opacity: distance === 0 ? 1 : distance === 1 ? 0.55 : 0.22,
                    transform: [{ scaleY: distance === 0 ? 1 : distance === 1 ? 0.9 : 0.72 }],
                  },
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
  const done = () => {
    const next = new Date(value);
    next.setHours(hour, minute, 0, 0);
    onDone(next);
  };

  return (
    <View style={styles.sheetContent}>
      <View style={[styles.grabber, { backgroundColor: themeColors.border }]} />
      <Text style={[styles.sheetTitle, { color: themeColors.textPrimary }]}>{title}</Text>

      <View style={styles.wheelWrap}>
        <View
          pointerEvents="none"
          style={[styles.selectionBand, { backgroundColor: themeColors.surfaceAlt }]}
        />
        <TimeWheel values={HOURS} selected={hour} onSelect={setHour} label="Hour" />
        <Text style={[styles.colon, { color: themeColors.textPrimary }]}>:</Text>
        <TimeWheel values={MINUTES} selected={minute} onSelect={setMinute} label="Minute" />
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
    height: ROW_HEIGHT * 5,
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
  },
  selectionBand: {
    position: 'absolute',
    top: ROW_HEIGHT * 2,
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    borderRadius: BORDER_RADIUS.md,
  },
  wheelColumn: { flex: 1, height: ROW_HEIGHT * 5, overflow: 'hidden' },
  wheelScroll: { height: ROW_HEIGHT * 5 },
  wheelContent: { paddingVertical: ROW_HEIGHT * 2 },
  wheelRow: { height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  wheelNumber: { fontSize: 28, fontWeight: '400', fontVariant: ['tabular-nums'] },
  colon: { width: 24, textAlign: 'center', fontSize: 28 },
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
