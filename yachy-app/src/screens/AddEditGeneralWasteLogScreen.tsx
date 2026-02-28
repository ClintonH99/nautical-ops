/**
 * Add / Edit General Waste Log Screen
 * Fields: Date, Time, Position / Location, Description of Garbage
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import generalWasteLogsService from '../services/generalWasteLogs';
import { WeightUnit } from '../types';
import { Input, Button } from '../components';

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

export const AddEditGeneralWasteLogScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const logId = route.params?.logId as string | undefined;
  const isEdit = !!logId;

  const now = new Date();
  const [date, setDate] = useState<Date>(now);
  const [time, setTime] = useState<Date>(now);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [positionLocation, setPositionLocation] = useState('');
  const [descriptionOfGarbage, setDescriptionOfGarbage] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kgs');
  const [loading, setLoading] = useState(!!logId);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Entry' : 'New Waste Log Entry' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!logId) return;
    (async () => {
      try {
        const log = await generalWasteLogsService.getById(logId);
        if (log) {
          setDate(new Date(log.logDate));
          const [hh, mm] = log.logTime.split(':').map(Number);
          const t = new Date();
          t.setHours(hh, mm, 0, 0);
          setTime(t);
          setPositionLocation(log.positionLocation);
          setDescriptionOfGarbage(log.descriptionOfGarbage);
          setWeight(log.weight != null ? String(log.weight) : '');
          setWeightUnit((log.weightUnit as WeightUnit) ?? 'kgs');
        }
      } catch {
        Alert.alert('Error', 'Could not load entry.');
      } finally {
        setLoading(false);
      }
    })();
  }, [logId]);

  const handleSave = async () => {
    if (!vesselId) {
      Alert.alert('Error', 'You must be in a vessel to add log entries.');
      return;
    }
    if (!positionLocation.trim()) {
      Alert.alert('Required', 'Please enter a position or location.');
      return;
    }
    if (!descriptionOfGarbage.trim()) {
      Alert.alert('Required', 'Please enter a description of garbage.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        const parsedWeight = weight.trim() ? parseFloat(weight) : null;
        await generalWasteLogsService.update(logId!, {
          logDate: formatDate(date),
          logTime: formatTime(time),
          positionLocation: positionLocation.trim(),
          descriptionOfGarbage: descriptionOfGarbage.trim(),
          weight: parsedWeight != null && !isNaN(parsedWeight) ? parsedWeight : null,
          weightUnit,
        });
        Alert.alert('Updated', 'Entry updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        const parsedWeight = weight.trim() ? parseFloat(weight) : null;
        await generalWasteLogsService.create({
          vesselId,
          logDate: formatDate(date),
          logTime: formatTime(time),
          positionLocation: positionLocation.trim(),
          descriptionOfGarbage: descriptionOfGarbage.trim(),
          weight: parsedWeight != null && !isNaN(parsedWeight) ? parsedWeight : null,
          weightUnit,
          createdByName: user?.name ?? '',
        });
        Alert.alert('Saved', 'Entry added.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch {
      Alert.alert('Error', 'Could not save entry.');
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to add waste log entries.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Date */}
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Date</Text>
          {Platform.OS === 'ios' ? (
            <View style={[styles.pickerTrigger, { backgroundColor: themeColors.surface }]}>
              <Text style={[styles.pickerValue, { color: themeColors.textPrimary }]}>{formatDate(date)}</Text>
              <DateTimePicker
                value={date}
                mode="date"
                display="compact"
                onChange={(_: DateTimePickerEvent, selected?: Date) => {
                  if (selected) setDate(selected);
                }}
              />
            </View>
          ) : (
            <>
              <TouchableOpacity style={[styles.pickerTrigger, { backgroundColor: themeColors.surface }]} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
                <Text style={[styles.pickerValue, { color: themeColors.textPrimary }]}>{formatDate(date)}</Text>
                <Text style={styles.pickerIcon}>📅</Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  display="default"
                  onChange={(_: DateTimePickerEvent, selected?: Date) => {
                    setShowDatePicker(false);
                    if (selected) setDate(selected);
                  }}
                />
              )}
            </>
          )}
        </View>

        {/* Time */}
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Time</Text>
          {Platform.OS === 'ios' ? (
            <View style={[styles.pickerTrigger, { backgroundColor: themeColors.surface }]}>
              <Text style={[styles.pickerValue, { color: themeColors.textPrimary }]}>{formatTime(time)}</Text>
              <DateTimePicker
                value={time}
                mode="time"
                display="compact"
                onChange={(_: DateTimePickerEvent, selected?: Date) => {
                  if (selected) setTime(selected);
                }}
              />
            </View>
          ) : (
            <>
              <TouchableOpacity style={[styles.pickerTrigger, { backgroundColor: themeColors.surface }]} onPress={() => setShowTimePicker(true)} activeOpacity={0.7}>
                <Text style={[styles.pickerValue, { color: themeColors.textPrimary }]}>{formatTime(time)}</Text>
                <Text style={styles.pickerIcon}>🕐</Text>
              </TouchableOpacity>
              {showTimePicker && (
                <DateTimePicker
                  value={time}
                  mode="time"
                  is24Hour
                  display="default"
                  onChange={(_: DateTimePickerEvent, selected?: Date) => {
                    setShowTimePicker(false);
                    if (selected) setTime(selected);
                  }}
                />
              )}
            </>
          )}
        </View>

        {/* Position / Location */}
        <Input
          label="Position / Location"
          value={positionLocation}
          onChangeText={setPositionLocation}
          placeholder="e.g. 25°N 80°W or Port Miami"
        />

        {/* Weight */}
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Weight</Text>
          <View style={styles.weightRow}>
            <Input
              value={weight}
              onChangeText={setWeight}
              placeholder="e.g. 5.2"
              keyboardType="decimal-pad"
              containerStyle={styles.weightInput}
            />
            <View style={[styles.unitSelector, { backgroundColor: themeColors.surface }]}>
              <TouchableOpacity
                style={[styles.unitBtn, weightUnit === 'kgs' && styles.unitBtnSelected]}
                onPress={() => setWeightUnit('kgs')}
                activeOpacity={0.7}
              >
                <Text style={[styles.unitLabel, { color: themeColors.textSecondary }, weightUnit === 'kgs' && styles.unitLabelSelected]}>kgs</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitBtn, weightUnit === 'lbs' && styles.unitBtnSelected]}
                onPress={() => setWeightUnit('lbs')}
                activeOpacity={0.7}
              >
                <Text style={[styles.unitLabel, { color: themeColors.textSecondary }, weightUnit === 'lbs' && styles.unitLabelSelected]}>lbs</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Description of Garbage */}
        <Input
          label="Description of Garbage"
          value={descriptionOfGarbage}
          onChangeText={setDescriptionOfGarbage}
          placeholder="Describe the type and amount of garbage..."
          multiline
          numberOfLines={4}
        />

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Update Entry' : 'Save Entry'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => navigation.goBack()}
            disabled={saving}
          >
            <Text style={[styles.cancelText, { color: themeColors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    textAlign: 'center',
  },
  fieldContainer: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  pickerValue: {
    fontSize: FONTS.base,
  },
  pickerIcon: {
    fontSize: 18,
  },
  actions: {
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  cancelBtn: {
    alignSelf: 'center',
    padding: SPACING.sm,
  },
  cancelText: {
    fontSize: FONTS.base,
  },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
  },
  weightInput: {
    flex: 1,
    marginBottom: 0,
  },
  unitSelector: {
    flexDirection: 'row',
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  unitBtn: {
    flex: 1,
    minWidth: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unitBtnSelected: {
    backgroundColor: COLORS.primary,
  },
  unitLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  unitLabelSelected: {
    color: COLORS.white,
  },
});
