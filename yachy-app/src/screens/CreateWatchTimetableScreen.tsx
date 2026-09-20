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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import userService from '../services/user';
import watchKeepingService, { getWatchDateTime, TimetableSlot } from '../services/watchKeeping';
import { User } from '../types';
import { formatLocalDateString, toYYYYMMDD } from '../utils';
import { DateOnlyPicker, Input, Button, LoadingSpinner, PageHeader } from '../components';

function generateWatchTimetable(
  watchIntervalHours: number,
  totalRunningHours: number,
  restHours: number,
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
  const availableAt = crew.map(() => 0);
  let currentHour = 0;
  let crewIndex = 0;
  while (currentHour < totalRunningHours) {
    let assigned = -1;
    for (let i = 0; i < crew.length; i++) {
      const idx = (crewIndex + i) % crew.length;
      if (availableAt[idx] <= currentHour) {
        assigned = idx;
        crewIndex = (idx + 1) % crew.length;
        break;
      }
    }
    if (assigned === -1) {
      let minAvail = Infinity;
      for (let i = 0; i < crew.length; i++) {
        if (availableAt[i] < minAvail) {
          minAvail = availableAt[i];
          assigned = i;
        }
      }
      currentHour = minAvail;
      crewIndex = (assigned! + 1) % crew.length;
    }
    const shiftEnd = Math.min(currentHour + watchIntervalHours, totalRunningHours);
    const actualDuration = shiftEnd - currentHour;
    const slotStart = getWatchDateTime(startDate, startTimeStr, currentHour);
    const slotEnd = getWatchDateTime(startDate, startTimeStr, shiftEnd);
    slots.push({
      crew: crew[assigned!],
      startTimeStr: slotStart.time,
      endTimeStr: slotEnd.time,
      durationHours: actualDuration,
      startDate: slotStart.date,
      endDate: slotEnd.date,
    });
    availableAt[assigned!] = shiftEnd + restHours;
    currentHour = shiftEnd;
  }
  return slots;
}

const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

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
  const [selectedCrew, setSelectedCrew] = useState<User[]>([]);
  const [crew, setCrew] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [startTimeDropdownOpen, setStartTimeDropdownOpen] = useState(false);
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
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';

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
    const totalRunningHours = parseFloat((totalRunningTime || '36').replace(/[^\d.]/g, '')) || 36;
    const restHours = parseFloat((hoursOfRest || '8').replace(/[^\d.]/g, '')) || 8;
    const crewCount = selectedCrew.length;
    const watchIntervalHours =
      crewCount <= 1 ? totalRunningHours : Math.max(1, Math.ceil(restHours / (crewCount - 1)));
    if (!isHOD) {
      Alert.alert('Access denied', 'Only HODs and Captain have access.');
      return;
    }
    setGenerating(true);
    const slots = generateWatchTimetable(
      watchIntervalHours,
      totalRunningHours,
      restHours,
      selectedCrew,
      startTime || '06:00',
      forDate
    );
    setTimetableSlots(slots);
    setCalculatedWatchHours(watchIntervalHours);
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

    const totalRunningHours = parseFloat((totalRunningTime || '36').replace(/[^\d.]/g, '')) || 36;
    const restHours = parseFloat((hoursOfRest || '8').replace(/[^\d.]/g, '')) || 8;
    const watchIntervalHours =
      selectedCrew.length <= 1
        ? totalRunningHours
        : Math.max(1, Math.ceil(restHours / (selectedCrew.length - 1)));
    const updatedSlots = generateWatchTimetable(
      watchIntervalHours,
      totalRunningHours,
      restHours,
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
      >
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
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Start Time</Text>
        <TouchableOpacity
          style={[
            styles.dropdown,
            { backgroundColor: themeColors.control, borderColor: themeColors.border },
          ]}
          onPress={() => setStartTimeDropdownOpen(!startTimeDropdownOpen)}
          activeOpacity={0.7}
        >
          <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>{startTime}</Text>
          <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
            {startTimeDropdownOpen ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>
        {startTimeDropdownOpen && (
          <Modal visible transparent animationType="fade">
            <Pressable style={styles.modalBackdrop} onPress={() => setStartTimeDropdownOpen(false)}>
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
                <ScrollView style={styles.timeList} nestedScrollEnabled>
                  {TIME_OPTIONS.map((time) => (
                    <TouchableOpacity
                      key={time}
                      style={[
                        styles.modalItem,
                        startTime === time && {
                          backgroundColor: themeColors.controlSelected,
                        },
                      ]}
                      onPress={() => {
                        setStartTime(time);
                        setStartTimeDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalItemText,
                          startTime === time && styles.modalItemTextSelected,
                          {
                            color:
                              startTime === time
                                ? themeColors.textOnAccent
                                : themeColors.textPrimary,
                          },
                        ]}
                      >
                        {time}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </Pressable>
          </Modal>
        )}
        <Input
          label="Start Location"
          value={startLocation}
          onChangeText={setStartLocation}
          placeholder="e.g. Marina Bay"
        />
        <Input
          label="Destination"
          value={destination}
          onChangeText={setDestination}
          placeholder="e.g. Port of Palma"
        />
        <Input
          label="Total Running Time"
          value={totalRunningTime}
          onChangeText={setTotalRunningTime}
          placeholder="e.g. 36 (hours)"
        />
        <Input
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Additional notes..."
          multiline
          numberOfLines={3}
        />
        <Input
          label="Hours of Rest"
          value={hoursOfRest}
          onChangeText={setHoursOfRest}
          placeholder="e.g. 8"
        />
        <Text style={[styles.hint, { color: themeColors.textSecondary }]}>
          Watch time per crew is calculated from crew count, rest hours & total running time.
        </Text>
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Crew</Text>
        <TouchableOpacity
          style={[
            styles.dropdown,
            { backgroundColor: themeColors.control, borderColor: themeColors.border },
          ]}
          onPress={() => setCrewDropdownOpen(!crewDropdownOpen)}
          activeOpacity={0.7}
        >
          <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]} numberOfLines={2}>
            {crewDisplayText}
          </Text>
          <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
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
                  Watch: {calculatedWatchHours} hr{calculatedWatchHours !== 1 ? 's' : ''} per crew
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
                        : `${slot.durationHours} hr${slot.durationHours !== 1 ? 's' : ''}`}
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
                style={[styles.timetableExportBtn, { backgroundColor: themeColors.accent }]}
                onPress={() => handlePublish()}
                disabled={publishing}
              >
                <Text style={[styles.timetableExportText, { color: themeColors.textOnAccent }]}>
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
                style={styles.timetableCloseBtn}
                onPress={() => {
                  setTimetablePreviewOpen(false);
                }}
              >
                <Text style={[styles.timetableCloseText, { color: themeColors.accent }]}>Done</Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs, marginTop: SPACING.md },
  hint: { fontSize: FONTS.xs, marginTop: -SPACING.sm, marginBottom: SPACING.lg },
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
  actions: { marginTop: SPACING.xl },
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
  },
  timetableExportBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  timetableExportText: { fontSize: FONTS.base, fontWeight: '600' },
  timetableCloseBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timetableCloseText: { fontSize: FONTS.base, fontWeight: '600', color: COLORS.primary },
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
