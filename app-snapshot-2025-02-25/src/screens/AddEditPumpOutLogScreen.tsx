/**
 * Add / Edit Pump Out Log Screen
 * Fields: Discharge Type (Direct Discharge / Treatment Plant / Pumpout Service),
 *         Pumpout Service Name (if applicable), Location, Amount in Gallons, Date, Time
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
  TextInput,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import pumpOutLogsService from '../services/pumpOutLogs';
import { DischargeType } from '../types';
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

const DISCHARGE_OPTIONS: { value: DischargeType; label: string }[] = [
  { value: 'DIRECT_DISCHARGE', label: 'Direct Discharge' },
  { value: 'TREATMENT_PLANT', label: 'Treatment Plant Discharge' },
  { value: 'PUMPOUT_SERVICE', label: 'Pumpout Service' },
];

export const AddEditPumpOutLogScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const logId = route.params?.logId as string | undefined;
  const isEdit = !!logId;

  const now = new Date();
  const [dischargeType, setDischargeType] = useState<DischargeType>('DIRECT_DISCHARGE');
  const [pumpoutServiceName, setPumpoutServiceName] = useState('');
  const [location, setLocation] = useState('');
  const [amountInGallons, setAmountInGallons] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date>(now);
  const [time, setTime] = useState<Date>(now);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(!!logId);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Pump Out Entry' : 'New Pump Out Entry' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!logId) return;
    (async () => {
      try {
        const log = await pumpOutLogsService.getById(logId);
        if (log) {
          setDischargeType(log.dischargeType);
          setPumpoutServiceName(log.pumpoutServiceName);
          setLocation(log.location);
          setAmountInGallons(String(log.amountInGallons));
          setDescription(log.description);
          setDate(new Date(log.logDate));
          const [hh, mm] = log.logTime.split(':').map(Number);
          const t = new Date();
          t.setHours(hh, mm, 0, 0);
          setTime(t);
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
    if (!location.trim()) {
      Alert.alert('Required', 'Please enter a location.');
      return;
    }
    const parsedAmount = parseFloat(amountInGallons);
    if (!amountInGallons || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid amount in gallons.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await pumpOutLogsService.update(logId!, {
          dischargeType,
          pumpoutServiceName: dischargeType === 'PUMPOUT_SERVICE' ? pumpoutServiceName : '',
          location: location.trim(),
          amountInGallons: parsedAmount,
          description: description.trim(),
          logDate: formatDate(date),
          logTime: formatTime(time),
        });
        Alert.alert('Updated', 'Entry updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await pumpOutLogsService.create({
          vesselId,
          dischargeType,
          pumpoutServiceName: dischargeType === 'PUMPOUT_SERVICE' ? pumpoutServiceName : '',
          location: location.trim(),
          amountInGallons: parsedAmount,
          description: description.trim(),
          logDate: formatDate(date),
          logTime: formatTime(time),
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to add pump out log entries.</Text>
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

        {/* Discharge Type selector */}
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Discharge Type</Text>
          <View style={styles.optionsCol}>
            {DISCHARGE_OPTIONS.map((opt) => {
              const selected = dischargeType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionRow, { backgroundColor: themeColors.surface }, selected && styles.optionRowSelected]}
                  onPress={() => setDischargeType(opt.value)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.optionLabel, { color: themeColors.textSecondary }, selected && styles.optionLabelSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Pumpout Service Name — only shown when Pumpout Service is selected */}
        {dischargeType === 'PUMPOUT_SERVICE' && (
          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: themeColors.textPrimary }]}>Pumpout Service</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={pumpoutServiceName}
              onChangeText={setPumpoutServiceName}
              placeholder="Pumpout Truck or Marina Pumpout"
              placeholderTextColor={COLORS.gray400}
              autoCapitalize="words"
            />
          </View>
        )}

        {/* Location */}
        <Input
          label="Location"
          value={location}
          onChangeText={setLocation}
          placeholder="e.g. Port Miami, Dock B"
        />

        {/* Amount in Gallons */}
        <Input
          label="Amount (gallons)"
          value={amountInGallons}
          onChangeText={setAmountInGallons}
          placeholder="e.g. 150"
          keyboardType="decimal-pad"
        />

        {/* Description (optional) */}
        <Input
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="Tipped the dockhand $20"
          placeholderTextColor={COLORS.gray300}
          multiline
          numberOfLines={3}
        />

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
  optionsCol: {
    gap: SPACING.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  optionRowSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '08',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.gray300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: COLORS.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  optionLabel: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  optionLabelSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  textInput: {
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.base,
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
});
