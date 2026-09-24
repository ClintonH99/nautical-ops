/**
 * Create Watch Timetable Screen
 * Form to create, generate, and publish watch keeping timetables (HOD only)
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import userService from '../services/user';
import watchKeepingService, { getWatchDateTime, TimetableSlot } from '../services/watchKeeping';
import { User } from '../types';
import { formatLocalDateString, toYYYYMMDD } from '../utils';
import {
  calculateWatchRotationPlan,
  formatWatchHours,
  getWatchSlotDurations,
} from '../utils/watchTimetable';
import {
  DateOnlyPicker,
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  TimePickerField,
} from '../components';

function generateWatchTimetable(
  watchDurationHours: number,
  totalRunningHours: number,
  crew: User[],
  startTimeStr: string,
  startDate: string
): Array<{
  crew: User;
  startTimeStr: string;
  endTimeStr: string;
  durationHours: number;
  startDate: string;
  endDate: string;
}> {
  const slots: Array<{
    crew: User;
    startTimeStr: string;
    endTimeStr: string;
    durationHours: number;
    startDate: string;
    endDate: string;
  }> = [];
  if (crew.length === 0) return slots;
  const slotDurations = getWatchSlotDurations(totalRunningHours, watchDurationHours);
  let slotStartHour = 0;
  for (let slotIndex = 0; slotIndex < slotDurations.length; slotIndex++) {
    const assignedCrew = crew[slotIndex % crew.length];
    const slotEndHour = slotStartHour + slotDurations[slotIndex];
    const slotStart = getWatchDateTime(startDate, startTimeStr, slotStartHour);
    const slotEnd = getWatchDateTime(startDate, startTimeStr, slotEndHour);
    slots.push({
      crew: assignedCrew,
      startTimeStr: slotStart.time,
      endTimeStr: slotEnd.time,
      durationHours: slotEndHour - slotStartHour,
      startDate: slotStart.date,
      endDate: slotEnd.date,
    });
    slotStartHour = slotEndHour;
  }
  return slots;
}

function timeStringToDate(value: string): Date {
  const date = new Date();
  const [hour, minute] = value.split(':').map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function dateToTimeString(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function sanitizeHoursInput(value: string): string {
  const numeric = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const decimalIndex = numeric.indexOf('.');
  if (decimalIndex === -1) return numeric;
  return `${numeric.slice(0, decimalIndex + 1)}${numeric.slice(decimalIndex + 1).replace(/\./g, '')}`;
}

function parsePositiveHours(value: string): number | null {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface RestConflict {
  restHours: number;
  watchDurationHours: number;
}

export const CreateWatchTimetableScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [editingTimetableId, setEditingTimetableId] = useState<string | null>(null);
  const [watchTitle, setWatchTitle] = useState('');
  const [forDate, setForDate] = useState(() => toYYYYMMDD(new Date()));
  const [startTime, setStartTime] = useState('06:00');
  const [startLocation, setStartLocation] = useState('');
  const [destination, setDestination] = useState('');
  const [totalRunningTime, setTotalRunningTime] = useState('');
  const [notes, setNotes] = useState('');
  const [hoursOfRest, setHoursOfRest] = useState('');
  const [maximumWatchDuration, setMaximumWatchDuration] = useState('');
  const [selectedCrew, setSelectedCrew] = useState<User[]>([]);
  const [crew, setCrew] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [crewDropdownOpen, setCrewDropdownOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [timetableSlots, setTimetableSlots] = useState<Array<{
    crew: User;
    startTimeStr: string;
    endTimeStr: string;
    durationHours: number;
    startDate: string;
    endDate: string;
  }> | null>(null);
  const [timetablePreviewOpen, setTimetablePreviewOpen] = useState(false);
  const [calculatedWatchHours, setCalculatedWatchHours] = useState<number | null>(null);
  const [restConflict, setRestConflict] = useState<RestConflict | null>(null);
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const sectionTitleColor = themeColors.isDark ? COLORS.white : COLORS.primary;

  const loadCrew = useCallback(async (): Promise<User[]> => {
    if (!vesselId) return [];
    try {
      const data = await userService.getVesselCrew(vesselId);
      setCrew(data);
      return data;
    } catch (e) {
      console.error('Load crew error:', e);
      Alert.alert('Error', 'Could not load crew list');
      return [];
    } finally {
      setLoading(false);
    }
  }, [vesselId]);

  const loadExistingTimetable = useCallback(
    async (timetableId: string, crewList: User[]) => {
      try {
        const timetable = await watchKeepingService.getById(timetableId);
        if (!timetable) {
          Alert.alert('Error', 'Timetable not found.');
          navigation.goBack();
          return;
        }
        setEditingTimetableId(timetableId);
        setWatchTitle(timetable.watchTitle);
        setForDate(timetable.forDate || '');
        setStartTime(timetable.startTime);
        setStartLocation(timetable.startLocation || '');
        setDestination(timetable.destination || '');
        setNotes(timetable.notes || '');

        // Convert slots back to the format needed for display
        const crewMap = new Map(crewList.map((c) => [c.id, c]));
        const convertedSlots = timetable.slots.map((slot) => {
          const crewMember = crewMap.get(slot.crewId);
          if (!crewMember) {
            // If crew member not found, create a temporary user object
            return {
              crew: {
                id: slot.crewId,
                name: slot.crewName,
                position: slot.crewPosition,
              } as User,
              startTimeStr: slot.startTimeStr,
              endTimeStr: slot.endTimeStr,
              durationHours: slot.durationHours,
              startDate: slot.startDate || timetable.forDate || '',
              endDate: slot.endDate || timetable.forDate || '',
            };
          }
          return {
            crew: crewMember,
            startTimeStr: slot.startTimeStr,
            endTimeStr: slot.endTimeStr,
            durationHours: slot.durationHours,
            startDate: slot.startDate || timetable.forDate || '',
            endDate: slot.endDate || timetable.forDate || '',
          };
        });

        // Set selected crew from slots
        const uniqueCrewIds = new Set(timetable.slots.map((s) => s.crewId));
        const selectedCrewMembers = crewList.filter((c) => uniqueCrewIds.has(c.id));
        setSelectedCrew(selectedCrewMembers);

        // Calculate watch hours (average duration)
        if (convertedSlots.length > 0) {
          const avgDuration =
            convertedSlots.reduce((sum, s) => sum + s.durationHours, 0) / convertedSlots.length;
          setCalculatedWatchHours(Math.round(avgDuration * 10) / 10);

          const totalDuration = convertedSlots.reduce((sum, slot) => sum + slot.durationHours, 0);
          setTotalRunningTime(String(Math.round(totalDuration * 10) / 10));

          // Rest hours were not stored separately by older schedules. Infer
          // them from the gaps between each crew member's consecutive slots
          // so pressing Update preserves the existing rotation accurately.
          const lastCrewEnd = new Map<string, number>();
          const restGaps: number[] = [];
          let elapsedHours = 0;
          convertedSlots.forEach((slot) => {
            const previousEnd = lastCrewEnd.get(slot.crew.id);
            if (previousEnd !== undefined) restGaps.push(elapsedHours - previousEnd);
            elapsedHours += slot.durationHours;
            lastCrewEnd.set(slot.crew.id, elapsedHours);
          });
          const inferredRest = restGaps.length > 0 ? Math.min(...restGaps) : 8;
          setHoursOfRest(String(Math.round(inferredRest * 10) / 10));
        }

        setTimetableSlots(convertedSlots);
        // Editing must open directly on the form. The full timetable is only
        // shown after the user deliberately regenerates it for review.
        setTimetablePreviewOpen(false);
      } catch (e) {
        console.error('Load timetable error:', e);
        Alert.alert('Error', 'Could not load timetable.');
        navigation.goBack();
      }
    },
    [navigation]
  );

  useFocusEffect(
    useCallback(() => {
      if (!isHOD) {
        setLoading(false);
        return;
      }

      const timetableId = route?.params?.timetableId;
      if (timetableId) {
        // Load crew first, then load timetable
        loadCrew().then((crewList) => {
          if (crewList.length > 0) {
            loadExistingTimetable(timetableId, crewList);
          }
        });
      } else {
        loadCrew();
      }
    }, [isHOD, loadCrew, route?.params?.timetableId, loadExistingTimetable])
  );

  const toggleCrewMember = (member: User) => {
    setSelectedCrew((prev) => {
      const exists = prev.find((c) => c.id === member.id);
      if (exists) return prev.filter((c) => c.id !== member.id);
      return [...prev, member];
    });
  };

  const crewDisplayText =
    selectedCrew.length === 0
      ? 'Select crew...'
      : selectedCrew.length === crew.length
        ? 'All crew'
        : selectedCrew.map((c) => c.name).join(', ');

  const getValidatedScheduleHours = () => {
    const totalRunningHours = parsePositiveHours(totalRunningTime);
    if (totalRunningHours === null) {
      Alert.alert('Invalid running time', 'Enter the total running time as a number of hours.');
      return null;
    }

    let restHours: number | null = null;
    if (hoursOfRest.trim()) {
      restHours = parsePositiveHours(hoursOfRest);
      if (restHours === null) {
        Alert.alert('Invalid hours of rest', 'Enter the hours of rest as a number.');
        return null;
      }
    }

    let maximumWatchHours: number | null = null;
    if (maximumWatchDuration.trim()) {
      maximumWatchHours = parsePositiveHours(maximumWatchDuration);
      if (maximumWatchHours === null) {
        Alert.alert(
          'Invalid maximum watch duration',
          'Enter the maximum duration as a number of hours.'
        );
        return null;
      }
    }

    return { totalRunningHours, restHours, maximumWatchHours };
  };

  const getValidatedRotationPlan = (
    scheduleHours: NonNullable<ReturnType<typeof getValidatedScheduleHours>>
  ) => {
    const rotationPlan = calculateWatchRotationPlan(
      scheduleHours.totalRunningHours,
      scheduleHours.restHours,
      selectedCrew.length,
      scheduleHours.maximumWatchHours
    );

    if (!rotationPlan.hasEnoughCrew && scheduleHours.restHours !== null) {
      setRestConflict({
        restHours: scheduleHours.restHours,
        watchDurationHours: rotationPlan.watchDurationHours,
      });
      return null;
    }

    setRestConflict(null);
    return rotationPlan;
  };

  const handleGenerateTimetable = () => {
    if (!watchTitle.trim()) {
      Alert.alert('Missing title', 'Please enter a Watch Title.');
      return;
    }
    if (selectedCrew.length === 0) {
      Alert.alert('No crew', 'Please select at least one crew member.');
      return;
    }
    if (!forDate) {
      Alert.alert('Select a date', 'Please select the date and time when the voyage begins.');
      return;
    }
    const scheduleHours = getValidatedScheduleHours();
    if (!scheduleHours) return;
    const rotationPlan = getValidatedRotationPlan(scheduleHours);
    if (!rotationPlan) return;
    if (!isHOD) {
      Alert.alert('Access denied', 'Only HODs and Captain have access.');
      return;
    }
    setGenerating(true);
    const slots = generateWatchTimetable(
      rotationPlan.watchDurationHours,
      scheduleHours.totalRunningHours,
      selectedCrew,
      startTime || '06:00',
      forDate
    );
    setTimetableSlots(slots);
    setCalculatedWatchHours(rotationPlan.watchDurationHours);
    setTimetablePreviewOpen(true);
    setGenerating(false);
  };

  const slotsToExportFormat = (slots: NonNullable<typeof timetableSlots>): TimetableSlot[] =>
    slots.map((s) => ({
      crewId: s.crew.id,
      crewName: s.crew.name,
      crewPosition: s.crew.position,
      startTimeStr: s.startTimeStr,
      endTimeStr: s.endTimeStr,
      durationHours: s.durationHours,
      startDate: s.startDate,
      endDate: s.endDate,
    }));

  const handlePublish = async (slotsOverride?: NonNullable<typeof timetableSlots>) => {
    const slotsToSave = slotsOverride ?? timetableSlots;
    if (!vesselId || !slotsToSave || publishingRef.current) return;
    publishingRef.current = true;
    const wasEditing = Boolean(editingTimetableId);
    setPublishing(true);
    try {
      const timetableData = {
        vesselId,
        watchTitle: watchTitle.trim() || 'Watch Schedule',
        startTime,
        startLocation: startLocation || undefined,
        destination: destination || undefined,
        notes: notes || undefined,
        forDate,
        slots: slotsToExportFormat(slotsToSave),
        createdBy: user?.id,
      };

      let savedTimetable;
      if (editingTimetableId) {
        savedTimetable = await watchKeepingService.update(editingTimetableId, timetableData);
        Alert.alert('Updated', 'Watch Schedule has been updated.');
      } else {
        savedTimetable = await watchKeepingService.publish(timetableData);
        Alert.alert('Published', 'Timetable is now available in Watch Schedule.');
      }

      setTimetableSlots(null);
      setTimetablePreviewOpen(false);
      setCalculatedWatchHours(null);
      setEditingTimetableId(null);
      if (wasEditing) {
        navigation.goBack();
      } else {
        navigation.replace('WatchSchedule', { timetableId: savedTimetable.id });
      }
    } catch (e) {
      console.error('Publish watch timetable error:', e);
      Alert.alert(
        'Error',
        editingTimetableId
          ? 'Could not update timetable.'
          : 'Could not publish timetable to Watch Schedule.'
      );
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  const handleUpdateDirectly = async () => {
    if (!editingTimetableId) return;
    if (!watchTitle.trim()) {
      Alert.alert('Missing title', 'Please enter a Watch Title.');
      return;
    }
    if (selectedCrew.length === 0) {
      Alert.alert('No crew', 'Please select at least one crew member.');
      return;
    }
    if (!forDate) {
      Alert.alert('Select a date', 'Please select the date and time when the voyage begins.');
      return;
    }
    if (!isHOD) {
      Alert.alert('Access denied', 'Only HODs and Captain have access.');
      return;
    }

    const scheduleHours = getValidatedScheduleHours();
    if (!scheduleHours) return;
    const rotationPlan = getValidatedRotationPlan(scheduleHours);
    if (!rotationPlan) return;
    const updatedSlots = generateWatchTimetable(
      rotationPlan.watchDurationHours,
      scheduleHours.totalRunningHours,
      selectedCrew,
      startTime || '06:00',
      forDate
    );

    await handlePublish(updatedSlots);
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to create watch timetables.
        </Text>
      </View>
    );
  }

  if (!isHOD) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Only HODs and Captain have access.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title={editingTimetableId ? 'Edit Watch Schedule' : 'Create Watch Schedule'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Schedule details</Text>
          <Input
            label="Watch Title"
            value={watchTitle}
            onChangeText={setWatchTitle}
            placeholder="e.g. Morning Watch"
            autoCapitalize="words"
          />
          <DateOnlyPicker
            label="Voyage Start Date"
            value={forDate}
            onChange={setForDate}
            title="Select voyage start date"
          />
          <TimePickerField
            label="Start Time"
            title="Select Start Time"
            value={timeStringToDate(startTime)}
            onChange={(selected) => setStartTime(dateToTimeString(selected))}
            containerStyle={styles.lastControl}
          />
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Voyage details</Text>
          <View style={styles.fieldRow}>
            <Input
              label="Start Location"
              value={startLocation}
              onChangeText={setStartLocation}
              placeholder="e.g. Marina Bay"
              containerStyle={styles.fieldHalf}
            />
            <Input
              label="Destination"
              value={destination}
              onChangeText={setDestination}
              placeholder="e.g. Port of Palma"
              containerStyle={styles.fieldHalf}
            />
          </View>
          <Input
            label="Total Running Time"
            value={totalRunningTime}
            onChangeText={(value) => setTotalRunningTime(sanitizeHoursInput(value))}
            placeholder="e.g. 36 (hours)"
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
          <Input
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Additional notes..."
            multiline
            numberOfLines={3}
            containerStyle={styles.lastInput}
          />
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Crew and Rest</Text>
          <Input
            label="Max. duration for a single watch"
            value={maximumWatchDuration}
            onChangeText={(value) => setMaximumWatchDuration(sanitizeHoursInput(value))}
            placeholder="Optional, e.g. 4 hours"
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
          <Text style={[styles.label, styles.firstLabel, { color: themeColors.textPrimary }]}>
            Crew
          </Text>
          <TouchableOpacity
            style={[
              styles.dropdown,
              { backgroundColor: themeColors.control, borderColor: themeColors.border },
            ]}
            onPress={() => setCrewDropdownOpen(!crewDropdownOpen)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.dropdownText, { color: themeColors.textPrimary }]}
              numberOfLines={2}
            >
              {crewDisplayText}
            </Text>
            <Text style={[styles.dropdownChevron, { color: sectionTitleColor }]}>
              {crewDropdownOpen ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
          {crewDropdownOpen && (
            <Modal visible transparent animationType="fade">
              <Pressable style={styles.modalBackdrop} onPress={() => setCrewDropdownOpen(false)}>
                <View
                  style={[
                    styles.modalBox,
                    {
                      backgroundColor: themeColors.surfaceElevated,
                      borderColor: themeColors.border,
                    },
                  ]}
                  onStartShouldSetResponder={() => true}
                >
                  {crew.length === 0 ? (
                    <Text style={[styles.emptyCrew, { color: themeColors.textSecondary }]}>
                      No crew members on vessel
                    </Text>
                  ) : (
                    <ScrollView style={styles.crewList} nestedScrollEnabled>
                      {crew.map((member) => {
                        const isSelected = selectedCrew.some((c) => c.id === member.id);
                        return (
                          <TouchableOpacity
                            key={member.id}
                            style={[
                              styles.modalItem,
                              isSelected && { backgroundColor: themeColors.controlSelected },
                            ]}
                            onPress={() => toggleCrewMember(member)}
                          >
                            <Text
                              style={[
                                styles.modalItemText,
                                isSelected && styles.modalItemTextSelected,
                                {
                                  color: isSelected
                                    ? themeColors.textOnAccent
                                    : themeColors.textPrimary,
                                },
                              ]}
                            >
                              {member.name}
                            </Text>
                            {member.position ? (
                              <Text
                                style={[
                                  styles.modalItemSubtext,
                                  {
                                    color: isSelected
                                      ? themeColors.textOnAccent
                                      : themeColors.textSecondary,
                                  },
                                ]}
                              >
                                {member.position}
                              </Text>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </Pressable>
            </Modal>
          )}
          <Input
            label="Hours of Rest"
            value={hoursOfRest}
            onChangeText={(value) => setHoursOfRest(sanitizeHoursInput(value))}
            placeholder="Optional, e.g. 8 hours"
            keyboardType="decimal-pad"
            inputMode="decimal"
            containerStyle={styles.lastInput}
          />
        </View>
        <View style={styles.actions}>
          {editingTimetableId ? (
            <View style={styles.editActions}>
              <Button
                title="Save Changes"
                onPress={handleUpdateDirectly}
                variant="primary"
                loading={publishing}
                disabled={publishing}
                style={styles.editActionButton}
              />
              <Button
                title="Cancel"
                onPress={() => navigation.goBack()}
                variant="outline"
                disabled={publishing}
                style={styles.editActionButton}
              />
            </View>
          ) : (
            <Button
              title="Continue"
              onPress={handleGenerateTimetable}
              variant="primary"
              loading={generating}
              disabled={generating}
              fullWidth
            />
          )}
        </View>
      </ScrollView>

      {timetableSlots !== null && timetablePreviewOpen && (
        <Modal visible transparent animationType="slide">
          <View style={[styles.timetableModal, { backgroundColor: themeColors.background }]}>
            <View
              style={[
                styles.timetableHeader,
                {
                  backgroundColor: themeColors.surfaceElevated,
                  borderBottomColor: themeColors.border,
                },
              ]}
            >
              <Text style={[styles.timetableTitle, { color: themeColors.accent }]}>
                Watch Keeping Timetable
              </Text>
              <Text style={[styles.timetableSubtitle, { color: themeColors.textPrimary }]}>
                {watchTitle}
              </Text>
              {calculatedWatchHours != null && (
                <Text style={[styles.timetableMeta, { color: themeColors.textSecondary }]}>
                  Watch duration: {formatWatchHours(calculatedWatchHours)} hr
                  {calculatedWatchHours !== 1 ? 's' : ''}
                </Text>
              )}
              {startLocation ? (
                <Text style={[styles.timetableMeta, { color: themeColors.textSecondary }]}>
                  From: {startLocation}
                </Text>
              ) : null}
              {destination ? (
                <Text style={[styles.timetableMeta, { color: themeColors.textSecondary }]}>
                  To: {destination}
                </Text>
              ) : null}
            </View>
            <ScrollView
              style={styles.timetableList}
              contentContainerStyle={styles.timetableListContent}
            >
              {timetableSlots.map((slot, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.timetableRow,
                    {
                      backgroundColor: themeColors.surfaceElevated,
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <View style={styles.timetableRowLeft}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Text style={[styles.timetableCrewName, { color: themeColors.textPrimary }]}>
                        {slot.crew.name}
                      </Text>
                    </View>
                    {slot.crew.position ? (
                      <Text
                        style={[styles.timetableCrewRole, { color: themeColors.textSecondary }]}
                      >
                        {slot.crew.position}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.timetableRowCenter}>
                    <Text style={[styles.timetableDate, { color: themeColors.textSecondary }]}>
                      {formatLocalDateString(slot.startDate, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                      {slot.endDate !== slot.startDate
                        ? ` – ${formatLocalDateString(slot.endDate, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}`
                        : ''}
                    </Text>
                    <Text style={[styles.timetableTime, { color: themeColors.textPrimary }]}>
                      {slot.startTimeStr} – {slot.endTimeStr}
                    </Text>
                    <Text style={[styles.timetableDuration, { color: themeColors.textSecondary }]}>
                      {slot.durationHours < 1
                        ? `${Math.round(slot.durationHours * 60)} min`
                        : `${formatWatchHours(slot.durationHours)} hr${slot.durationHours !== 1 ? 's' : ''}`}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View
              style={[
                styles.timetableActions,
                {
                  backgroundColor: themeColors.surfaceElevated,
                  borderTopColor: themeColors.border,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.timetableExportBtn,
                  {
                    backgroundColor: themeColors.controlSelected,
                    opacity: publishing ? 0.65 : 1,
                  },
                ]}
                onPress={() => handlePublish()}
                disabled={publishing}
              >
                <Text
                  style={[styles.timetableExportText, { color: themeColors.textOnAccent }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {publishing
                    ? editingTimetableId
                      ? 'Saving…'
                      : 'Publishing…'
                    : editingTimetableId
                      ? 'Save Changes'
                      : 'Publish Watch Schedule'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.timetableEditBtn,
                  {
                    borderColor: themeColors.accent,
                    backgroundColor: themeColors.surfaceElevated,
                  },
                ]}
                onPress={() => setTimetablePreviewOpen(false)}
              >
                <Text style={[styles.timetableEditText, { color: themeColors.accent }]}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {restConflict && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setRestConflict(null)}
        >
          <View
            style={[
              styles.validationOverlay,
              {
                backgroundColor: themeColors.isDark
                  ? 'rgba(2, 6, 23, 0.72)'
                  : 'rgba(15, 23, 42, 0.46)',
              },
            ]}
          >
            <View
              style={[
                styles.validationDialog,
                {
                  backgroundColor: themeColors.surfaceElevated,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.validationIcon,
                  {
                    backgroundColor: themeColors.isDark
                      ? 'rgba(251, 191, 36, 0.14)'
                      : 'rgba(180, 83, 9, 0.12)',
                  },
                ]}
              >
                <Ionicons
                  name="warning-outline"
                  size={26}
                  color={themeColors.isDark ? '#FBBF24' : '#B45309'}
                />
              </View>
              <Text style={[styles.validationTitle, { color: themeColors.textPrimary }]}>
                Not Enough Crew
              </Text>
              <Text style={[styles.validationBody, { color: themeColors.textSecondary }]}>
                You do not have enough crew members to provide the{' '}
                <Text style={[styles.validationEmphasis, { color: themeColors.textPrimary }]}>
                  {formatWatchHours(restConflict.restHours)} hours of rest
                </Text>{' '}
                entered while keeping each watch to a maximum of{' '}
                <Text style={[styles.validationEmphasis, { color: themeColors.textPrimary }]}>
                  {formatWatchHours(restConflict.watchDurationHours)} hours
                </Text>
                . Add another crew member or reduce the Hours of Rest.
              </Text>
              <TouchableOpacity
                style={[styles.validationAction, { backgroundColor: themeColors.controlSelected }]}
                onPress={() => setRestConflict(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.validationActionText, { color: themeColors.textOnAccent }]}>
                  Review Crew and Rest
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  fieldHalf: {
    flex: 1,
  },
  lastInput: {
    marginBottom: 0,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs, marginTop: SPACING.md },
  firstLabel: { marginTop: 0 },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  lastControl: { marginBottom: 0 },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500', flex: 1 },
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
    minWidth: 280,
    maxHeight: 320,
    borderWidth: 1,
  },
  crewList: { maxHeight: 280 },
  timeList: { maxHeight: 280 },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  modalItemSelected: { backgroundColor: COLORS.primaryLight + '20' },
  modalItemText: { fontSize: FONTS.base },
  modalItemTextSelected: { fontWeight: '600' },
  modalItemSubtext: { fontSize: FONTS.sm, marginTop: 2 },
  emptyCrew: { fontSize: FONTS.base, padding: SPACING.lg, textAlign: 'center' },
  actions: { marginTop: SPACING.xs },
  editActions: { flexDirection: 'row', gap: SPACING.sm },
  editActionButton: { flex: 1 },
  timetableModal: {
    flex: 1,
    marginTop: 60,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
  },
  timetableHeader: { padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  timetableTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  timetableSubtitle: { fontSize: FONTS.lg, fontWeight: '600', color: COLORS.textPrimary },
  timetableMeta: { fontSize: FONTS.sm, color: COLORS.textSecondary, marginTop: SPACING.xs },
  timetableList: { flex: 1 },
  timetableListContent: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  timetableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
  },
  timetableRowLeft: { flex: 1 },
  timetableRowCenter: { alignItems: 'flex-end' },
  timetableCrewName: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.textPrimary },
  timetableCrewRole: { fontSize: FONTS.sm, color: COLORS.textSecondary, marginTop: 2 },
  timetableTime: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.primary },
  timetableDate: { fontSize: FONTS.xs, marginBottom: 2 },
  timetableDuration: { fontSize: FONTS.sm, color: COLORS.textSecondary, marginTop: 2 },
  timetableActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'stretch',
  },
  timetableExportBtn: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timetableExportText: { fontSize: FONTS.base, fontWeight: '600' },
  timetableEditBtn: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timetableEditText: { fontSize: FONTS.base, fontWeight: '600' },
  validationOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  validationDialog: {
    width: '100%',
    maxWidth: 390,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 12,
  },
  validationIcon: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  validationTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  validationBody: {
    fontSize: FONTS.base,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  validationEmphasis: { fontWeight: '700' },
  validationAction: {
    width: '100%',
    minHeight: 52,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  validationActionText: {
    fontSize: FONTS.base,
    fontWeight: '600',
    textAlign: 'center',
  },
  exportOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  exportModalBox: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    margin: SPACING.lg,
    alignSelf: 'center',
  },
  exportModalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  exportModalHint: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  exportConfirmBtn: {
    padding: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  exportConfirmBtnDisabled: { backgroundColor: COLORS.gray400, opacity: 0.8 },
  exportConfirmText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.white },
  exportModalCancel: { marginTop: SPACING.md, padding: SPACING.sm, alignItems: 'center' },
  exportModalCancelText: { fontSize: FONTS.base, color: COLORS.textSecondary },
});
