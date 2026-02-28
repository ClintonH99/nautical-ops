/**
 * Home/Dashboard Screen
 * Fresh, minimalist design — image-centric, maritime-focused
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES, useDepartmentColorStore, getDepartmentColor } from '../store';
import vesselService from '../services/vessel';
import tripsService from '../services/trips';
import { useVesselTripColors, getTripTypeColorMap } from '../hooks/useVesselTripColors';
import { DEFAULT_COLORS } from '../services/tripColors';
import type { Trip, TripType, Department } from '../types';

const { width } = Dimensions.get('window');
const CATEGORY_SIZE = (width - SPACING.xl * 2 - SPACING.md * 2) / 3;
const BANNER_HEIGHT = 220;

// Default vessel banner when none set
const DEFAULT_BANNER_IMAGE =
  'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200';

const CATEGORY_IMAGES: Record<string, string> = {
  trips: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=400',
  tasks: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=400',
  maintenance: 'https://images.unsplash.com/photo-1564415315949-7a0c4c73aade?w=400',
};

type MarkedDates = { [date: string]: { startingDay?: boolean; endingDay?: boolean; color: string; textColor?: string } };

function getMarkedDatesFromTrips(trips: Trip[], typeColorMap: Record<string, string>): MarkedDates {
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
    marked[date] = {
      startingDay: true,
      endingDay: true,
      color: typeColorMap[arr[0]] ?? COLORS.primary,
      textColor: COLORS.white,
    };
  });
  return marked;
}

function getMarkedDatesFromYardPeriodTrips(
  trips: Trip[],
  defaultColor: string,
  getDeptColor: (dept: string) => string
): MarkedDates {
  const yardTrips = trips.filter((t) => t.type === 'YARD_PERIOD');
  const marked: MarkedDates = {};
  yardTrips.forEach((trip) => {
    const color = trip.department ? getDeptColor(trip.department) : defaultColor;
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      marked[key] = {
        startingDay: key === trip.startDate,
        endingDay: key === trip.endDate,
        color,
        textColor: COLORS.white,
      };
    }
  });
  return marked;
}

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

/** Home categories: Tasks, Shopping, Inventory in a row; Vessel & Crew Safety as log button below */
const HOME_CATEGORIES = [
  { key: 'tasks', label: 'Tasks', icon: '📝', nav: 'Tasks' as const },
  { key: 'shopping', label: 'Shopping', icon: '🛒', nav: 'ShoppingListCategory' as const },
  { key: 'inventory', label: 'Inventory', icon: '📦', nav: 'Inventory' as const },
];

/** Trips calendar accent – ocean teal */
const CALENDAR_ACCENT = '#0d9488';

const TRIP_TYPE_LABELS: Record<string, string> = {
  GUEST: 'Guest',
  BOSS: 'Boss',
  DELIVERY: 'Delivery',
  YARD_PERIOD: 'Yard Period',
};

export const HomeScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];
  const [vesselName, setVesselName] = useState<string | null>(null);
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [loadingVessel, setLoadingVessel] = useState(false);
  const [bannerLoadFailed, setBannerLoadFailed] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [calendarMode, setCalendarMode] = useState<'trips' | 'yardPeriod'>('trips');

  const vesselId = user?.vesselId ?? null;
  const hasVessel = !!vesselId;
  const isCaptain = user?.role === 'HOD';
  const { colors: tripColors, load: loadColors } = useVesselTripColors(vesselId);
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const typeColorMap = tripColors ? getTripTypeColorMap(tripColors) : getTripTypeColorMap(DEFAULT_COLORS);
  const yardPeriodColor = tripColors?.yardPeriod ?? DEFAULT_COLORS.yardPeriod;
  const getDeptColor = (dept: string) => getDepartmentColor(dept, overrides);

  const markedDatesTrips = getMarkedDatesFromTrips(trips, typeColorMap);
  const markedDatesYardPeriod = getMarkedDatesFromYardPeriodTrips(trips, yardPeriodColor, getDeptColor);
  const markedDates = calendarMode === 'trips' ? markedDatesTrips : markedDatesYardPeriod;

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    try {
      const [data] = await Promise.all([tripsService.getTripsByVessel(vesselId), loadColors()]);
      setTrips(data);
    } catch (e) {
      console.error('Load trips error:', e);
    } finally {
      setTripsLoading(false);
    }
  }, [vesselId, loadColors]);

  useFocusEffect(useCallback(() => { if (hasVessel) loadTrips(); }, [hasVessel, loadTrips]));

  useEffect(() => {
    const fetchVessel = async () => {
      if (user?.vesselId) {
        setLoadingVessel(true);
        try {
          const vessel = await vesselService.getVessel(user.vesselId);
          if (vessel) setVesselName(vessel.name);
          const url = vesselService.getBannerPublicUrl(user.vesselId);
          setBannerLoadFailed(false);
          setBannerImageUrl(url);
        } catch (error) {
          console.error('Error fetching vessel:', error);
        } finally {
          setLoadingVessel(false);
        }
      }
    };
    fetchVessel();
  }, [user?.vesselId]);

  return (
    <>
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        {/* Vessel banner */}
        {hasVessel && (
          <View style={styles.bannerWrap}>
            <ImageBackground
              source={{ uri: !bannerLoadFailed && bannerImageUrl ? bannerImageUrl : DEFAULT_BANNER_IMAGE }}
              style={styles.bannerImage}
              imageStyle={styles.bannerImageStyle}
              onError={() => {
                if (bannerImageUrl) setBannerLoadFailed(true);
              }}
            >
              <View style={styles.bannerOverlay} />
              {vesselName && (
                <Text style={styles.bannerVesselName} numberOfLines={1}>
                  {vesselName}
                </Text>
              )}
            </ImageBackground>
          </View>
        )}

        {!hasVessel && (
          <View style={[styles.noVesselCard, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.noVesselIcon}>⚓</Text>
            <Text style={[styles.noVesselTitle, { color: themeColors.textPrimary }]}>You're not part of a vessel yet</Text>
            <Text style={[styles.noVesselText, { color: themeColors.textSecondary }]}>
              Join with an invite code to get started.
            </Text>
            <Button
              title="Join Vessel"
              onPress={() => navigation.navigate('JoinVessel')}
              variant="primary"
              shape="pill"
              fullWidth
            />
          </View>
        )}

        {hasVessel && (
          <>
            <View style={[styles.tripsCalendarCard, { backgroundColor: themeColors.surface, borderColor: themeColors.surfaceAlt }]}>
              <View style={styles.tripsCalendarHeader}>
                <View style={styles.calendarModeRow}>
                  <TouchableOpacity
                    style={[
                      styles.calendarModeBtn,
                      {
                        backgroundColor: calendarMode === 'trips' ? themeColors.surfaceAlt : 'transparent',
                        borderColor: calendarMode === 'trips' ? CALENDAR_ACCENT : themeColors.surfaceAlt,
                      },
                    ]}
                    onPress={() => setCalendarMode('trips')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.calendarModeBtnText, { color: calendarMode === 'trips' ? themeColors.textPrimary : themeColors.textSecondary }]}>
                      Trips
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.calendarModeBtn,
                      {
                        backgroundColor: calendarMode === 'yardPeriod' ? themeColors.surfaceAlt : 'transparent',
                        borderColor: calendarMode === 'yardPeriod' ? CALENDAR_ACCENT : themeColors.surfaceAlt,
                      },
                    ]}
                    onPress={() => setCalendarMode('yardPeriod')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.calendarModeBtnText, { color: calendarMode === 'yardPeriod' ? themeColors.textPrimary : themeColors.textSecondary }]}>
                      Yard Period
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.tripsCalendarAccent, { backgroundColor: CALENDAR_ACCENT }]} />
              </View>
              <View style={styles.tripsCalendarBody}>
                {tripsLoading ? (
                  <ActivityIndicator size="small" color={CALENDAR_ACCENT} style={styles.tripsLoader} />
                ) : (
                  <Calendar
                    current={new Date().toISOString().slice(0, 10)}
                    markedDates={markedDates}
                    markingType="period"
                    theme={{
                      backgroundColor: 'transparent',
                      calendarBackground: 'transparent',
                      textSectionTitleColor: themeColors.textSecondary,
                      selectedDayBackgroundColor: CALENDAR_ACCENT,
                      selectedDayTextColor: COLORS.white,
                      todayTextColor: CALENDAR_ACCENT,
                      dayTextColor: themeColors.textPrimary,
                      textDisabledColor: themeColors.textSecondary,
                      arrowColor: CALENDAR_ACCENT,
                      monthTextColor: themeColors.textPrimary,
                      textDayHeaderFontSize: 11,
                      textMonthFontSize: 16,
                      textDayFontSize: 14,
                    }}
                    hideExtraDays
                    style={styles.tripsCalendarInner}
                  />
                )}
              </View>
              <View style={[styles.tripsLegend, { borderTopColor: themeColors.surfaceAlt }]}>
                {calendarMode === 'trips' ? (
                  (Object.entries(TRIP_TYPE_LABELS) as [string, string][]).map(([type, label]) => (
                    <View key={type} style={styles.tripsLegendItem}>
                      <View style={[styles.tripsLegendDot, { backgroundColor: typeColorMap[type] ?? COLORS.primary }]} />
                      <Text style={[styles.tripsLegendLabel, { color: themeColors.textSecondary }]}>{label}</Text>
                    </View>
                  ))
                ) : (
                  DEPARTMENTS.map((dept) => (
                    <View key={dept} style={styles.tripsLegendItem}>
                      <View style={[styles.tripsLegendDot, { backgroundColor: getDepartmentColor(dept, overrides) }]} />
                      <Text style={[styles.tripsLegendLabel, { color: themeColors.textSecondary }]}>
                        {dept.charAt(0) + dept.slice(1).toLowerCase()}
                      </Text>
                    </View>
                  ))
                )}
              </View>
              <TouchableOpacity
                style={[styles.seeTripsButton, { backgroundColor: themeColors.surfaceAlt, borderTopColor: themeColors.surfaceAlt }]}
                onPress={() => navigation.navigate(calendarMode === 'trips' ? 'UpcomingTrips' : 'YardPeriodTrips')}
                activeOpacity={0.8}
              >
                <Text style={[styles.seeTripsButtonText, { color: CALENDAR_ACCENT }]}>
                  {calendarMode === 'trips' ? 'See trips' : 'See yard periods'}
                </Text>
                <Text style={[styles.seeTripsArrow, { color: CALENDAR_ACCENT }]}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>Quick Access</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Categories')}>
                  <Text style={[styles.seeAll, { color: themeColors.textSecondary }]}>See all</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.categoryRow}>
                {HOME_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.quickAccessButton, { backgroundColor: themeColors.surface }]}
                    onPress={() => navigation.navigate(cat.nav)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.quickAccessIcon}>{cat.icon}</Text>
                    <Text style={[styles.quickAccessLabel, { color: themeColors.textPrimary }]} numberOfLines={1}>{cat.label}</Text>
                    <Text style={[styles.quickAccessChevron, { color: themeColors.textSecondary }]}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.logButton, { backgroundColor: themeColors.surface }]}
                onPress={() => navigation.navigate('VesselCrewSafety')}
                activeOpacity={0.8}
              >
                <Text style={styles.logButtonIcon}>🦺</Text>
                <Text style={[styles.logButtonLabel, { color: themeColors.textPrimary }]}>Vessel & Crew Safety</Text>
                <Text style={[styles.logButtonChevron, { color: themeColors.textSecondary }]}>›</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

      </View>
    </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: SPACING.xl,
    paddingTop: SPACING.xl + SPACING.xl,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  vesselName: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  bannerWrap: {
    marginHorizontal: -SPACING.xl,
    marginBottom: SPACING.xl,
    overflow: 'hidden',
  },
  bannerImage: {
    height: BANNER_HEIGHT,
    justifyContent: 'flex-end',
    padding: SPACING.lg,
  },
  bannerImageStyle: { resizeMode: 'cover' },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bannerVesselName: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    zIndex: 1,
  },
  noVesselCard: {
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    alignItems: 'center',
    ...SHADOWS.md,
  },
  noVesselIcon: { fontSize: 48, marginBottom: SPACING.md },
  noVesselTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  noVesselText: {
    fontSize: FONTS.base,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  tripsCalendarCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: SPACING.xl,
    borderWidth: 1,
    ...SHADOWS.lg,
  },
  tripsCalendarHeader: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  calendarModeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  calendarModeBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  calendarModeBtnText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  tripsCalendarTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  tripsCalendarAccent: {
    width: 40,
    height: 3,
    marginTop: 6,
    borderRadius: 2,
  },
  tripsCalendarBody: {
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  tripsLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
  },
  tripsLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  tripsLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  tripsLegendLabel: {
    fontSize: FONTS.xs,
    fontWeight: '500',
  },
  tripsLoader: {
    paddingVertical: SPACING.xl * 2,
  },
  tripsCalendarInner: {
    backgroundColor: 'transparent',
  },
  seeTripsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
  seeTripsButtonText: {
    fontSize: FONTS.base,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  seeTripsArrow: {
    fontSize: 20,
    fontWeight: '300',
  },
  section: { marginBottom: SPACING.xl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  seeAll: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.primary },
  categoryRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  quickAccessButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    minHeight: CATEGORY_SIZE,
    ...SHADOWS.lg,
  },
  quickAccessIcon: { fontSize: FONTS.xl, marginRight: SPACING.xs },
  quickAccessLabel: { flex: 1, fontSize: FONTS.sm, fontWeight: '600' },
  quickAccessChevron: { fontSize: 18, fontWeight: '300' },
  categoryTile: {
    width: CATEGORY_SIZE,
    height: CATEGORY_SIZE,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
  },
  categoryImage: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: SPACING.sm,
  },
  categoryImageStyle: { borderRadius: BORDER_RADIUS.lg },
  categoryOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: BORDER_RADIUS.lg,
  },
  categoryFallback: { alignItems: 'center', justifyContent: 'center' },
  categoryIcon: { fontSize: 32, marginBottom: 4 },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.lg,
  },
  logButtonIcon: { fontSize: FONTS['2xl'], marginRight: SPACING.md },
  logButtonLabel: { flex: 1, fontSize: FONTS.lg, fontWeight: '600' },
  logButtonChevron: { fontSize: 24, fontWeight: '300' },
  categoryLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    color: COLORS.white,
    zIndex: 1,
  },
  shortcutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  shortcutIcon: { fontSize: FONTS['2xl'], marginRight: SPACING.lg },
  shortcutLabel: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
});
