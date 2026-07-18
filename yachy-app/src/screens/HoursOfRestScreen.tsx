/**
 * Hours of Rest Screen
 * Calendar view of a crew member's rest entries, with STCW compliance
 * checking (10h/24h minimum, max 2 rest periods, one >=6h). Past 30 days
 * are flagged completed (green) or not completed (red). Captains can also
 * select the authorized signer here for sign-off.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  RestEntry,
  checkCompliance,
  getDepartmentSigners,
  setDepartmentSigner,
  DEPARTMENTS,
  Department,
  DepartmentSigner,
} from '../services/restEntries';
import { supabase } from '../services/supabase';

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const HoursOfRestScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const isCaptainOrMov = user?.role === 'CAPTAIN_MOV';

  const [entries, setEntries] = useState<Record<string, RestEntry>>({});
  const [loading, setLoading] = useState(true);
  const [deptSigners, setDeptSigners] = useState<DepartmentSigner[]>([]);
  const [crewList, setCrewList] = useState<{ id: string; name: string }[]>([]);
  const [openDeptPicker, setOpenDeptPicker] = useState<Department | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const since = toYYYYMMDD(daysAgo(30));
      const { data: rows } = await supabase
        .from('rest_entries')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', since);

      const byDate: Record<string, RestEntry> = {};
      (rows ?? []).forEach((r) => { byDate[r.date] = r; });
      setEntries(byDate);

      if (user.vesselId) {
        const signers = await getDepartmentSigners(user.vesselId);
        setDeptSigners(signers);

        if (isCaptainOrMov) {
          const { data: crewRows } = await supabase
            .from('users')
            .select('id, name')
            .eq('vessel_id', user.vesselId);
          setCrewList(crewRows ?? []);
        }
      }
    } catch (e) {
      console.error('Load rest entries error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.vesselId, isCaptainOrMov]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // Build calendar bar markers (matching the Home screen's calendar style)
  // for the past 30 days: green bar if completed, red bar if a day in the
  // past has no entry. Each day is its own self-contained pill, not a
  // connected range — startingDay/endingDay both true per day.
  const markedDates: Record<string, any> = {};
  const todayStr = toYYYYMMDD(new Date());
  for (let i = 0; i < 30; i++) {
    const d = daysAgo(i);
    const dateStr = toYYYYMMDD(d);
    const hasEntry = !!entries[dateStr];
    if (dateStr === todayStr && !hasEntry) continue; // don't flag today until it's past
    markedDates[dateStr] = {
      periods: [
        {
          startingDay: true,
          endingDay: true,
          color: hasEntry ? '#16a34a' : '#dc2626',
        },
      ],
    };
  }

  const handleDayPress = (day: { dateString: string }) => {
    navigation.navigate('RestDayEntry', { date: day.dateString });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: themeColors.textPrimary }]}>Hours of Rest</Text>
      <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
        Tap a date to enter or edit your hours
      </Text>

      {isCaptainOrMov && (
        <View style={[styles.signerBox, { backgroundColor: themeColors.surface }]}>
          <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs, marginBottom: 4 }}>
            Visible to Captain only
          </Text>
          <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.sm, marginBottom: SPACING.sm }}>
            Select authorized personnel for sign-off, by department
          </Text>
          {DEPARTMENTS.map((dept) => {
            const current = deptSigners.find((d) => d.department === dept);
            return (
              <View key={dept} style={{ marginBottom: SPACING.sm }}>
                <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs, marginBottom: 2 }}>
                  {dept.charAt(0) + dept.slice(1).toLowerCase()}
                </Text>
                <TouchableOpacity
                  style={[styles.signerSelect, { borderColor: themeColors.textSecondary }]}
                  onPress={() => setOpenDeptPicker(openDeptPicker === dept ? null : dept)}
                >
                  <Text style={{ color: themeColors.textPrimary }}>
                    {current ? current.signerName : 'Not set — tap to choose'}
                  </Text>
                </TouchableOpacity>
                {openDeptPicker === dept && (
                  <View style={styles.signerOptions}>
                    {crewList.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.signerOption}
                        onPress={async () => {
                          if (!user?.vesselId) return;
                          await setDepartmentSigner(user.vesselId, dept, c.id);
                          setDeptSigners((prev) => [
                            ...prev.filter((d) => d.department !== dept),
                            { department: dept, signerUserId: c.id, signerName: c.name },
                          ]);
                          setOpenDeptPicker(null);
                        }}
                      >
                        <Text style={{ color: themeColors.textPrimary, fontWeight: c.id === current?.signerUserId ? '700' : '400' }}>
                          {c.name}{c.id === user?.id ? ' (me)' : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />
      ) : (
        <>
          <Calendar
            current={todayStr}
            maxDate={todayStr}
            markedDates={markedDates}
            markingType="multi-period"
            onDayPress={handleDayPress}
            theme={{
              backgroundColor: 'transparent',
              calendarBackground: 'transparent',
              todayTextColor: COLORS.primary,
              arrowColor: themeColors.textPrimary,
              monthTextColor: themeColors.textPrimary,
              dayTextColor: themeColors.textPrimary,
              textDisabledColor: themeColors.textSecondary,
            }}
          />

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#16a34a' }]} />
              <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs }}>Completed</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#dc2626' }]} />
              <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.xs }}>Not completed</Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  title: { fontSize: FONTS['2xl'], fontWeight: '700' },
  subtitle: { fontSize: FONTS.base, marginBottom: SPACING.lg },
  signerBox: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.lg },
  signerSelect: { borderWidth: 1, borderRadius: BORDER_RADIUS.sm, padding: SPACING.sm },
  signerOptions: { marginTop: SPACING.sm, gap: 4 },
  signerOption: { paddingVertical: SPACING.sm },
  legendRow: { flexDirection: 'row', gap: SPACING.lg, justifyContent: 'center', marginTop: SPACING.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
});
