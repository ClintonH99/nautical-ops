/**
 * Rest Day Entry Screen
 * Lets a crew member enter their rest, work, and lunch periods for a single
 * day, with a live STCW compliance preview before saving. Manager access
 * (Captain, or the assigned department signer) is determined by real
 * permission - not by which screen the person navigated from - so editing
 * works consistently whether reached via the crew's own calendar or the
 * review queue.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
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
} from '../services/restEntries';
import { getSignatureForUser } from '../services/signatures';

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

type ActiveField =
  | { type: 'rest'; index: number; edge: 'start' | 'end' }
  | { type: 'work'; edge: 'start' | 'end' }
  | { type: 'lunch'; edge: 'start' | 'end' }
  | null;

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
  const [status, setStatus] = useState<'draft' | 'pending_confirmation' | 'confirmed'>('draft');
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const [saving, setSaving] = useState(false);
  const [isManager, setIsManager] = useState(false);

  const loadExisting = useCallback(async () => {
    if (!effectiveUserId) return;

    const rows = await getWeekEntries(effectiveUserId, date);
    const existing = rows.find((r) => r.date === date);
    if (existing) {
      setRestPeriods(existing.rest_periods?.length ? existing.rest_periods : [{ start: '22:00', end: '08:00' }]);
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

  useFocusEffect(useCallback(() => { loadExisting(); }, [loadExisting]));

  const isLocked = !isManager && status !== 'draft';
  const compliance = checkCompliance(restPeriods);

  const openPicker = (field: ActiveField) => {
    if (isLocked) return;
    setActiveField(field);
  };

  const handleTimeChange = (event: any, selectedDate?: Date) => {
    if (!selectedDate || !activeField) { setActiveField(null); return; }
    const timeStr = dateToTimeString(selectedDate);

    if (activeField.type === 'rest') {
      setRestPeriods((prev) => {
        const updated = [...prev];
        updated[activeField.index] = { ...updated[activeField.index], [activeField.edge]: timeStr };
        return updated;
      });
    } else if (activeField.type === 'work') {
      if (activeField.edge === 'start') setWorkStart(timeStr);
      else setWorkEnd(timeStr);
    } else if (activeField.type === 'lunch') {
      if (activeField.edge === 'start') setLunchStart(timeStr);
      else setLunchEnd(timeStr);
    }

    if (event.type === 'set' || event.type === undefined) setActiveField(null);
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
    } catch (e) {
      Alert.alert('Error', 'Failed to save. Please try again.');
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
    } catch (e) {
      Alert.alert('Error', 'Failed to confirm. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderTimeChip = (label: string, value: string | null, onPress: () => void) => (
    <TouchableOpacity
      style={[styles.chip, { backgroundColor: themeColors.surface }]}
      onPress={onPress}
      disabled={isLocked}
    >
      <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.base }}>{value ?? '--:--'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Rest Entry" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.dateTitle, { color: themeColors.textPrimary }]}>{formatDateDisplay(date)}</Text>
          {status !== 'draft' && (
            <Text style={{ color: status === 'confirmed' ? '#16a34a' : '#d97706', fontWeight: '700', fontSize: FONTS.base }}>
              {status === 'confirmed' ? 'Confirmed' : 'Pending confirmation'}
            </Text>
          )}
        </View>

        {isManager && targetUserName && (
          <Text style={{ color: themeColors.textSecondary, marginTop: 4, marginBottom: SPACING.sm }}>Editing for {targetUserName}</Text>
        )}

        {status !== 'draft' && !isManager && (
          <Text style={[styles.lockedNote, { color: themeColors.textSecondary }]}>
            {status === 'pending_confirmation' ? 'Locked until reviewed' : 'Locked'}
          </Text>
        )}

        {status !== 'draft' && isManager && (
          <View style={styles.editablePill}>
            <Text style={styles.editablePillText}>You can still make changes</Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>Hours of rest</Text>
        {restPeriods.map((p, i) => (
          <View key={i} style={styles.row}>
            {renderTimeChip('Start', p.start, () => openPicker({ type: 'rest', index: i, edge: 'start' }))}
            <Text style={{ color: themeColors.textSecondary }}>{'->'}</Text>
            {renderTimeChip('End', p.end, () => openPicker({ type: 'rest', index: i, edge: 'end' }))}
            {!isLocked && restPeriods.length > 1 && (
              <TouchableOpacity onPress={() => removeRestPeriod(i)}>
                <Text style={{ color: '#dc2626', marginLeft: SPACING.sm }}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {!isLocked && restPeriods.length < 2 && (
          <TouchableOpacity onPress={addRestPeriod}>
            <Text style={{ color: COLORS.primary, marginBottom: SPACING.lg }}>+ Add another rest period</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>Comment (optional)</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          editable={!isLocked}
          maxLength={40}
          placeholder="Short note for the PDF, e.g. Sick day"
          placeholderTextColor={themeColors.textSecondary}
          style={[
            styles.commentInput,
            { color: themeColors.textPrimary, backgroundColor: themeColors.surface, borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border },
          ]}
        />
        <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs, marginTop: -SPACING.sm, marginBottom: SPACING.lg }}>
          {comment.length}/40
        </Text>
        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>Time worked</Text>
        <View style={styles.row}>
          {renderTimeChip('Start', workStart, () => openPicker({ type: 'work', edge: 'start' }))}
          <Text style={{ color: themeColors.textSecondary }}>{'->'}</Text>
          {renderTimeChip('End', workEnd, () => openPicker({ type: 'work', edge: 'end' }))}
        </View>

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary, marginTop: SPACING.lg }]}>Lunch break</Text>
        <View style={styles.row}>
          {renderTimeChip('Start', lunchStart, () => openPicker({ type: 'lunch', edge: 'start' }))}
          <Text style={{ color: themeColors.textSecondary }}>{'->'}</Text>
          {renderTimeChip('End', lunchEnd, () => openPicker({ type: 'lunch', edge: 'end' }))}
        </View>

        {activeField && (
          <DateTimePicker
            value={
              activeField.type === 'rest'
                ? timeStringToDate(activeField.edge === 'start' ? restPeriods[activeField.index].start : restPeriods[activeField.index].end)
                : activeField.type === 'work'
                  ? timeStringToDate(activeField.edge === 'start' ? workStart : workEnd)
                  : timeStringToDate(activeField.edge === 'start' ? lunchStart : lunchEnd)
            }
            mode="time"
            display="spinner"
            onChange={handleTimeChange}
          />
        )}

        <View style={[styles.complianceBox, { backgroundColor: compliance.compliant ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)' }]}>
          <Text style={{ color: compliance.compliant ? '#16a34a' : '#dc2626', fontWeight: '600' }}>
            {compliance.totalRestHours}h rest {compliance.compliant ? '- compliant' : '- not compliant'}
          </Text>
          {compliance.violations.map((v, i) => (
            <Text key={i} style={{ color: '#dc2626', fontSize: FONTS.sm, marginTop: 2 }}>{v}</Text>
          ))}
        </View>

        {isManager ? (
          <TouchableOpacity style={styles.saveButton} onPress={handleConfirm} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Confirming...' : 'Confirm'}</Text>
          </TouchableOpacity>
        ) : (
          !isLocked && (
            <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
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
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  editablePillText: { color: '#000000', fontSize: FONTS.sm, fontWeight: '600' },
  sectionLabel: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  chip: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.md },
  complianceBox: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginVertical: SPACING.lg },
  saveButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
  commentInput: { borderWidth: 1, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, fontSize: FONTS.base, marginBottom: SPACING.xs },
});
