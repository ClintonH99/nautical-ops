import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
/**
 * Upcoming Trips Screen
 * Main trips hub: calendar showing Guest, Boss, and Delivery trips.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import tripsService from '../services/trips';
import preDepartureChecklistsService from '../services/preDepartureChecklists';
import { PreDepartureChecklist, Trip, TripType } from '../types';
import { useVesselTripColors, getTripTypeColorMap } from '../hooks/useVesselTripColors';
import { DEFAULT_COLORS } from '../services/tripColors';
import { formatLocalDateString, parseLocalDate, toYYYYMMDD } from '../utils';
import { LoadingSpinner, PageHeader, PillButton } from '../components';

// Full-day colored cells: period marking with same start/end = whole day in that color
type MarkedDates = {
  [date: string]: { startingDay?: boolean; endingDay?: boolean; color: string; textColor?: string };
};

function getMarkedDatesFromTrips(trips: Trip[], typeColorMap: Record<string, string>): MarkedDates {
  const byDate: Record<string, Set<TripType>> = {};

  trips.forEach((trip) => {
    const start = parseLocalDate(trip.startDate);
    const end = parseLocalDate(trip.endDate);
    for (let d = new Date(start.getTime()); d <= end; d.setDate(d.getDate() + 1)) {
      const key = toYYYYMMDD(d);
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
  const [checklists, setChecklists] = useState<PreDepartureChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const { colors: tripColors, load: loadColors } = useVesselTripColors(vesselId);

  const typeColorMap = tripColors
    ? getTripTypeColorMap(tripColors)
    : getTripTypeColorMap(DEFAULT_COLORS);
  const c = tripColors ?? DEFAULT_COLORS;

  const [visibleTypes, setVisibleTypes] = useState<Record<TripType, boolean>>({
    GUEST: true,
    BOSS: true,
    DELIVERY: true,
    YARD_PERIOD: false,
  });

  const toggleVisible = (type: TripType) => {
    setVisibleTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    try {
      const [data, checklistData] = await Promise.all([
        tripsService.getTripsByVessel(vesselId),
        preDepartureChecklistsService.getByVessel(vesselId),
        loadColors(),
      ]);
      setTrips(data);
      setChecklists(checklistData);
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

  const onRefresh = () => {
    setRefreshing(true);
    loadTrips();
  };

  const filteredTrips = trips.filter(
    (trip) => trip.type !== 'YARD_PERIOD' && visibleTypes[trip.type]
  );
  const markedDates = getMarkedDatesFromTrips(filteredTrips, typeColorMap);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const tripsStartingTomorrow = trips.filter(
    (trip) => trip.type !== 'YARD_PERIOD' && trip.startDate === tomorrowStr
  );
  const todayStr = toYYYYMMDD(new Date());
  const linkedUpcomingChecklists = checklists
    .map((checklist) => ({
      checklist,
      trip: trips.find((trip) => trip.id === checklist.tripId),
    }))
    .filter((entry): entry is { checklist: PreDepartureChecklist; trip: Trip } =>
      Boolean(entry.trip && entry.trip.type !== 'YARD_PERIOD' && entry.trip.endDate >= todayStr)
    )
    .sort((a, b) => a.trip.startDate.localeCompare(b.trip.startDate));

  const calendarTextColor = themeColors.isDark ? COLORS.white : COLORS.black;
  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: calendarTextColor,
    selectedDayBackgroundColor: COLORS.primary,
    selectedDayTextColor: COLORS.white,
    todayTextColor: calendarTextColor,
    dayTextColor: calendarTextColor,
    textDisabledColor: calendarTextColor,
    arrowColor: calendarTextColor,
    monthTextColor: calendarTextColor,
    textDayHeaderFontSize: FONTS.sm,
    textMonthFontSize: FONTS.lg,
    textDayFontSize: FONTS.base,
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to see upcoming trips.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader
        title="Upcoming Trips"
        actions={
          <PillButton
            label="Edit Colors"
            onPress={() => navigation.navigate('TripColorSettings')}
          />
        }
      />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {tripsStartingTomorrow.length > 0 && (
          <View style={styles.tripTomorrowBanner}>
            <Text style={styles.tripTomorrowBannerText}>
              Trip{tripsStartingTomorrow.length > 1 ? 's' : ''} starting tomorrow – review your
              pre-departure checklist
            </Text>
          </View>
        )}
        <View style={styles.preDepartureRow}>
          <TouchableOpacity
            style={[
              styles.preDepartureBtn,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
            onPress={() => navigation.navigate('PreDepartureChecklist')}
            activeOpacity={0.8}
          >
            <View style={[styles.preDepartureIcon, { backgroundColor: themeColors.accentSoft }]}>
              <Ionicons name="clipboard-outline" size={23} color={themeColors.accent} />
            </View>
            <View style={styles.preDepartureTextWrap}>
              <Text style={[styles.preDepartureLabel, { color: themeColors.textPrimary }]}>
                Pre-Departure Checklist
              </Text>
              <Text style={[styles.preDepartureHint, { color: themeColors.textSecondary }]}>
                {tripsStartingTomorrow.length > 0
                  ? `Trip${tripsStartingTomorrow.length > 1 ? 's' : ''} tomorrow: ${tripsStartingTomorrow.map((t) => t.title).join(', ')}`
                  : 'Add tasks for crew before departure'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
          </TouchableOpacity>
        </View>

        {linkedUpcomingChecklists.length > 0 && (
          <View style={styles.linkedChecklistSection}>
            <Text
              style={[
                styles.linkedChecklistHeading,
                { color: themeColors.isDark ? COLORS.white : COLORS.primary },
              ]}
            >
              Linked trip checklists
            </Text>
            {linkedUpcomingChecklists.map(({ checklist, trip }) => (
              <TouchableOpacity
                key={checklist.id}
                style={[
                  styles.linkedChecklistCard,
                  { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                ]}
                onPress={() =>
                  navigation.navigate('ViewPreDepartureChecklist', {
                    checklistId: checklist.id,
                  })
                }
                activeOpacity={0.8}
              >
                <View style={styles.linkedChecklistContent}>
                  <Text style={[styles.linkedChecklistTitle, { color: themeColors.textPrimary }]}>
                    {checklist.title}
                  </Text>
                  <Text style={[styles.linkedChecklistTrip, { color: themeColors.textSecondary }]}>
                    {trip.title} · {formatLocalDateString(trip.startDate)} –{' '}
                    {formatLocalDateString(trip.endDate)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text
          style={[
            styles.sectionTitle,
            { color: themeColors.isDark ? COLORS.white : COLORS.primary },
          ]}
        >
          Trip Types
        </Text>
        <View style={styles.optionsRow}>
          <View
            style={[
              styles.optionCard,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <TouchableOpacity
              style={styles.optionCardMain}
              onPress={() => navigation.navigate('GuestTrips')}
              activeOpacity={0.8}
            >
              <View style={[styles.tripTypeDot, { backgroundColor: c.guest }]} />
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>
                  Guest Trips
                </Text>
                <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>
                  Charter guests
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.visibilityBtn} onPress={() => toggleVisible('GUEST')}>
              <Ionicons
                name={visibleTypes.GUEST ? 'eye-outline' : 'eye-off-outline'}
                size={17}
                color={visibleTypes.GUEST ? themeColors.accent : themeColors.textSecondary}
              />
              <Text
                style={[
                  styles.visibilityBtnText,
                  { color: themeColors.accent },
                  !visibleTypes.GUEST && styles.visibilityBtnTextDim,
                ]}
              >
                {visibleTypes.GUEST ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>
          <View
            style={[
              styles.optionCard,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <TouchableOpacity
              style={styles.optionCardMain}
              onPress={() => navigation.navigate('BossTrips')}
              activeOpacity={0.8}
            >
              <View style={[styles.tripTypeDot, { backgroundColor: c.boss }]} />
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>
                  Boss Trips
                </Text>
                <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>
                  Owner / family
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.visibilityBtn} onPress={() => toggleVisible('BOSS')}>
              <Ionicons
                name={visibleTypes.BOSS ? 'eye-outline' : 'eye-off-outline'}
                size={17}
                color={visibleTypes.BOSS ? themeColors.accent : themeColors.textSecondary}
              />
              <Text
                style={[
                  styles.visibilityBtnText,
                  { color: themeColors.accent },
                  !visibleTypes.BOSS && styles.visibilityBtnTextDim,
                ]}
              >
                {visibleTypes.BOSS ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.optionsRow, styles.optionsRowSecond]}>
          <View
            style={[
              styles.optionCard,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <TouchableOpacity
              style={styles.optionCardMain}
              onPress={() => navigation.navigate('DeliveryTrips')}
              activeOpacity={0.8}
            >
              <View style={[styles.tripTypeDot, { backgroundColor: c.delivery }]} />
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>
                  Delivery
                </Text>
                <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>
                  Delivery periods
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.visibilityBtn}
              onPress={() => toggleVisible('DELIVERY')}
            >
              <Ionicons
                name={visibleTypes.DELIVERY ? 'eye-outline' : 'eye-off-outline'}
                size={17}
                color={visibleTypes.DELIVERY ? themeColors.accent : themeColors.textSecondary}
              />
              <Text
                style={[
                  styles.visibilityBtnText,
                  { color: themeColors.accent },
                  !visibleTypes.DELIVERY && styles.visibilityBtnTextDim,
                ]}
              >
                {visibleTypes.DELIVERY ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
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
    marginBottom: SPACING.md,
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
    flexDirection: 'column',
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
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: 1,
  },
  preDepartureIcon: {
    width: 42,
    height: 42,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preDepartureTextWrap: {
    flex: 1,
  },
  preDepartureLabel: { fontSize: FONTS.lg, fontWeight: '600' },
  preDepartureHint: { fontSize: FONTS.sm, marginTop: 2 },
  linkedChecklistSection: { marginBottom: SPACING.xl, gap: SPACING.sm },
  linkedChecklistHeading: { fontSize: FONTS.lg, fontWeight: '700' },
  linkedChecklistCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  linkedChecklistContent: { flex: 1 },
  linkedChecklistTitle: { fontSize: FONTS.base, fontWeight: '700' },
  linkedChecklistTrip: { fontSize: FONTS.sm, marginTop: 2 },
  optionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
  },
  optionCardMain: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  visibilityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  visibilityBtnText: {
    fontSize: FONTS.xs,
    fontWeight: '600',
  },
  visibilityBtnTextDim: {
    color: COLORS.textTertiary,
  },
  tripTypeDot: { width: 10, height: 10, borderRadius: 5 },
  optionTextWrap: { flex: 1 },
  optionTitle: { fontSize: FONTS.lg, fontWeight: '600' },
  optionSubtitle: { fontSize: FONTS.sm, marginTop: 2 },
  headerButtonText: { fontSize: FONTS.sm, fontWeight: '600' },
});
