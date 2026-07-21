/**
 * Watch Duties Screen
 * Rules (Captain/HOD editable, everyone can view/export), the week-ahead
 * watch assignment schedule, and department-tagged duty checklists
 * (built in a later pass).
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { getRules, saveRules, getWeekAssignments, WatchAssignment } from '../services/watchDuties';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export const WatchDutiesScreen = () => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const canManage = user?.role === 'CAPTAIN_MOV' || user?.role === 'HOD';

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState('');
  const [editingRules, setEditingRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [assignments, setAssignments] = useState<WatchAssignment[]>([]);

  const weekStart = getMonday(new Date());
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const loadData = useCallback(async () => {
    if (!user?.vesselId) return;
    setLoading(true);
    try {
      const [rulesData, assignmentData] = await Promise.all([
        getRules(user.vesselId),
        getWeekAssignments(user.vesselId, toDateStr(weekStart)),
      ]);
      setRules(rulesData);
      setAssignments(assignmentData);
    } catch (e) {
      console.error('Load Watch Duties error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.vesselId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleSaveRules = async () => {
    if (!user?.vesselId) return;
    setSavingRules(true);
    try {
      await saveRules(user.vesselId, rulesDraft);
      setRules(rulesDraft);
      setEditingRules(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to save rules.');
    } finally {
      setSavingRules(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center' }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>This week</Text>
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        {weekDates.map((d, i) => {
          const dateStr = toDateStr(d);
          const dayAssignments = assignments.filter((a) => a.date === dateStr);
          return (
            <View
              key={dateStr}
              style={[styles.weekRow, i < weekDates.length - 1 && styles.weekRowBorder, { borderColor: themeColors.textSecondary + '30' }]}
            >
              <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm }}>
                {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </Text>
              {dayAssignments.length === 0 ? (
                <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm, opacity: 0.6 }}>Not assigned</Text>
              ) : (
                <View style={{ alignItems: 'flex-end' }}>
                  {dayAssignments.map((a) => (
                    <Text key={a.id} style={{ color: themeColors.textPrimary, fontSize: FONTS.sm }}>
                      {a.userName} · {a.startTime}–{a.endTime}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View style={[styles.card, { backgroundColor: themeColors.surface, marginTop: SPACING.lg }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary, marginBottom: 0 }]}>Rules</Text>
          {canManage && !editingRules && (
            <TouchableOpacity onPress={() => { setRulesDraft(rules); setEditingRules(true); }}>
              <Text style={{ color: COLORS.primary, fontSize: FONTS.sm, fontWeight: '600' }}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        {editingRules ? (
          <>
            <TextInput
              value={rulesDraft}
              onChangeText={setRulesDraft}
              multiline
              style={[styles.rulesInput, { color: themeColors.textPrimary, borderColor: themeColors.textSecondary }]}
              placeholder="Enter watch duty rules..."
              placeholderTextColor={themeColors.textSecondary}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
              <TouchableOpacity onPress={() => setEditingRules(false)} style={styles.secondaryButton}>
                <Text style={{ color: themeColors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveRules} disabled={savingRules} style={styles.primaryButton}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>{savingRules ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : rules.trim() ? (
          <View style={{ marginTop: SPACING.sm }}>
            {rules
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((line, i) => (
                <Text key={i} style={{ color: themeColors.textSecondary, fontSize: FONTS.sm, marginBottom: 4 }}>
                  {i + 1}. {line.trim()}
                </Text>
              ))}
          </View>
        ) : (
          <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm, marginTop: SPACING.sm }}>
            No rules set yet.
          </Text>
        )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  sectionTitle: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  weekRowBorder: { borderBottomWidth: 1 },
  rulesInput: { borderWidth: 1, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, minHeight: 80, textAlignVertical: 'top', fontSize: FONTS.sm },
  primaryButton: { flex: 1, backgroundColor: COLORS.primary, padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
});
