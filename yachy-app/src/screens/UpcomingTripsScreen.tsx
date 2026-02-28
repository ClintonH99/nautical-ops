/**
 * Upcoming Trips Screen
 * Main trips hub: calendar showing all trips + Guest / Boss / Delivery / Yard Period options
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import tripsService from '../services/trips';
import { Trip, TripType } from '../types';
import { useVesselTripColors, getTripTypeColorMap } from '../hooks/useVesselTripColors';
import { DEFAULT_COLORS } from '../services/tripColors';

// Full-day colored cells: period marking with same start/end = whole day in that color
type MarkedDates = { [date: string]: { startingDay?: boolean; endingDay?: boolean; color: string; textColor?: string } };

function getMarkedDatesFromTrips(
  trips: Trip[],
  typeColorMap: Record<string, string>
): MarkedDates {
  const byDate: Record<string, Set<TripType>> = {};

  trips.forEach((trip) => {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (!byDate[key]) byDate[key] = new Set();
      byDate[key].add(trip.type);
    }
  });

  const marked: MarkedDates = {};
  Object.entries(byDate).forEach(([date, types]) => {
    const arr = Array.from(types);
    const color = typeColorMap[arr[0]] ?? COLORS.primary;
    marked[date] = {
      startingDay: true,
      endingDay: true,
      color,
      textColor: COLORS.white,
    };
  });
  return marked;
}

export const UpcomingTripsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const { colors: tripColors, load: loadColors } = useVesselTripColors(vesselId);

  const typeColorMap = tripColors ? getTripTypeColorMap(tripColors) : getTripTypeColorMap(DEFAULT_COLORS);
  const c = tripColors ?? DEFAULT_COLORS;

  const [visibleTypes, setVisibleTypes] = useState<Record<TripType, boolean>>({
    GUEST: true,
    BOSS: true,
    DELIVERY: true,
    YARD_PERIOD: true,
  });

  const toggleVisible = (type: TripType) => {
    setVisibleTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    try {
      const [data] = await Promise.all([
        tripsService.getTripsByVessel(vesselId),
        loadColors(),
      ]);
      setTrips(data);
    } catch (e) {
      console.error('Load trips error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId, loadColors]);

  useFocusEffect(
    useCallback(() => {
      loadTrips();
    }, [loadTrips])
  );

  useEffect(() => {
    if (!isHOD) return;
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('TripColorSettings')}
          style={{ marginRight: SPACING.md }}
        >
          <Text style={[styles.headerButtonText, { color: themeColors.textPrimary }]}>Edit colors</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, isHOD, themeColors.textPrimary]);

  const onRefresh = () => {
    setRefreshing(true);
    loadTrips();
  };

  const filteredTrips = trips.filter((t) => visibleTypes[t.type]);
  const markedDates = getMarkedDatesFromTrips(filteredTrips, typeColorMap);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const tripsStartingTomorrow = trips.filter((t) => t.startDate === tomorrowStr);

  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: themeColors.textSecondary,
    selectedDayBackgroundColor: COLORS.primary,
    selectedDayTextColor: COLORS.white,
    todayTextColor: COLORS.primary,
    dayTextColor: themeColors.textPrimary,
    textDisabledColor: COLORS.gray400,
    arrowColor: COLORS.primary,
    monthTextColor: COLORS.primary,
    textDayHeaderFontSize: FONTS.sm,
    textMonthFontSize: FONTS.lg,
    textDayFontSize: FONTS.base,
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see upcoming trips.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
      }
    >
      <Text style={[styles.sectionTitle, { color: COLORS.primary }]}>Calendar</Text>
      <View style={[styles.calendarCard, { backgroundColor: themeColors.surface }]}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
        ) : (
          <Calendar
            current={new Date().toISOString().slice(0, 10)}
            markedDates={markedDates}
            markingType="period"
            theme={calendarTheme}
            onMonthChange={() => {}}
            hideExtraDays
          />
        )}
        <View style={styles.legend}>
          {visibleTypes.GUEST && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: c.guest }]} />
              <Text style={[styles.legendText, { color: themeColors.textSecondary }]}>Guest</Text>
            </View>
          )}
          {visibleTypes.BOSS && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: c.boss }]} />
              <Text style={[styles.legendText, { color: themeColors.textSecondary }]}>Boss</Text>
            </View>
          )}
          {visibleTypes.DELIVERY && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: c.delivery }]} />
              <Text style={[styles.legendText, { color: themeColors.textSecondary }]}>Delivery</Text>
            </View>
          )}
          {visibleTypes.YARD_PERIOD && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: c.yardPeriod }]} />
              <Text style={[styles.legendText, { color: themeColors.textSecondary }]}>Yard</Text>
            </View>
          )}
        </View>
      </View>

      {tripsStartingTomorrow.length > 0 && (
        <View style={styles.tripTomorrowBanner}>
          <Text style={styles.tripTomorrowBannerText}>
            Trip{tripsStartingTomorrow.length > 1 ? 's' : ''} starting tomorrow – review your pre-departure checklist
          </Text>
        </View>
      )}
      <View style={styles.preDepartureRow}>
        <TouchableOpacity
          style={[styles.preDepartureBtn, { backgroundColor: themeColors.surface }]}
          onPress={() => navigation.navigate('PreDepartureChecklist')}
          activeOpacity={0.8}
        >
          <Text style={styles.preDepartureEmoji}>📋</Text>
          <View style={styles.preDepartureTextWrap}>
            <Text style={[styles.preDepartureLabel, { color: themeColors.textPrimary }]}>Pre-Departure Checklist</Text>
            <Text style={[styles.preDepartureHint, { color: themeColors.textSecondary }]}>
              {tripsStartingTomorrow.length > 0
                ? `Trip${tripsStartingTomorrow.length > 1 ? 's' : ''} tomorrow: ${tripsStartingTomorrow.map((t) => t.title).join(', ')}`
                : 'HODs: Add tasks for crew before departure'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: COLORS.primary }]}>Trip types</Text>
      <Text style={[styles.filterHint, { color: COLORS.textTertiary }]}>Tap card to open • Tap Show/Hide to filter calendar</Text>
      <View style={styles.optionsRow}>
        <View style={[styles.optionCard, { backgroundColor: themeColors.surface, borderLeftColor: c.guest }]}>
          <TouchableOpacity style={styles.optionCardMain} onPress={() => navigation.navigate('GuestTrips')} activeOpacity={0.8}>
            <Text style={styles.optionEmoji}>👥</Text>
            <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Guest Trips</Text>
            <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>Charter guests</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.visibilityBtn} onPress={() => toggleVisible('GUEST')}>
            <Text style={[styles.visibilityBtnText, !visibleTypes.GUEST && styles.visibilityBtnTextDim]}>
              {visibleTypes.GUEST ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.optionCard, { backgroundColor: themeColors.surface, borderLeftColor: c.boss }]}>
          <TouchableOpacity style={styles.optionCardMain} onPress={() => navigation.navigate('BossTrips')} activeOpacity={0.8}>
            <Text style={styles.optionEmoji}>⚓</Text>
            <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Boss Trips</Text>
            <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>Owner / family</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.visibilityBtn} onPress={() => toggleVisible('BOSS')}>
            <Text style={[styles.visibilityBtnText, !visibleTypes.BOSS && styles.visibilityBtnTextDim]}>
              {visibleTypes.BOSS ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={[styles.optionsRow, styles.optionsRowSecond]}>
        <View style={[styles.optionCard, { backgroundColor: themeColors.surface, borderLeftColor: c.delivery }]}>
          <TouchableOpacity style={styles.optionCardMain} onPress={() => navigation.navigate('DeliveryTrips')} activeOpacity={0.8}>
            <Text style={styles.optionEmoji}>🚢</Text>
            <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Delivery</Text>
            <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>Delivery periods</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.visibilityBtn} onPress={() => toggleVisible('DELIVERY')}>
            <Text style={[styles.visibilityBtnText, !visibleTypes.DELIVERY && styles.visibilityBtnTextDim]}>
              {visibleTypes.DELIVERY ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.optionCard, { backgroundColor: themeColors.surface, borderLeftColor: c.yardPeriod }]}>
          <TouchableOpacity style={styles.optionCardMain} onPress={() => navigation.navigate('YardPeriodTrips')} activeOpacity={0.8}>
            <Text style={styles.optionEmoji}>🔧</Text>
            <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Yard Period</Text>
            <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>Yard / maintenance</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.visibilityBtn} onPress={() => toggleVisible('YARD_PERIOD')}>
            <Text style={[styles.visibilityBtnText, !visibleTypes.YARD_PERIOD && styles.visibilityBtnTextDim]}>
              {visibleTypes.YARD_PERIOD ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  calendarCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  loader: {
    padding: SPACING.xl,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: { fontSize: FONTS.sm },
  optionsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  optionsRowSecond: {
    marginTop: SPACING.sm,
  },
  filterHint: {
    fontSize: FONTS.xs,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  tripTomorrowBanner: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  tripTomorrowBannerText: {
    color: COLORS.white,
    fontSize: FONTS.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  preDepartureRow: {
    marginBottom: SPACING.lg,
  },
  preDepartureBtn: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.secondary,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  preDepartureEmoji: {
    fontSize: 32,
    marginRight: SPACING.md,
  },
  preDepartureTextWrap: {
    flex: 1,
  },
  preDepartureLabel: { fontSize: FONTS.lg, fontWeight: '600' },
  preDepartureHint: { fontSize: FONTS.sm, marginTop: 2 },
  optionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  optionCardMain: {
    flex: 1,
  },
  visibilityBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  visibilityBtnText: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    color: COLORS.primary,
  },
  visibilityBtnTextDim: {
    color: COLORS.textTertiary,
  },
  optionEmoji: {
    fontSize: 28,
    marginBottom: SPACING.xs,
  },
  optionTitle: { fontSize: FONTS.lg, fontWeight: '600' },
  optionSubtitle: { fontSize: FONTS.sm, marginTop: 2 },
  headerButtonText: { fontSize: FONTS.sm, fontWeight: '600' },
});
