/**
 * Rest Day Entry Screen
 * Lets a crew member enter their rest, work, and lunch periods for a single
 * day, with a live STCW compliance preview before saving.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  RestPeriod,
  RestEntry,
  saveEntry,
  checkCompliance,
  getWeekEntries,
} from '../services/restEntries';
import { supabase } from '../services/supabase';

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
  const { date } = route.params;

  const [restPeriods, setRestPeriods] = useState<RestPeriod[]>([{ start: '22:00', end: '08:00' }]);
  const [workStart, setWorkStart] = useState<string | null>('08:00');
  const [workEnd, setWorkEnd] = useState<string | null>('17:00');
  const [lunchStart, setLunchStart] = useState<string | null>('12:00');
  const [lunchEnd, setLunchEnd] = useState<string | null>('13:00');
  const [status, setStatus] = useState<'draft' | 'pending_confirmation' | 'confirmed'>('draft');
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const [saving, setSaving] = useState(false);

  const loadExisting = useCallback(async () => {
    if (!user?.id) return;
    const rows = await getWeekEntries(user.id, date);
    const existing = rows.find((r) => r.date === date);
    if (existing) {
      setRestPeriods(existing.rest_periods?.length ? existing.rest_periods : [{ start: '22:00', end: '08:00' }]);
      setWorkStart(existing.work_start);
      setWorkEnd(existing.work_end);
      setLunchStart(existing.lunch_start);
      setLunchEnd(existing.lunch_end);
      setStatus(existing.status);
    }
  }, [user?.id, date]);

  useFocusEffect(useCallback(() => { loadExisting(); }, [loadExisting]));

  const isLocked = status !== 'draft';
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
      activeField.edge === 'start' ? setWorkStart(timeStr) : setWorkEnd(timeStr);
    } else if (activeField.type === 'lunch') {
      activeField.edge === 'start' ? setLunchStart(timeStr) : setLunchEnd(timeStr);
    }

    if (event.type === 'set' || event.type === undefined) setActiveField(null);
  };

  const handleSave = async () => {
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
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.dateTitle, { color: themeColors.textPrimary }]}>{date}</Text>
      {isLocked && (
        <Text style={styles.lockedNote}>
          {status === 'pending_confirmation' ? 'Pending confirmation — locked until reviewed' : 'Confirmed — locked'}
        </Text>
      )}

      <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>Hours of rest</Text>
      {restPeriods.map((p, i) => (
        <View key={i} style={styles.row}>
          {renderTimeChip('Start', p.start, () => openPicker({ type: 'rest', index: i, edge: 'start' }))}
          <Text style={{ color: themeColors.textSecondary }}>→</Text>
          {renderTimeChip('End', p.end, () => openPicker({ type: 'rest', index: i, edge: 'end' }))}
        </View>
      ))}

      <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>Time worked</Text>
      <View style={styles.row}>
        {renderTimeChip('Start', workStart, () => openPicker({ type: 'work', edge: 'start' }))}
        <Text style={{ color: themeColors.textSecondary }}>→</Text>
        {renderTimeChip('End', workEnd, () => openPicker({ type: 'work', edge: 'end' }))}
      </View>

      <Text style={[styles.sectionLabel, { color: themeColors.textPrimary, marginTop: SPACING.lg }]}>Lunch break</Text>
      <View style={styles.row}>
        {renderTimeChip('Start', lunchStart, () => openPicker({ type: 'lunch', edge: 'start' }))}
        <Text style={{ color: themeColors.textSecondary }}>→</Text>
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
          {compliance.totalRestHours}h rest {compliance.compliant ? '— compliant' : '— not compliant'}
        </Text>
        {compliance.violations.map((v, i) => (
          <Text key={i} style={{ color: '#dc2626', fontSize: FONTS.sm, marginTop: 2 }}>{v}</Text>
        ))}
      </View>

      {!isLocked && (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  dateTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.xs },
  lockedNote: { color: '#d97706', marginBottom: SPACING.md, fontSize: FONTS.sm },
  sectionLabel: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  chip: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.md },
  complianceBox: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginVertical: SPACING.lg },
  saveButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: '600' },
});
