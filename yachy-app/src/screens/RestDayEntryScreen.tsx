/**
 * Rest Day Entry Screen
 * Lets a crew member enter their rest, work, and lunch periods for a single
 * day, with a live STCW compliance preview before saving. Manager access
 * (Captain, or the assigned department signer) is determined by real
 * permission - not by which screen the person navigated from - so editing
 * works consistently whether reached via the crew's own calendar or the
 * review queue.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import {
  RestPeriod,
  RestEntry,
  saveEntry,
  checkCompliance,
  getWeekEntries,
  confirmEntryForUser,
  canManageRestFor,
  RestEntryStatus,
} from '../services/restEntries';
import { getSignatureForUser } from '../services/signatures';
import watchKeepingService, {
  getRestWatchConflicts,
  WatchWorkPeriod,
} from '../services/watchKeeping';

function timeStringToDate(t: string | null): Date {
  const d = new Date();
  if (t) {
    const [h, m] = t.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function formatDateDisplay(dateStr: string): string {
  return dateStr.replace(/-/g, '/');
}

function dateToTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type TimeField =
  | { type: 'rest'; index: number; edge: 'start' | 'end' }
  | { type: 'work'; edge: 'start' | 'end' }
  | { type: 'lunch'; edge: 'start' | 'end' };

type ActiveField = TimeField | null;

export const RestDayEntryScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const { date, targetUserId: routeTargetUserId, targetUserName } = route.params;

  const effectiveUserId = routeTargetUserId ?? user?.id;

  const [restPeriods, setRestPeriods] = useState<RestPeriod[]>([{ start: '22:00', end: '08:00' }]);
  const [workStart, setWorkStart] = useState<string | null>('08:00');
  const [workEnd, setWorkEnd] = useState<string | null>('17:00');
  const [comment, setComment] = useState('');
  const [lunchStart, setLunchStart] = useState<string | null>('12:00');
  const [lunchEnd, setLunchEnd] = useState<string | null>('13:00');
  const [status, setStatus] = useState<RestEntryStatus>('draft');
  const [watchPeriods, setWatchPeriods] = useState<WatchWorkPeriod[]>([]);
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const [pendingTime, setPendingTime] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [hasExistingEntry, setHasExistingEntry] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(true);

  const loadExisting = useCallback(async () => {
    if (!effectiveUserId) return;

    const [rows, linkedWatchPeriods] = await Promise.all([
      getWeekEntries(effectiveUserId, date),
      user?.vesselId
        ? watchKeepingService.getWorkPeriodsForUser(user.vesselId, effectiveUserId, date, date)
        : Promise.resolve([]),
    ]);
    setWatchPeriods(linkedWatchPeriods);
    const existing = rows.find((r) => r.date === date);
    setHasExistingEntry(Boolean(existing));
    if (existing) {
      setRestPeriods(
        existing.rest_periods?.length ? existing.rest_periods : [{ start: '22:00', end: '08:00' }]
      );
      setWorkStart(existing.work_start);
      setWorkEnd(existing.work_end);
      setLunchStart(existing.lunch_start);
      setLunchEnd(existing.lunch_end);
      setComment(existing.comment ?? '');
      setStatus(existing.status);
    }

    if (user?.id && user?.vesselId && user?.role) {
      // canManageRestFor already returns true immediately for the Captain,
      // regardless of whose entry it is — including their own. No special
      // case needed here.
      const canManage = await canManageRestFor(user.id, user.role, effectiveUserId, user.vesselId);
      setIsManager(canManage);
    }
  }, [effectiveUserId, date, user?.id, user?.vesselId, user?.role]);

  useFocusEffect(
    useCallback(() => {
      setLoadingEntry(true);
      loadExisting().finally(() => setLoadingEntry(false));
    }, [loadExisting])
  );

  if (loadingEntry) {
    return (
      <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
        <PageHeader title="Rest Entry" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={themeColors.accent} />
        </View>
      </View>
    );
  }

  const isLocked = !isManager && (status === 'pending_confirmation' || status === 'confirmed');
  const compliance = checkCompliance(restPeriods);
  const watchRestConflicts = getRestWatchConflicts(restPeriods, watchPeriods);

  const getTimeForField = (field: TimeField): string | null => {
    if (field.type === 'rest') {
      return field.edge === 'start' ? restPeriods[field.index].start : restPeriods[field.index].end;
    }
    if (field.type === 'work') {
      return field.edge === 'start' ? workStart : workEnd;
    }
    return field.edge === 'start' ? lunchStart : lunchEnd;
  };

  const openPicker = (field: TimeField) => {
    if (isLocked) return;
    setPendingTime(timeStringToDate(getTimeForField(field)));
    setActiveField(field);
  };

  const applyTime = (field: TimeField, selectedDate: Date) => {
    const timeStr = dateToTimeString(selectedDate);

    if (field.type === 'rest') {
      setRestPeriods((prev) => {
        const updated = [...prev];
        updated[field.index] = { ...updated[field.index], [field.edge]: timeStr };
        return updated;
      });
    } else if (field.type === 'work') {
      if (field.edge === 'start') setWorkStart(timeStr);
      else setWorkEnd(timeStr);
    } else if (field.type === 'lunch') {
      if (field.edge === 'start') setLunchStart(timeStr);
      else setLunchEnd(timeStr);
    }
  };

  const closePicker = () => {
    setActiveField(null);
    setPendingTime(null);
  };

  const handleTimeChange = (event: any, selectedDate?: Date) => {
    if (event.type === 'dismissed') {
      closePicker();
      return;
    }
    if (!selectedDate || !activeField) return;

    if (Platform.OS === 'ios') {
      setPendingTime(selectedDate);
      return;
    }

    applyTime(activeField, selectedDate);
    closePicker();
  };

  const confirmPendingTime = () => {
    if (!activeField || !pendingTime) return;
    applyTime(activeField, pendingTime);
    closePicker();
  };

  const addRestPeriod = () => {
    if (restPeriods.length >= 2) {
      Alert.alert('Limit reached', 'STCW allows a maximum of 2 rest periods per day.');
      return;
    }
    setRestPeriods((prev) => [...prev, { start: '13:00', end: '15:00' }]);
  };

  const removeRestPeriod = (index: number) => {
    setRestPeriods((prev) => prev.filter((_, i) => i !== index));
  };

  const saveOwnEntry = async () => {
    if (!user?.id || !user?.vesselId) return;
    setSaving(true);
    try {
      const entry: RestEntry = {
        user_id: user.id,
        vessel_id: user.vesselId,
        date,
        rest_periods: restPeriods,
        work_start: workStart,
        work_end: workEnd,
        lunch_start: lunchStart,
        lunch_end: lunchEnd,
        comment: comment.trim() || null,
        status: 'draft',
      };
      await saveEntry(entry);
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id || !user?.vesselId) return;
    const signature = await getSignatureForUser(user.id);
    if (!signature) {
      Alert.alert(
        'Set up your E-Signature',
        'You need to set up your signature before submitting your Hours of Rest.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set up now', onPress: () => navigation.navigate('SignatureSetup') },
        ]
      );
      return;
    }

    if (watchRestConflicts.length > 0) {
      Alert.alert(
        'Rest overlaps a scheduled watch',
        'The saved rest period overlaps an automatically imported Watch Keeping period. Check the times, or save anyway if this accurately records what happened.',
        [
          { text: 'Check Times', style: 'cancel' },
          { text: 'Save Draft Anyway', onPress: saveOwnEntry },
        ]
      );
      return;
    }

    await saveOwnEntry();
  };

  const confirmManagedEntry = async () => {
    if (!effectiveUserId || !user?.vesselId || !user?.id) return;
    setSaving(true);
    try {
      await confirmEntryForUser(
        effectiveUserId,
        user.vesselId,
        date,
        restPeriods,
        workStart,
        workEnd,
        lunchStart,
        lunchEnd,
        user.id,
        comment.trim() || null
      );
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to confirm. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!effectiveUserId || !user?.vesselId || !user?.id) return;
    const signature = await getSignatureForUser(user.id);
    if (!signature) {
      Alert.alert(
        'Set up your E-Signature',
        'You need to set up your signature before confirming this entry.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set up now', onPress: () => navigation.navigate('SignatureSetup') },
        ]
      );
      return;
    }

    if (watchRestConflicts.length > 0) {
      Alert.alert(
        'Rest overlaps a scheduled watch',
        'The recorded rest overlaps an automatically imported Watch Keeping period. Check the times, or confirm anyway if this accurately records what happened.',
        [
          { text: 'Check Times', style: 'cancel' },
          { text: 'Confirm Anyway', onPress: confirmManagedEntry },
        ]
      );
      return;
    }

    await confirmManagedEntry();
  };

  const renderTimeChip = (label: string, value: string | null, onPress: () => void) => (
    <TouchableOpacity
      style={[
        styles.chip,
        { backgroundColor: themeColors.control, borderColor: themeColors.border },
      ]}
      onPress={onPress}
      disabled={isLocked}
    >
      <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.base }}>
        {value ?? '--:--'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title={hasExistingEntry ? 'Edit Rest Entry' : 'Create Rest Entry'} />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.dateTitle, { color: themeColors.textPrimary }]}>
            {formatDateDisplay(date)}
          </Text>
          {status !== 'draft' && (
            <Text
              style={{
                color: status === 'confirmed' ? '#16a34a' : '#d97706',
                fontWeight: '700',
                fontSize: FONTS.base,
              }}
            >
              {status === 'confirmed'
                ? 'Confirmed'
                : status === 'needs_reconfirmation'
                  ? 'Needs reconfirmation'
                  : 'Pending confirmation'}
            </Text>
          )}
        </View>

        {isManager && targetUserName && (
          <Text
            style={{ color: themeColors.textSecondary, marginTop: 4, marginBottom: SPACING.sm }}
          >
            Editing for {targetUserName}
          </Text>
        )}

        {isLocked && !isManager && (
          <Text style={[styles.lockedNote, { color: themeColors.textSecondary }]}>
            {status === 'pending_confirmation' ? 'Locked until reviewed' : 'Locked'}
          </Text>
        )}

        {status === 'needs_reconfirmation' && !isManager && (
          <Text style={[styles.lockedNote, { color: themeColors.textSecondary }]}>
            The Watch Keeping schedule changed. Review this entry and save it again.
          </Text>
        )}

        {status !== 'draft' && isManager && (
          <View style={[styles.editablePill, { backgroundColor: themeColors.accentSoft }]}>
            <Text style={[styles.editablePillText, { color: themeColors.accent }]}>
              You can still make changes
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>Time Worked</Text>
        <View style={styles.row}>
          {renderTimeChip('Start', workStart, () => openPicker({ type: 'work', edge: 'start' }))}
          <Text style={{ color: themeColors.textSecondary }}>{'->'}</Text>
          {renderTimeChip('End', workEnd, () => openPicker({ type: 'work', edge: 'end' }))}
        </View>

        {watchPeriods.length > 0 && (
          <View
            style={[
              styles.watchCard,
              {
                backgroundColor: themeColors.surfaceElevated,
                borderLeftColor: themeColors.accent,
              },
            ]}
          >
            <View style={styles.watchCardHeader}>
              <Text style={[styles.watchCardTitle, { color: themeColors.textPrimary }]}>
                Watch Keeping
              </Text>
              <Text style={[styles.automaticLabel, { color: themeColors.accent }]}>
                Automatically added
              </Text>
            </View>
            {watchPeriods.map((period, index) => (
              <View
                key={`${period.timetableId}-${period.date}-${period.startTime}-${index}`}
                style={styles.watchPeriodRow}
              >
                <Text style={[styles.watchPeriodName, { color: themeColors.textSecondary }]}>
                  {period.watchTitle}
                </Text>
                <Text style={[styles.watchPeriodTime, { color: themeColors.textPrimary }]}>
                  {period.startTime}–{period.endTime}
                </Text>
              </View>
            ))}
            {watchRestConflicts.length > 0 && (
              <Text style={styles.watchConflictText}>
                Warning: recorded rest overlaps this scheduled watch. You can still save an honest
                non-compliant record.
              </Text>
            )}
          </View>
        )}

        <Text
          style={[styles.sectionLabel, { color: themeColors.textPrimary, marginTop: SPACING.lg }]}
        >
          Lunch Break
        </Text>
        <View style={styles.row}>
          {renderTimeChip('Start', lunchStart, () => openPicker({ type: 'lunch', edge: 'start' }))}
          <Text style={{ color: themeColors.textSecondary }}>{'->'}</Text>
          {renderTimeChip('End', lunchEnd, () => openPicker({ type: 'lunch', edge: 'end' }))}
        </View>

        <Text
          style={[styles.sectionLabel, { color: themeColors.textPrimary, marginTop: SPACING.lg }]}
        >
          Hours of Rest
        </Text>
        {restPeriods.map((p, i) => (
          <View key={i} style={styles.row}>
            {renderTimeChip('Start', p.start, () =>
              openPicker({ type: 'rest', index: i, edge: 'start' })
            )}
            <Text style={{ color: themeColors.textSecondary }}>{'->'}</Text>
            {renderTimeChip('End', p.end, () =>
              openPicker({ type: 'rest', index: i, edge: 'end' })
            )}
            {!isLocked && restPeriods.length > 1 && (
              <TouchableOpacity onPress={() => removeRestPeriod(i)}>
                <Text style={{ color: '#dc2626', marginLeft: SPACING.sm }}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {!isLocked && restPeriods.length < 2 && (
          <TouchableOpacity onPress={addRestPeriod}>
            <Text style={{ color: themeColors.accent, marginBottom: SPACING.lg }}>
              + Add another rest period
            </Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>
          Comment (optional)
        </Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          editable={!isLocked}
          maxLength={40}
          placeholder="Short note for the PDF, e.g. Sick day"
          placeholderTextColor={themeColors.textSecondary}
          style={[
            styles.commentInput,
            {
              color: themeColors.textPrimary,
              backgroundColor: themeColors.control,
              borderColor: themeColors.border,
            },
          ]}
        />
        <Text
          style={{
            color: themeColors.textSecondary,
            fontSize: FONTS.xs,
            marginTop: SPACING.xs,
            marginBottom: SPACING.lg,
          }}
        >
          {comment.length}/40
        </Text>
        {activeField && (
          <View style={styles.timePickerContainer}>
            <DateTimePicker
              value={pendingTime ?? timeStringToDate(getTimeForField(activeField))}
              mode="time"
              display="spinner"
              themeVariant={themeColors.isDark ? 'dark' : 'light'}
              onChange={handleTimeChange}
            />
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Confirm selected time"
                style={[styles.pickerDoneButton, { backgroundColor: themeColors.controlSelected }]}
                onPress={confirmPendingTime}
              >
                <Text style={[styles.pickerDoneButtonText, { color: themeColors.textOnAccent }]}>
                  Done
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View
          style={[
            styles.complianceBox,
            {
              backgroundColor: compliance.compliant
                ? 'rgba(22,163,74,0.08)'
                : 'rgba(220,38,38,0.08)',
            },
          ]}
        >
          <Text style={{ color: compliance.compliant ? '#16a34a' : '#dc2626', fontWeight: '600' }}>
            {compliance.totalRestHours}h rest{' '}
            {compliance.compliant ? '- compliant' : '- not compliant'}
          </Text>
          {compliance.violations.map((v, i) => (
            <Text key={i} style={{ color: '#dc2626', fontSize: FONTS.sm, marginTop: 2 }}>
              {v}
            </Text>
          ))}
        </View>

        {isManager ? (
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: themeColors.controlSelected }]}
            onPress={handleConfirm}
            disabled={saving}
          >
            <Text style={[styles.saveButtonText, { color: themeColors.textOnAccent }]}>
              {saving ? 'Confirming…' : 'Confirm Rest Entry'}
            </Text>
          </TouchableOpacity>
        ) : (
          !isLocked && (
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: themeColors.controlSelected }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={[styles.saveButtonText, { color: themeColors.textOnAccent }]}>
                {saving ? 'Saving…' : 'Save Draft'}
              </Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  dateTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.xs },
  lockedNote: { marginBottom: SPACING.md, fontSize: FONTS.sm },
  editablePill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: SPACING.md,
  },
  watchCard: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 3,
  },
  watchCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  watchCardTitle: { fontSize: FONTS.base, fontWeight: '700' },
  automaticLabel: { fontSize: FONTS.xs, fontWeight: '600' },
  watchPeriodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  watchPeriodName: { flex: 1, fontSize: FONTS.sm },
  watchPeriodTime: { fontSize: FONTS.sm, fontWeight: '700' },
  watchConflictText: {
    color: '#dc2626',
    fontSize: FONTS.xs,
    lineHeight: 17,
    marginTop: SPACING.sm,
  },
  editablePillText: { fontSize: FONTS.sm, fontWeight: '600' },
  sectionLabel: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  chip: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  complianceBox: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginVertical: SPACING.lg,
  },
  saveButton: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  saveButtonText: { fontWeight: '600' },
  commentInput: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    marginBottom: SPACING.xs,
  },
  timePickerContainer: {
    marginBottom: SPACING.md,
  },
  pickerDoneButton: {
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  pickerDoneButtonText: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
});
