/**
 * Add / Edit Trip Screen
 * Calendar to choose start and end dates; title and notes. HOD only.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import tripsService from '../services/trips';
import { TripType, Department } from '../types';
import { Input, Button } from '../components';
import { useVesselTripColors } from '../hooks/useVesselTripColors';
import { DEFAULT_COLORS } from '../services/tripColors';

type MarkedDates = { [date: string]: { startingDay?: boolean; endingDay?: boolean; color: string; textColor?: string } };

function getMarkedRange(start: string, end: string, color: string): MarkedDates {
  const marked: MarkedDates = {};
  const startD = new Date(start);
  const endD = new Date(end);
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    marked[key] = {
      startingDay: key === start,
      endingDay: key === end,
      color,
      textColor: COLORS.white,
    };
  }
  return marked;
}

export const AddEditTripScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const type = (route.params?.type ?? 'GUEST') as TripType;
  const tripId = route.params?.tripId as string | undefined;

  const typeLabels: Record<TripType, string> = {
    GUEST: 'Guest Trip',
    BOSS: 'Boss Trip',
    DELIVERY: 'Delivery',
    YARD_PERIOD: 'Yard Period',
  };
  const typeLabel = typeLabels[type] ?? type;
  useEffect(() => {
    navigation.setOptions({
      title: tripId ? `Edit ${typeLabel}` : `Add ${typeLabel}`,
    });
  }, [navigation, tripId, typeLabel]);

  const DEPARTMENT_OPTIONS: { value: Department | null; label: string }[] = [
    { value: null, label: 'Select' },
    { value: 'BRIDGE', label: 'Bridge' },
    { value: 'ENGINEERING', label: 'Engineering' },
    { value: 'EXTERIOR', label: 'Exterior' },
    { value: 'INTERIOR', label: 'Interior' },
    { value: 'GALLEY', label: 'Galley' },
  ];
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [department, setDepartment] = useState<Department | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [departmentModalVisible, setDepartmentModalVisible] = useState(false);
  const [loading, setLoading] = useState(!!tripId);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'start' | 'end'>('start');

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const isEdit = !!tripId;
  const { colors: tripColors, load: loadTripColors } = useVesselTripColors(vesselId);
  const typeColorMap = tripColors
    ? { GUEST: tripColors.guest, BOSS: tripColors.boss, DELIVERY: tripColors.delivery, YARD_PERIOD: tripColors.yardPeriod }
    : { GUEST: DEFAULT_COLORS.guest, BOSS: DEFAULT_COLORS.boss, DELIVERY: DEFAULT_COLORS.delivery, YARD_PERIOD: DEFAULT_COLORS.yardPeriod };
  const accentColor = typeColorMap[type] ?? COLORS.primary;

  useEffect(() => {
    if (vesselId) loadTripColors();
  }, [vesselId, loadTripColors]);

  useEffect(() => {
    if (!tripId) return;
    (async () => {
      try {
        const trip = await tripsService.getTripById(tripId);
        if (trip) {
          setTitle(trip.title);
          setNotes(trip.notes ?? '');
          setDepartment(trip.department ?? null);
          setStartDate(trip.startDate);
          setEndDate(trip.endDate);
        }
      } catch (e) {
        console.error('Load trip error:', e);
        Alert.alert('Error', 'Could not load trip');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId]);

  const onDayPress = (dateString: string) => {
    if (step === 'start') {
      setStartDate(dateString);
      setEndDate(dateString);
      setStep('end');
    } else {
      if (startDate && dateString < startDate) {
        setStartDate(dateString);
        setEndDate(startDate);
      } else {
        setEndDate(dateString);
      }
    }
  };

  const markedDates: MarkedDates = startDate && endDate
    ? getMarkedRange(startDate, endDate, accentColor)
    : {};

  const calendarTheme = {
    backgroundColor: COLORS.white,
    calendarBackground: COLORS.white,
    textSectionTitleColor: COLORS.textSecondary,
    selectedDayBackgroundColor: accentColor,
    selectedDayTextColor: COLORS.white,
    todayTextColor: COLORS.primary,
    dayTextColor: COLORS.textPrimary,
    textDisabledColor: COLORS.gray400,
    arrowColor: COLORS.primary,
    monthTextColor: COLORS.primary,
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('Missing title', 'Please enter a title for the trip.');
      return;
    }
    if (!startDate || !endDate) {
      Alert.alert('Select dates', 'Please choose start and end dates on the calendar.');
      return;
    }
    if (!vesselId) {
      Alert.alert('Error', 'You must be in a vessel to create trips.');
      return;
    }
    if (!isHOD) {
      Alert.alert('Access denied', 'Only HODs can create or edit trips.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await tripsService.updateTrip(tripId, {
          title: trimmed,
          startDate,
          endDate,
          notes: notes.trim() || undefined,
          department: type === 'YARD_PERIOD' ? (department ?? null) : undefined,
        });
        Alert.alert('Updated', 'Trip updated.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } else {
        await tripsService.createTrip({
          vesselId,
          type,
          title: trimmed,
          startDate,
          endDate,
          notes: notes.trim() || undefined,
          department: type === 'YARD_PERIOD' ? (department ?? null) : undefined,
        });
        Alert.alert('Created', 'Trip added.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e) {
      console.error('Save trip error:', e);
      Alert.alert('Error', 'Could not save trip.');
    } finally {
      setSaving(false);
    }
  };

  if (!isHOD) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Only HODs can add or edit trips.</Text>
      </View>
    );
  }

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to add trips.</Text>
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
        <Input
          label="Trip title"
          value={title}
          onChangeText={setTitle}
          placeholder={
            type === 'GUEST'
              ? 'e.g. Charter week'
              : type === 'BOSS'
              ? 'e.g. Owner family trip'
              : type === 'DELIVERY'
              ? 'e.g. Delivery to Palma'
              : 'e.g. Annual refit'
          }
          autoCapitalize="words"
        />
        {type === 'YARD_PERIOD' && (
          <>
            <Text style={[styles.label, { color: themeColors.textPrimary }]}>Department</Text>
            <TouchableOpacity
              style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
              onPress={() => setDepartmentModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownText, { color: department ? themeColors.textPrimary : themeColors.textSecondary }]}>
                {DEPARTMENT_OPTIONS.find((o) => o.value === department)?.label ?? 'Select'}
              </Text>
              <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
                {departmentModalVisible ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
            {departmentModalVisible && (
              <Modal visible transparent animationType="fade">
                <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentModalVisible(false)}>
                  <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
                    {DEPARTMENT_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.value ?? 'select'}
                        style={[styles.modalItem, department === opt.value && styles.modalItemSelected]}
                        onPress={() => {
                          setDepartment(opt.value);
                          setDepartmentModalVisible(false);
                        }}
                      >
                        <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Pressable>
              </Modal>
            )}
          </>
        )}
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Select dates</Text>
        <Text style={[styles.hint, { color: themeColors.textSecondary }]}>
          {!startDate
            ? 'Tap a start date on the calendar'
            : !endDate
            ? 'Tap the end date'
            : `${startDate} – ${endDate}`}
        </Text>
        <View style={[styles.calendarWrap, { backgroundColor: themeColors.surface }]}>
          <Calendar
            current={startDate || new Date().toISOString().slice(0, 10)}
            minDate={new Date().toISOString().slice(0, 10)}
            markedDates={markedDates}
            markingType="period"
            onDayPress={({ dateString }) => onDayPress(dateString)}
            theme={calendarTheme}
            hideExtraDays
          />
        </View>
        <Input
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Special requests, itinerary notes..."
          multiline
          numberOfLines={3}
        />
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Update trip' : 'Add trip'}
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
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  hint: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.sm,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.sm,
    minWidth: 260,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight + '20',
  },
  modalItemText: {
    fontSize: FONTS.base,
  },
  calendarWrap: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
  },
  actions: {
    marginTop: SPACING.md,
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
