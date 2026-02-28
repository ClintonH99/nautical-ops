/**
 * Add / Edit Fuel Log Screen
 * Fields: Location of Refueling, Date, Time, Amount of Fuel, Price per Gallon, Total Price (auto-calculated)
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
import fuelLogsService from '../services/fuelLogs';
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

export const AddEditFuelLogScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const logId = route.params?.logId as string | undefined;
  const isEdit = !!logId;

  const now = new Date();
  const [date, setDate] = useState<Date>(now);
  const [time, setTime] = useState<Date>(now);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [locationOfRefueling, setLocationOfRefueling] = useState('');
  const [amountOfFuel, setAmountOfFuel] = useState('');
  const [pricePerGallon, setPricePerGallon] = useState('');
  const [totalPriceInput, setTotalPriceInput] = useState('');
  const [loading, setLoading] = useState(!!logId);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;


  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Fuel Entry' : 'New Fuel Log Entry' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!logId) return;
    (async () => {
      try {
        const log = await fuelLogsService.getById(logId);
        if (log) {
          setDate(new Date(log.logDate));
          const [hh, mm] = log.logTime.split(':').map(Number);
          const t = new Date();
          t.setHours(hh, mm, 0, 0);
          setTime(t);
          setLocationOfRefueling(log.locationOfRefueling);
          setAmountOfFuel(String(log.amountOfFuel));
          setPricePerGallon(String(log.pricePerGallon));
          setTotalPriceInput(String(log.totalPrice));
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
    if (!locationOfRefueling.trim()) {
      Alert.alert('Required', 'Please enter a location of refueling.');
      return;
    }
    const parsedAmount = parseFloat(amountOfFuel);
    if (!amountOfFuel || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid amount of fuel.');
      return;
    }
    let parsedPrice = parseFloat(pricePerGallon);
    let parsedTotal = parseFloat(totalPriceInput);
    if (!isNaN(parsedTotal) && parsedTotal > 0 && parsedAmount > 0) {
      parsedPrice = parsedTotal / parsedAmount;
    } else if (isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Required', 'Please enter either price per gallon or total price.');
      return;
    }
    parsedTotal = parsedAmount * parsedPrice;

    setSaving(true);
    try {
      if (isEdit) {
        await fuelLogsService.update(logId!, {
          locationOfRefueling: locationOfRefueling.trim(),
          logDate: formatDate(date),
          logTime: formatTime(time),
          amountOfFuel: parsedAmount,
          pricePerGallon: parsedPrice,
          totalPrice: parsedTotal,
        });
        Alert.alert('Updated', 'Entry updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await fuelLogsService.create({
          vesselId,
          locationOfRefueling: locationOfRefueling.trim(),
          logDate: formatDate(date),
          logTime: formatTime(time),
          amountOfFuel: parsedAmount,
          pricePerGallon: parsedPrice,
          totalPrice: parsedTotal,
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to add fuel log entries.</Text>
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
        {/* Location of Refueling */}
        <Input
          label="Location of Refueling"
          value={locationOfRefueling}
          onChangeText={setLocationOfRefueling}
          placeholder="e.g. Port Miami Marina"
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

        {/* Amount of Fuel */}
        <Input
          label="Amount of Fuel (gallons)"
          value={amountOfFuel}
          onChangeText={setAmountOfFuel}
          placeholder="e.g. 250"
          keyboardType="decimal-pad"
        />

        {/* Price per Gallon — enter this OR total price; the other is calculated */}
        <Input
          label="Price per Gallon ($)"
          value={pricePerGallon}
          onChangeText={(text) => {
            setPricePerGallon(text);
            const amt = parseFloat(amountOfFuel);
            const val = parseFloat(text);
            if (!isNaN(amt) && !isNaN(val) && amt > 0) {
              setTotalPriceInput((amt * val).toFixed(2));
            }
          }}
          placeholder="e.g. 4.50"
          keyboardType="decimal-pad"
        />

        {/* Total Price — enter this OR price per gallon; the other is calculated */}
        <Input
          label="Total Price ($)"
          value={totalPriceInput}
          onChangeText={(text) => {
            setTotalPriceInput(text);
            const amt = parseFloat(amountOfFuel);
            const val = parseFloat(text);
            if (!isNaN(amt) && !isNaN(val) && amt > 0) {
              setPricePerGallon((val / amt).toFixed(2));
            }
          }}
          placeholder="e.g. 1125.00"
          keyboardType="decimal-pad"
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
});
