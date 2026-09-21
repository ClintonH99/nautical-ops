/**
 * View Pre-Departure Checklist Screen
 * Read-only view for users to view published checklists
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import preDepartureChecklistsService from '../services/preDepartureChecklists';
import { PreDepartureChecklist, Department } from '../types';
import { LoadingSpinner, PageHeader } from '../components';
import { formatLocalDateString } from '../utils';

const DEPARTMENT_OPTIONS: { value: Department | null; label: string }[] = [
  { value: null, label: 'All Departments' },
  { value: 'BRIDGE', label: 'Bridge' },
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'EXTERIOR', label: 'Exterior' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'GALLEY', label: 'Galley' },
];

export const ViewPreDepartureChecklistScreen = ({ route }: any) => {
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
    ? (DEPARTMENT_OPTIONS.find((o) => o.value === checklist.department)?.label ??
      checklist.department)
    : 'All Departments';

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  if (!checklistId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          No checklist selected.
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

  if (!checklist) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Checklist not found.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Pre-Departure Checklist" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
      >
        <View
          style={[
            styles.section,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.eyebrow, { color: themeColors.textSecondary }]}>
            {deptLabel.toUpperCase()}
          </Text>
          <Text
            style={[styles.title, { color: themeColors.isDark ? COLORS.white : COLORS.primary }]}
          >
            {checklist.title}
          </Text>
          <Text style={[styles.date, { color: themeColors.textSecondary }]}>
            Created {formatDate(checklist.createdAt)}
          </Text>
        </View>

        {checklist.linkedTrip && (
          <View
            style={[
              styles.section,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <Text style={[styles.eyebrow, { color: themeColors.textSecondary }]}>LINKED TRIP</Text>
            <Text style={[styles.linkedTripTitle, { color: themeColors.textPrimary }]}>
              {checklist.linkedTrip.title}
            </Text>
            <Text style={[styles.linkedTripDates, { color: themeColors.textSecondary }]}>
              {formatLocalDateString(checklist.linkedTrip.startDate)} –{' '}
              {formatLocalDateString(checklist.linkedTrip.endDate)}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.section,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <View style={styles.itemsHeader}>
            <Text style={[styles.itemsLabel, { color: themeColors.textPrimary }]}>
              Checklist items
            </Text>
            <Text style={[styles.itemCount, { color: themeColors.textSecondary }]}>
              {checklist.items.length} items
            </Text>
          </View>
          {checklist.items.length === 0 ? (
            <Text style={[styles.emptyItems, { color: themeColors.textSecondary }]}>
              No items yet
            </Text>
          ) : (
            [...checklist.items]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item, idx) => (
                <View
                  key={item.id}
                  style={[styles.itemRow, { borderBottomColor: themeColors.border }]}
                >
                  <Text style={[styles.itemNum, { color: themeColors.textSecondary }]}>
                    {idx + 1}
                  </Text>
                  <Text style={[styles.itemLabel, { color: themeColors.textPrimary }]}>
                    {item.label}
                  </Text>
                </View>
              ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  content: { padding: SPACING.lg, paddingBottom: 88 },
  section: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  eyebrow: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  title: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: 4,
  },
  date: { fontSize: FONTS.sm },
  linkedTripTitle: { fontSize: FONTS.base, fontWeight: '700', marginTop: 2 },
  linkedTripDates: { fontSize: FONTS.sm, marginTop: 4 },
  itemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  itemsLabel: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  itemCount: { fontSize: FONTS.xs },
  emptyItems: { fontStyle: 'italic', fontSize: FONTS.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemNum: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    marginRight: SPACING.sm,
    minWidth: 22,
  },
  itemLabel: {
    flex: 1,
    fontSize: FONTS.base,
    lineHeight: 22,
  },
});
