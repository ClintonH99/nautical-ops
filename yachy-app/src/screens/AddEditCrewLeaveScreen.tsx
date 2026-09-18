/** Create or edit a crew leave date range. */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { Button, Input, LabeledDropdown, LoadingSpinner, PageHeader } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { CREW_LEAVE_COLORS, CREW_LEAVE_LABELS, CREW_LEAVE_TYPES } from '../constants/crewLeave';
import { useThemeColors } from '../hooks/useThemeColors';
import crewLeaveService from '../services/crewLeave';
import userService from '../services/user';
import { useAuthStore } from '../store';
import type { CrewLeaveType, User } from '../types';
import { formatLocalDateString, parseLocalDate, toYYYYMMDD } from '../utils';

type PickerMode = 'crew' | 'type' | null;

function getMarkedRange(start: string | null, end: string | null, color: string) {
  if (!start || !end) return {};
  const marked: Record<string, object> = {};
  const first = parseLocalDate(start);
  const last = parseLocalDate(end);
  for (let date = new Date(first); date <= last; date.setDate(date.getDate() + 1)) {
    const key = toYYYYMMDD(date);
    marked[key] = {
      startingDay: key === start,
      endingDay: key === end,
      color,
      textColor: COLORS.white,
    };
  }
  return marked;
}

export const AddEditCrewLeaveScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const leaveId = route.params?.leaveId as string | undefined;
  const [crew, setCrew] = useState<User[]>([]);
  const [crewMemberId, setCrewMemberId] = useState<string | null>(null);
  const [leaveType, setLeaveType] = useState<CrewLeaveType>('ANNUAL');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [dateSelectionStep, setDateSelectionStep] = useState<'start' | 'end'>('start');
  const [notes, setNotes] = useState('');
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const canManage = user?.role === 'CAPTAIN_MOV' || user?.role === 'HOD';
  const selectedCrew = useMemo(
    () => crew.find((member) => member.id === crewMemberId) ?? null,
    [crew, crewMemberId]
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!vesselId) {
        setLoading(false);
        return;
      }
      try {
        const [members, existing] = await Promise.all([
          userService.getVesselCrew(vesselId),
          leaveId ? crewLeaveService.getById(leaveId) : Promise.resolve(null),
        ]);
        if (!active) return;
        setCrew(members);
        if (leaveId && !existing) {
          Alert.alert('Not found', 'This crew leave record is no longer available.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
          return;
        }
        if (existing) {
          setCrewMemberId(existing.crewMemberId);
          setLeaveType(existing.leaveType);
          setStartDate(existing.startDate);
          setEndDate(existing.endDate);
          setNotes(existing.notes);
          setDateSelectionStep('start');
        }
      } catch (error) {
        console.error('Load crew leave form error:', error);
        Alert.alert('Error', 'Crew leave details could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [leaveId, navigation, vesselId]);

  const handleDatePress = (dateString: string) => {
    if (dateSelectionStep === 'start' || !startDate) {
      setStartDate(dateString);
      setEndDate(dateString);
      setDateSelectionStep('end');
      return;
    }
    if (dateString < startDate) {
      setEndDate(startDate);
      setStartDate(dateString);
    } else {
      setEndDate(dateString);
    }
    setDateSelectionStep('start');
  };

  const handleSave = async () => {
    if (!vesselId || !crewMemberId || !startDate || !endDate) {
      Alert.alert('Missing information', 'Select a crew member and their start and end dates.');
      return;
    }
    setSaving(true);
    try {
      if (leaveId) {
        await crewLeaveService.update(leaveId, {
          crewMemberId,
          leaveType,
          startDate,
          endDate,
          notes,
        });
      } else {
        await crewLeaveService.create({
          vesselId,
          crewMemberId,
          leaveType,
          startDate,
          endDate,
          notes,
        });
      }
      navigation.goBack();
    } catch (error) {
      console.error('Save crew leave error:', error);
      Alert.alert('Could not save crew leave', 'Check the details and try again.');
    } finally {
      setSaving(false);
    }
  };

  const calendarTextColor = themeColors.textPrimary;
  const selectedColor = CREW_LEAVE_COLORS[leaveType];
  const markedDates = getMarkedRange(startDate, endDate, selectedColor);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  if (!canManage || !vesselId) {
    return (
      <View style={[styles.page, { backgroundColor: themeColors.background }]}>
        <PageHeader title="Crew Leave" />
        <View style={styles.center}>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Only HODs and Captain have access.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={leaveId ? 'Edit Crew Leave' : 'Add Crew Leave'} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LabeledDropdown
          label="Crew Member"
          value={selectedCrew?.name ?? 'Select crew'}
          open={pickerMode === 'crew'}
          onPress={() => setPickerMode('crew')}
          tightTop
        />
        <LabeledDropdown
          label="Leave Type"
          value={CREW_LEAVE_LABELS[leaveType]}
          open={pickerMode === 'type'}
          onPress={() => setPickerMode('type')}
        />

        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Leave dates</Text>
        <Text style={[styles.hint, { color: themeColors.textSecondary }]}>
          {!startDate
            ? 'Tap the first day of leave'
            : dateSelectionStep === 'end'
              ? 'Now tap the final day of leave'
              : `${formatLocalDateString(startDate)} – ${formatLocalDateString(endDate ?? startDate)}`}
        </Text>
        <View
          style={[
            styles.calendarWrap,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
              borderWidth: themeColors.isDark ? 1 : 0,
            },
          ]}
        >
          <Calendar
            current={startDate ?? toYYYYMMDD(new Date())}
            markedDates={markedDates}
            markingType="period"
            onDayPress={({ dateString }) => handleDatePress(dateString)}
            hideExtraDays
            theme={{
              backgroundColor: themeColors.surface,
              calendarBackground: themeColors.surface,
              textSectionTitleColor: calendarTextColor,
              selectedDayBackgroundColor: selectedColor,
              selectedDayTextColor: COLORS.white,
              todayTextColor: calendarTextColor,
              dayTextColor: calendarTextColor,
              textDisabledColor: themeColors.isDark
                ? themeColors.textMuted
                : themeColors.textSecondary,
              arrowColor: themeColors.isDark ? themeColors.accent : calendarTextColor,
              monthTextColor: calendarTextColor,
            }}
          />
        </View>
        {startDate && (
          <TouchableOpacity
            style={styles.clearDate}
            onPress={() => {
              setStartDate(null);
              setEndDate(null);
              setDateSelectionStep('start');
            }}
          >
            <Text style={[styles.clearDateText, { color: themeColors.textSecondary }]}>
              Clear dates
            </Text>
          </TouchableOpacity>
        )}

        <Input
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Add any relevant notes..."
          multiline
          maxLength={1000}
        />
        <Text style={[styles.notificationHint, { color: themeColors.textSecondary }]}>
          {selectedCrew?.name ?? 'The selected crew member'} will be notified when this leave is{' '}
          {leaveId ? 'updated' : 'published'}.
        </Text>
        <Button
          title={leaveId ? 'Update Crew Leave' : 'Publish Crew Leave'}
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          fullWidth
        />
      </ScrollView>

      <Modal visible={pickerMode !== null} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerMode(null)}>
          <View
            style={[
              styles.modalBox,
              {
                backgroundColor: themeColors.surfaceElevated,
                borderColor: themeColors.border,
                borderWidth: themeColors.isDark ? 1 : 0,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              {pickerMode === 'crew' ? 'Select Crew Member' : 'Select Leave Type'}
            </Text>
            <ScrollView style={styles.modalList}>
              {pickerMode === 'crew'
                ? crew.map((member) => (
                    <TouchableOpacity
                      key={member.id}
                      style={[
                        styles.modalItem,
                        { borderTopColor: themeColors.border },
                        crewMemberId === member.id && {
                          backgroundColor: themeColors.isDark
                            ? themeColors.accentSoft
                            : COLORS.primaryLight + '22',
                        },
                      ]}
                      onPress={() => {
                        setCrewMemberId(member.id);
                        setPickerMode(null);
                      }}
                    >
                      <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                        {member.name}
                      </Text>
                      <Text style={[styles.modalItemSubtext, { color: themeColors.textSecondary }]}>
                        {member.position || member.role.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))
                : CREW_LEAVE_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.modalItem,
                        { borderTopColor: themeColors.border },
                        leaveType === type && {
                          backgroundColor: themeColors.isDark
                            ? themeColors.accentSoft
                            : COLORS.primaryLight + '22',
                        },
                      ]}
                      onPress={() => {
                        setLeaveType(type);
                        setPickerMode(null);
                      }}
                    >
                      <View style={styles.typeRow}>
                        <View
                          style={[styles.typeDot, { backgroundColor: CREW_LEAVE_COLORS[type] }]}
                        />
                        <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                          {CREW_LEAVE_LABELS[type]}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs },
  hint: { fontSize: FONTS.sm, marginBottom: SPACING.sm },
  calendarWrap: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
    borderWidth: 1,
  },
  clearDate: { alignSelf: 'flex-start', paddingVertical: SPACING.xs, marginBottom: SPACING.lg },
  clearDateText: { fontSize: FONTS.sm },
  notificationHint: {
    fontSize: FONTS.xs,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    maxHeight: '70%',
    overflow: 'hidden',
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  modalList: { maxHeight: 430 },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  modalItemText: { fontSize: FONTS.base, fontWeight: '600' },
  modalItemSubtext: { fontSize: FONTS.sm, marginTop: 3 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  typeDot: { width: 12, height: 12, borderRadius: 6 },
});
