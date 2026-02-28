/**
 * View Pre-Departure Checklist Screen
 * Read-only view for users to view published checklists
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import preDepartureChecklistsService from '../services/preDepartureChecklists';
import { PreDepartureChecklist, Department } from '../types';

const DEPARTMENT_OPTIONS: { value: Department | null; label: string }[] = [
  { value: null, label: 'All Departments' },
  { value: 'BRIDGE', label: 'Bridge' },
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'EXTERIOR', label: 'Exterior' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'GALLEY', label: 'Galley' },
];

export const ViewPreDepartureChecklistScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const checklistId = route?.params?.checklistId as string;

  const [checklist, setChecklist] = useState<PreDepartureChecklist | null>(null);
  const [loading, setLoading] = useState(true);

  const loadChecklist = useCallback(async () => {
    if (!checklistId) return;
    try {
      const c = await preDepartureChecklistsService.getById(checklistId);
      setChecklist(c);
    } catch (e) {
      console.error('Load checklist error:', e);
    } finally {
      setLoading(false);
    }
  }, [checklistId]);

  useFocusEffect(
    useCallback(() => {
      loadChecklist();
    }, [loadChecklist])
  );

  const deptLabel = checklist?.department
    ? DEPARTMENT_OPTIONS.find((o) => o.value === checklist.department)?.label ?? checklist.department
    : 'All Departments';

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  if (!checklistId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>No checklist selected.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!checklist) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Checklist not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>{checklist.title}</Text>
        <View style={styles.meta}>
          <Text style={[styles.deptBadge, { color: themeColors.textSecondary }]}>{deptLabel}</Text>
          <Text style={[styles.date, { color: themeColors.textSecondary }]}>{formatDate(checklist.createdAt)}</Text>
        </View>

        <View style={styles.itemsSection}>
          <Text style={[styles.itemsLabel, { color: themeColors.textPrimary }]}>Checklist items</Text>
          {checklist.items.length === 0 ? (
            <Text style={[styles.emptyItems, { color: themeColors.textSecondary }]}>No items yet</Text>
          ) : (
            checklist.items
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item, idx) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={[styles.itemNum, { color: themeColors.textSecondary }]}>{idx + 1}.</Text>
                  <Text style={[styles.itemLabel, { color: themeColors.textPrimary }]}>{item.label}</Text>
                </View>
              ))
          )}
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  content: { padding: SPACING.lg, paddingBottom: 88 },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  deptBadge: {
    fontSize: FONTS.xs,
    backgroundColor: COLORS.gray100,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  date: { fontSize: FONTS.sm },
  itemsSection: {},
  itemsLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  emptyItems: { fontStyle: 'italic', fontSize: FONTS.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  itemNum: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginRight: SPACING.sm,
    minWidth: 20,
  },
  itemLabel: {
    flex: 1,
    fontSize: FONTS.base,
    lineHeight: 22,
  },
});
