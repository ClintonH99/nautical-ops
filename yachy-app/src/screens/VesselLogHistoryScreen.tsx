import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Button, PageHeader } from '../components';
import { BORDER_RADIUS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useScreenState } from '../hooks/useScreenState';
import { useCurrentLogMonth } from '../hooks/useVesselLogPeriod';
import { useAuthStore } from '../store';
import vesselService from '../services/vessel';
import {
  logMonthLabel,
  vesselHistoryMonths,
  VESSEL_LOG_KINDS,
  VesselLogKind,
} from '../utils/vesselLogHistory';

export const VesselLogHistoryScreen = ({ navigation, route }: any) => {
  const colors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const currentMonth = useCurrentLogMonth();
  const kind = route.params?.kind as VesselLogKind;
  const definition = Object.prototype.hasOwnProperty.call(VESSEL_LOG_KINDS, kind)
    ? VESSEL_LOG_KINDS[kind]
    : undefined;
  const allowed = !!vesselId && route.params?.vesselId === vesselId && !!definition;
  const [createdAt, setCreatedAt] = useScreenState<string | null>('vesselCreatedAt', null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const year = typeof route.params?.year === 'string' ? route.params.year : null;

  useFocusEffect(
    useCallback(() => {
      if (!allowed || !vesselId) return;
      let active = true;
      setError(false);
      vesselService
        .getVessel(vesselId)
        .then((vessel) => {
          if (!active) return;
          if (!vessel || !Number.isFinite(new Date(vessel.createdAt).getTime())) {
            setError(true);
            return;
          }
          setCreatedAt(vessel.createdAt);
        })
        .catch(() => {
          if (active) setError(true);
        });
      return () => {
        active = false;
      };
    }, [allowed, vesselId, setCreatedAt, attempt])
  );

  const months = allowed && createdAt ? vesselHistoryMonths(createdAt, currentMonth) : [];
  const years = [...new Set(months.map((month) => month.slice(0, 4)))];
  const choices = year ? months.filter((month) => month.startsWith(`${year}-`)) : years;

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <PageHeader title={year ? `${year} History` : 'History'} />
      <ScrollView contentContainerStyle={styles.content}>
        {definition ? (
          <Text style={[styles.title, { color: colors.textPrimary }]}>{definition.title}</Text>
        ) : null}
        {!allowed ? (
          <Text style={{ color: colors.textSecondary }}>
            Open History from your current vessel&apos;s log.
          </Text>
        ) : error && !createdAt ? (
          <View>
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              Could not load the vessel&apos;s history.
            </Text>
            <Button
              title="Retry"
              variant="outline"
              onPress={() => setAttempt((value) => value + 1)}
            />
          </View>
        ) : !createdAt ? (
          <Text style={{ color: colors.textSecondary }}>Loading history…</Text>
        ) : choices.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>No previous months yet.</Text>
        ) : (
          choices.map((value) => (
            <TouchableOpacity
              key={value}
              accessibilityRole="button"
              accessibilityLabel={year ? logMonthLabel(value) : value}
              activeOpacity={0.75}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() =>
                year
                  ? navigation.push(definition!.route, {
                      historyMonth: value,
                      historyVesselId: vesselId,
                    })
                  : navigation.push('VesselLogHistory', { kind, vesselId, year: value })
              }
            >
              <Text style={[styles.label, { color: colors.textPrimary }]}>
                {year ? logMonthLabel(value, false) : value}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  title: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    minHeight: 64,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
  },
  label: { flex: 1, fontSize: FONTS.lg, fontWeight: '600' },
  message: { marginBottom: SPACING.md, fontSize: FONTS.base },
});
