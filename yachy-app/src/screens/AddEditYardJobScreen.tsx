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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import yardJobsService from '../services/yardJobs';
import { Input, Button, LoadingSpinner, PageHeader, DepartmentSelector } from '../components';
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

function getMarkedRange(start: string, end: string, color: string, textColor: string): MarkedDates {
  const marked: MarkedDates = {};
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const key = toYYYYMMDD(date);
    marked[key] = {
      startingDay: key === start,
      endingDay: key === end,
      color,
      textColor,
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
      title: jobId ? 'Edit Job' : 'Create Job',
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

  const markedDates =
    startDate && endDate
      ? getMarkedRange(startDate, endDate, themeColors.controlSelected, themeColors.textOnAccent)
      : {};

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

  const calendarTextColor = themeColors.textPrimary;
  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: calendarTextColor,
    selectedDayBackgroundColor: themeColors.controlSelected,
    selectedDayTextColor: themeColors.textOnAccent,
    todayTextColor: themeColors.accent,
    dayTextColor: calendarTextColor,
    textDisabledColor: themeColors.textMuted,
    textInactiveColor: themeColors.textMuted,
    arrowColor: themeColors.accent,
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
      <PageHeader title={isEdit ? 'Edit Job' : 'Create Job'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
      >
        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Job details</Text>
          <DepartmentSelector
            value={department}
            onChange={(value) => value && setDepartment(value)}
          />
          <Input
            label="Title"
            value={jobTitle}
            onChangeText={setJobTitle}
            placeholder="e.g. Starboard passerelle motor"
            autoCapitalize="sentences"
          />
          <Input
            label="Defect, damage or improvement"
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
            label="Location of defect or damage"
            value={defectLocation}
            onChangeText={setDefectLocation}
            placeholder="e.g. Starboard side, mid-deck"
          />
          <Input
            label="Equipment or serial number (optional)"
            value={equipmentSerial}
            onChangeText={setEquipmentSerial}
            placeholder="e.g. BESENZONI PA284 / SN 44219"
          />
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text
              style={[
                styles.sectionTitle,
                styles.sectionTitleInHeader,
                { color: themeColors.textPrimary },
              ]}
            >
              Priority
            </Text>
            <Text style={[styles.sectionMeta, { color: themeColors.textSecondary }]}>
              {priority === 'GREEN'
                ? 'Low priority'
                : priority === 'YELLOW'
                  ? 'Medium priority'
                  : 'High priority'}
            </Text>
          </View>
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
                      borderColor: isSelected ? themeColors.controlSelected : themeColors.border,
                      backgroundColor: isSelected
                        ? themeColors.controlSelected
                        : themeColors.surface,
                    },
                  ]}
                  onPress={() => setPriority(p)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <View style={[styles.priorityDot, { backgroundColor: chipColor }]} />
                  <Text
                    style={[
                      styles.priorityChipText,
                      {
                        color: isSelected ? themeColors.textOnAccent : themeColors.textPrimary,
                      },
                    ]}
                  >
                    {p === 'GREEN' ? 'Low' : p === 'YELLOW' ? 'Medium' : 'High'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
            Yard and contractor
          </Text>
          <Input
            label="Yard location"
            value={yardLocation}
            onChangeText={setYardLocation}
            placeholder="e.g. Palma Shipyard, Dock 7"
          />
          <Input
            label="Contractor or company name"
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
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text
              style={[
                styles.sectionTitle,
                styles.sectionTitleInHeader,
                { color: themeColors.textPrimary },
              ]}
            >
              Job dates
            </Text>
            {startDate && (
              <TouchableOpacity
                style={styles.clearDate}
                onPress={() => {
                  setStartDate(null);
                  setEndDate(null);
                  setDateSelectionStep('start');
                }}
              >
                <Text style={[styles.clearDateText, { color: themeColors.accent }]}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          {(!startDate || dateSelectionStep === 'end') && (
            <Text style={[styles.hint, { color: themeColors.textSecondary }]}>
              {!startDate ? 'Tap the first day of this job' : 'Now tap the final day of this job'}
            </Text>
          )}
          {startDate && dateSelectionStep === 'start' && (
            <View
              style={[
                styles.dateSummary,
                { backgroundColor: themeColors.control, borderColor: themeColors.border },
              ]}
            >
              <View style={styles.dateValue}>
                <Text style={[styles.dateLabel, { color: themeColors.textSecondary }]}>START</Text>
                <Text style={[styles.dateText, { color: themeColors.textPrimary }]}>
                  {formatLocalDateString(startDate)}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color={themeColors.accent} />
              <View style={[styles.dateValue, styles.endDateValue]}>
                <Text style={[styles.dateLabel, { color: themeColors.textSecondary }]}>END</Text>
                <Text style={[styles.dateText, { color: themeColors.textPrimary }]}>
                  {formatLocalDateString(endDate ?? startDate)}
                </Text>
              </View>
            </View>
          )}
          <View
            style={[
              styles.calendarWrap,
              { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
            ]}
          >
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
        </View>
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Create Job'}
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
    gap: SPACING.md,
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
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  sectionTitleInHeader: {
    marginBottom: 0,
  },
  sectionMeta: {
    flexShrink: 1,
    fontSize: FONTS.sm,
    textAlign: 'right',
  },
  hint: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
  },
  calendarWrap: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    borderWidth: 1,
  },
  clearDate: {
    paddingVertical: SPACING.xs,
    paddingLeft: SPACING.sm,
  },
  clearDateText: {
    fontSize: FONTS.sm,
    fontWeight: '700',
  },
  dateSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  dateValue: {
    flex: 1,
  },
  endDateValue: {
    alignItems: 'flex-end',
  },
  dateLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
  },
  dateText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
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
  priorityRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
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
    borderWidth: 1,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  priorityChipText: {
    fontSize: FONTS.sm,
    fontWeight: '700',
  },
});
