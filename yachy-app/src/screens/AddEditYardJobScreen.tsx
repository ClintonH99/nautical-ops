/**
 * Add / Edit Yard Period Job Screen
 * Job details, contractor information, and an individual start/end date range.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import yardJobsService from '../services/yardJobs';
import { Input, Button, LoadingSpinner, PageHeader, LabeledDropdown } from '../components';
import { Department, YardJobPriority } from '../types';
import { formatLocalDateString, parseLocalDate, toYYYYMMDD } from '../utils';

type MarkedDates = {
  [date: string]: {
    startingDay?: boolean;
    endingDay?: boolean;
    color: string;
    textColor?: string;
  };
};

function getMarkedRange(start: string, end: string): MarkedDates {
  const marked: MarkedDates = {};
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const key = toYYYYMMDD(date);
    marked[key] = {
      startingDay: key === start,
      endingDay: key === end,
      color: COLORS.primary,
      textColor: COLORS.white,
    };
  }
  return marked;
}

export const AddEditYardJobScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const jobId = route.params?.jobId as string | undefined;
  const tripId = route.params?.tripId as string | undefined;

  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [defectDetails, setDefectDetails] = useState('');
  const [defectLocation, setDefectLocation] = useState('');
  const [equipmentSerial, setEquipmentSerial] = useState('');
  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [priority, setPriority] = useState<YardJobPriority>('GREEN');
  const [yardLocation, setYardLocation] = useState('');
  const [contractorCompanyName, setContractorCompanyName] = useState('');
  const [contactDetails, setContactDetails] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [dateSelectionStep, setDateSelectionStep] = useState<'start' | 'end'>('start');
  const [loading, setLoading] = useState(!!jobId);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isEdit = !!jobId;

  useEffect(() => {
    navigation.setOptions({
      title: jobId ? 'Edit Job' : 'Create New Job',
    });
  }, [navigation, jobId]);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      try {
        const job = await yardJobsService.getById(jobId);
        if (job) {
          setJobTitle(job.jobTitle);
          setJobDescription(job.jobDescription ?? '');
          setDefectDetails(job.defectDetails ?? '');
          setDefectLocation(job.defectLocation ?? '');
          setEquipmentSerial(job.equipmentSerial ?? '');
          setDepartment(job.department ?? user?.department ?? 'INTERIOR');
          setPriority(job.priority ?? 'GREEN');
          setYardLocation(job.yardLocation ?? '');
          setContractorCompanyName(job.contractorCompanyName ?? '');
          setContactDetails(job.contactDetails ?? '');
          setStartDate(job.startDate ?? null);
          setEndDate(job.endDate ?? null);
          setDateSelectionStep(job.startDate ? 'end' : 'start');
        }
      } catch (e) {
        console.error('Load job error:', e);
        Alert.alert('Error', 'Could not load job');
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId, user?.department]);

  const markedDates = startDate && endDate ? getMarkedRange(startDate, endDate) : {};

  const handleDatePress = (dateString: string) => {
    if (dateSelectionStep === 'start') {
      setStartDate(dateString);
      setEndDate(dateString);
      setDateSelectionStep('end');
      return;
    }

    if (startDate && dateString < startDate) {
      setEndDate(startDate);
      setStartDate(dateString);
    } else {
      setEndDate(dateString);
    }
    setDateSelectionStep('start');
  };

  const calendarTextColor = themeColors.isDark ? COLORS.white : COLORS.black;
  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: calendarTextColor,
    selectedDayBackgroundColor: COLORS.primary,
    selectedDayTextColor: COLORS.white,
    todayTextColor: calendarTextColor,
    dayTextColor: calendarTextColor,
    textDisabledColor: calendarTextColor,
    arrowColor: calendarTextColor,
    monthTextColor: calendarTextColor,
  };

  const handleSave = async () => {
    const trimmed = jobTitle.trim();
    if (!trimmed) {
      Alert.alert('Missing title', 'Please enter a job title.');
      return;
    }
    if (!vesselId) {
      Alert.alert('Error', 'You must be in a vessel to create jobs.');
      return;
    }
    if (!startDate || !endDate) {
      Alert.alert('Select dates', 'Please select the start and end dates for this job.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await yardJobsService.update(jobId, {
          jobTitle: trimmed,
          jobDescription: jobDescription.trim() || undefined,
          defectDetails: defectDetails.trim() || undefined,
          defectLocation: defectLocation.trim() || undefined,
          equipmentSerial: equipmentSerial.trim() || undefined,
          department,
          priority,
          yardLocation: yardLocation.trim() || undefined,
          contractorCompanyName: contractorCompanyName.trim() || undefined,
          contactDetails: contactDetails.trim() || undefined,
          startDate,
          endDate,
        });
        Alert.alert('Updated', 'Job updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await yardJobsService.create({
          vesselId,
          tripId: tripId ?? null,
          jobTitle: trimmed,
          jobDescription: jobDescription.trim() || undefined,
          defectDetails: defectDetails.trim() || undefined,
          defectLocation: defectLocation.trim() || undefined,
          equipmentSerial: equipmentSerial.trim() || undefined,
          department,
          priority,
          yardLocation: yardLocation.trim() || undefined,
          contractorCompanyName: contractorCompanyName.trim() || undefined,
          contactDetails: contactDetails.trim() || undefined,
          startDate,
          endDate,
        });
        Alert.alert('Created', 'Job added.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e) {
      console.error('Save job error:', e);
      Alert.alert('Error', 'Could not save job.');
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to add jobs.
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
      <PageHeader title="Job" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
      >
        <LabeledDropdown
          label="Department"
          value={department.charAt(0) + department.slice(1).toLowerCase()}
          onPress={() => setDepartmentDropdownOpen(true)}
        />
        <Text style={[styles.hint, { color: themeColors.textSecondary }]}>
          Which department is this job for?
        </Text>
        <Input
          label="Title"
          value={jobTitle}
          onChangeText={setJobTitle}
          placeholder="e.g. Starboard passerelle motor"
          autoCapitalize="sentences"
        />
        <Input
          label="Defect / damage / improvements needed"
          value={defectDetails}
          onChangeText={setDefectDetails}
          placeholder="What is wrong, or what needs improving?"
          multiline
          numberOfLines={3}
        />
        <Input
          label="Job description"
          value={jobDescription}
          onChangeText={setJobDescription}
          placeholder="Details of the work required..."
          multiline
          numberOfLines={3}
        />
        <Input
          label="Location of defect / damage"
          value={defectLocation}
          onChangeText={setDefectLocation}
          placeholder="e.g. Starboard side, mid-deck"
        />
        <Input
          label="Equipment or serial number of part (optional)"
          value={equipmentSerial}
          onChangeText={setEquipmentSerial}
          placeholder="e.g. BESENZONI PA284 / SN 44219"
        />
        {departmentDropdownOpen && (
          <Modal visible transparent animationType="fade">
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setDepartmentDropdownOpen(false)}
            >
              <View
                style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
                onStartShouldSetResponder={() => true}
              >
                {(['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'] as Department[]).map(
                  (dept) => (
                    <TouchableOpacity
                      key={dept}
                      style={[styles.modalItem, department === dept && styles.modalItemSelected]}
                      onPress={() => {
                        setDepartment(dept);
                        setDepartmentDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalItemText,
                          { color: themeColors.textPrimary },
                          department === dept && styles.modalItemTextSelected,
                        ]}
                      >
                        {dept.charAt(0) + dept.slice(1).toLowerCase()}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </Pressable>
          </Modal>
        )}
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Urgency / Priority</Text>
        <Text
          style={[
            styles.hint,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          How urgent is this job?
        </Text>
        <View style={styles.priorityRow}>
          {(['GREEN', 'YELLOW', 'RED'] as YardJobPriority[]).map((p) => {
            const isSelected = priority === p;
            const chipColor =
              p === 'GREEN' ? COLORS.success : p === 'YELLOW' ? COLORS.warning : COLORS.danger;
            return (
              <TouchableOpacity
                key={p}
                style={[
                  styles.priorityChip,
                  {
                    borderColor: chipColor,
                    borderWidth: isSelected ? 3 : 2,
                    backgroundColor: isSelected ? chipColor : themeColors.surface,
                  },
                ]}
                onPress={() => setPriority(p)}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <View
                  style={[
                    styles.priorityDot,
                    {
                      backgroundColor:
                        p === 'GREEN'
                          ? COLORS.success
                          : p === 'YELLOW'
                            ? COLORS.warning
                            : COLORS.danger,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.priorityChipText,
                    { color: isSelected ? COLORS.white : themeColors.textPrimary },
                    isSelected && { fontWeight: '700' },
                  ]}
                >
                  {p === 'GREEN' ? 'Low' : p === 'YELLOW' ? 'Medium' : 'High'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Input
          label="Yard location"
          value={yardLocation}
          onChangeText={setYardLocation}
          placeholder="e.g. Palma Shipyard, Dock 7"
        />
        <Input
          label="Contractor / Company name"
          value={contractorCompanyName}
          onChangeText={setContractorCompanyName}
          placeholder="e.g. Marine Services Ltd"
        />
        <Input
          label="Contact details"
          value={contactDetails}
          onChangeText={setContactDetails}
          placeholder="Phone, email, or other contact info"
        />
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Job dates</Text>
        <Text
          style={[
            styles.hint,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          {!startDate
            ? 'Tap the first day of this job'
            : dateSelectionStep === 'end'
              ? 'Now tap the final day of this job'
              : `${formatLocalDateString(startDate)} – ${formatLocalDateString(endDate ?? startDate)}`}
        </Text>
        <View style={[styles.calendarWrap, { backgroundColor: themeColors.surface }]}>
          <Calendar
            current={startDate || toYYYYMMDD(new Date())}
            minDate={isEdit ? undefined : toYYYYMMDD(new Date())}
            markedDates={markedDates}
            markingType="period"
            onDayPress={({ dateString }) => handleDatePress(dateString)}
            theme={calendarTheme}
            hideExtraDays
            hideArrows={false}
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
            <Text
              style={[
                styles.clearDateText,
                { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
              ]}
            >
              Clear dates
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Update job' : 'Create job'}
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
            <Text
              style={[
                styles.cancelText,
                { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
              ]}
            >
              Cancel
            </Text>
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
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  hint: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.sm,
  },
  calendarWrap: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  clearDate: {
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  clearDateText: {
    fontSize: FONTS.sm,
    color: COLORS.danger,
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
  dropdownText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  dropdownChevron: {
    fontSize: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 320,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight + '22',
  },
  modalItemText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  modalItemTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  priorityChip: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  priorityChipText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
});
