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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { Button, PageHeader, TimePickerField } from '../components';
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
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function dateToTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type TimeField =
  | { type: 'rest'; index: number; edge: 'start' | 'end' }
  | { type: 'work'; edge: 'start' | 'end' }
  | { type: 'lunch'; edge: 'start' | 'end' };

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

  const renderTimeField = (label: string, value: string | null, field: TimeField) => (
    <TimePickerField
      label={label}
      title={`Select ${label} Time`}
      value={timeStringToDate(value)}
      onChange={(selected) => applyTime(field, selected)}
      disabled={isLocked}
      containerStyle={styles.timeField}
    />
  );

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title={hasExistingEntry ? 'Edit Rest Entry' : 'Create Rest Entry'} />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.dateHeading}>
          <Text style={[styles.dateTitle, { color: themeColors.textPrimary }]}>
            {formatDateDisplay(date)}
          </Text>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  status === 'confirmed'
                    ? 'rgba(22,163,74,0.1)'
                    : status === 'draft'
                      ? themeColors.accentSoft
                      : 'rgba(217,119,6,0.1)',
              },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                {
                  color:
                    status === 'confirmed'
                      ? '#16a34a'
                      : status === 'draft'
                        ? themeColors.accent
                        : '#d97706',
                },
              ]}
            >
              {status === 'confirmed'
                ? 'Confirmed'
                : status === 'needs_reconfirmation'
                  ? 'Needs reconfirmation'
                  : status === 'pending_confirmation'
                    ? 'Pending confirmation'
                    : 'Draft'}
            </Text>
          </View>
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

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: themeColors.accent }]}>Time Worked</Text>
          <View style={styles.timeRow}>
            {renderTimeField('Start', workStart, { type: 'work', edge: 'start' })}
            <Text style={[styles.timeArrow, { color: themeColors.textSecondary }]}>→</Text>
            {renderTimeField('End', workEnd, { type: 'work', edge: 'end' })}
          </View>
        </View>

        {watchPeriods.length > 0 && (
          <View
            style={[
              styles.watchCard,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
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

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: themeColors.accent }]}>Lunch Break</Text>
          <View style={styles.timeRow}>
            {renderTimeField('Start', lunchStart, { type: 'lunch', edge: 'start' })}
            <Text style={[styles.timeArrow, { color: themeColors.textSecondary }]}>→</Text>
            {renderTimeField('End', lunchEnd, { type: 'lunch', edge: 'end' })}
          </View>
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: themeColors.accent }]}>Hours of Rest</Text>
          {restPeriods.map((period, index) => (
            <View key={index} style={styles.restPeriod}>
              <View style={styles.timeRow}>
                {renderTimeField('Start', period.start, {
                  type: 'rest',
                  index,
                  edge: 'start',
                })}
                <Text style={[styles.timeArrow, { color: themeColors.textSecondary }]}>→</Text>
                {renderTimeField('End', period.end, {
                  type: 'rest',
                  index,
                  edge: 'end',
                })}
              </View>
              {!isLocked && restPeriods.length > 1 && (
                <View style={styles.removePeriodRow}>
                  <TouchableOpacity
                    style={styles.removePeriodButton}
                    onPress={() => removeRestPeriod(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete rest period ${index + 1}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    <Text style={styles.removePeriodText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
          {!isLocked && restPeriods.length < 2 && (
            <TouchableOpacity
              style={[styles.addPeriodButton, { borderColor: themeColors.accent }]}
              onPress={addRestPeriod}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={themeColors.accent} />
              <Text style={[styles.addPeriodText, { color: themeColors.accent }]}>
                Add Rest Period
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: themeColors.accent }]}>Comment</Text>
          <Text style={[styles.commentLabel, { color: themeColors.textPrimary }]}>Optional</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            editable={!isLocked}
            maxLength={40}
            placeholder="Short note for the PDF"
            placeholderTextColor={themeColors.textMuted}
            multiline
            style={[
              styles.commentInput,
              {
                color: themeColors.textPrimary,
                backgroundColor: themeColors.control,
                borderColor: themeColors.border,
              },
            ]}
          />
          <Text style={[styles.characterCount, { color: themeColors.textSecondary }]}>
            {comment.length}/40
          </Text>
        </View>
        <View
          style={[
            styles.complianceBox,
            {
              backgroundColor: compliance.compliant
                ? 'rgba(22,163,74,0.08)'
                : 'rgba(220,38,38,0.08)',
              borderColor: compliance.compliant ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)',
            },
          ]}
        >
          <Ionicons
            name={compliance.compliant ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={21}
            color={compliance.compliant ? '#16a34a' : '#dc2626'}
          />
          <View style={styles.complianceContent}>
            <Text
              style={{ color: compliance.compliant ? '#16a34a' : '#dc2626', fontWeight: '700' }}
            >
              {compliance.totalRestHours}h rest{' '}
              {compliance.compliant ? '- compliant' : '- not compliant'}
            </Text>
            {compliance.violations.map((v, i) => (
              <Text key={i} style={{ color: '#dc2626', fontSize: FONTS.sm, marginTop: 2 }}>
                {v}
              </Text>
            ))}
          </View>
        </View>

        {isManager ? (
          <Button
            title="Confirm Rest Entry"
            onPress={handleConfirm}
            loading={saving}
            variant="primary"
            fullWidth
          />
        ) : (
          !isLocked && (
            <Button
              title="Save Draft"
              onPress={handleSave}
              loading={saving}
              variant="primary"
              fullWidth
            />
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
  dateHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  dateTitle: { flex: 1, fontSize: FONTS.xl, fontWeight: '700' },
  statusBadge: {
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  statusBadgeText: { fontSize: FONTS.xs, fontWeight: '700' },
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
    borderWidth: 1,
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
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  sectionTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.md },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  timeField: { flex: 1 },
  timeLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  timeButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  timeValue: { fontSize: FONTS.base, fontWeight: '600' },
  timeArrow: { fontSize: FONTS.lg, paddingBottom: SPACING.sm },
  restPeriod: { gap: SPACING.sm, marginBottom: SPACING.md },
  removePeriodRow: { alignItems: 'flex-end' },
  removePeriodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: SPACING.xs,
  },
  removePeriodText: { color: COLORS.danger, fontSize: FONTS.sm, fontWeight: '600' },
  addPeriodButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  addPeriodText: { fontSize: FONTS.base, fontWeight: '700' },
  complianceBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    marginVertical: SPACING.lg,
  },
  complianceContent: { flex: 1 },
  commentLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  commentInput: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    minHeight: 82,
    textAlignVertical: 'top',
    marginBottom: SPACING.xs,
  },
  characterCount: { alignSelf: 'flex-end', fontSize: FONTS.xs },
  pickerModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.lg,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  pickerModalCard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  pickerModalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.sm,
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
