/**
 * Custom Calendar Day with pie-chart segments when multiple tasks on same date
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const SIZE = 32;
const RADIUS = 15;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** Convert angle in degrees to SVG coordinates (0° = 3 o'clock, clockwise) */
function polarToCartesian(angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0° starts at top
  return {
    x: CX + RADIUS * Math.cos(rad),
    y: CY + RADIUS * Math.sin(rad),
  };
}

function describePieSlice(startAngle: number, endAngle: number) {
  const start = polarToCartesian(startAngle);
  const end = polarToCartesian(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export interface PieDayProps {
  date?: { dateString: string };
  theme?: Record<string, unknown>;
  marking?: {
    selected?: boolean;
    selectedColor?: string;
    selectedTextColor?: string;
    segmentColors?: string[];
    disableTouchEvent?: boolean;
  };
  state?: string;
  onPress?: (date: { dateString: string }) => void;
  onLongPress?: (date: { dateString: string }) => void;
  children?: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

export const PieDayComponent: React.FC<PieDayProps> = ({
  date,
  marking = {},
  theme = {},
  state,
  onPress,
  onLongPress,
  children,
  accessibilityLabel,
  testID,
}) => {
  const segmentColors = marking.segmentColors ?? [];
  const isSelected = marking.selected || state === 'selected';
  const isToday = state === 'today';
  const isDisabled = marking.disableTouchEvent || state === 'disabled';
  const isInactive = state === 'inactive';

  const dateData = date ? { dateString: date.dateString } : undefined;

  const handlePress = () => {
    if (!isDisabled && onPress && dateData) onPress(dateData);
  };

  const handleLongPress = () => {
    if (!isDisabled && onLongPress && dateData) onLongPress(dateData);
  };

  // Pie chart: multiple segments
  if (segmentColors.length > 1) {
    const sliceAngle = 360 / segmentColors.length;
    const selectedColor = (theme as Record<string, string>).selectedDayBackgroundColor ?? '#4A90D9';
    const selectedTextColor = (theme as Record<string, string>).selectedDayTextColor ?? '#FFFFFF';
    const textColor = isSelected ? selectedTextColor : (theme as Record<string, string>).dayTextColor ?? '#333';

    return (
      <TouchableOpacity
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={handlePress}
        onLongPress={handleLongPress}
        disabled={isDisabled}
        activeOpacity={0.7}
        style={{
          width: SIZE,
          height: SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ position: 'absolute', width: SIZE, height: SIZE }}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            {segmentColors.map((color, i) => {
              const startAngle = i * sliceAngle;
              const endAngle = (i + 1) * sliceAngle;
              const d = describePieSlice(startAngle, endAngle);
              return <Path key={i} d={d} fill={color} stroke="#fff" strokeWidth={0.5} />;
            })}
          </Svg>
        </View>
        <Text
          allowFontScaling={false}
          style={{
            fontSize: (theme as Record<string, number>)?.textDayFontSize ?? 14,
            fontWeight: ((theme as Record<string, string>)?.textDayFontWeight ?? '400') as '400',
            color: textColor,
            backgroundColor: 'transparent',
          }}
        >
          {children}
        </Text>
      </TouchableOpacity>
    );
  }

  // Single color or no marking: use standard filled circle
  const bgColor =
    segmentColors.length === 1
      ? segmentColors[0]
      : isSelected
        ? (marking.selectedColor ?? (theme as Record<string, string>).selectedDayBackgroundColor ?? '#4A90D9')
        : isToday
          ? (theme as Record<string, string>).todayBackgroundColor
          : undefined;
  const textColor =
    segmentColors.length === 1 || isSelected
      ? marking.selectedTextColor ?? (theme as Record<string, string>).selectedDayTextColor ?? '#FFFFFF'
      : isDisabled
        ? (theme as Record<string, string>).textDisabledColor
        : isInactive
          ? (theme as Record<string, string>).textInactiveColor
          : isToday
            ? (theme as Record<string, string>).todayTextColor
            : (theme as Record<string, string>).dayTextColor ?? '#333';

  return (
    <TouchableOpacity
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={handlePress}
      onLongPress={handleLongPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bgColor,
        marginTop: 4,
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: (theme as Record<string, number>)?.textDayFontSize ?? 14,
          fontWeight: ((theme as Record<string, string>)?.textDayFontWeight ?? '400') as '400',
          color: textColor,
          backgroundColor: 'transparent',
        }}
      >
        {children}
      </Text>
    </TouchableOpacity>
  );
};
