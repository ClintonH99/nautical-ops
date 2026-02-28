/**
 * Yard Period Trips Screen
 * Calendar + list of yard period / maintenance periods; HOD can add/edit
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import tripsService from '../services/trips';
import { Trip, Department } from '../types';
import { Button } from '../components';
import { useVesselTripColors } from '../hooks/useVesselTripColors';
import { useThemeColors } from '../hooks/useThemeColors';
import { DEFAULT_COLORS } from '../services/tripColors';

const TRIP_TYPE = 'YARD_PERIOD' as const;

type MarkedDates = { [date: string]: { startingDay?: boolean; endingDay?: boolean; color: string; textColor?: string } };

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

function getMarkedDatesFromTrips(
  trips: Trip[],
  defaultColor: string,
  getDeptColor: (dept: string) => string
): MarkedDates {
  const marked: MarkedDates = {};
  trips.forEach((trip) => {
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

export const YardPeriodTripsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const { colors: tripColors, load: loadColors } = useVesselTripColors(vesselId);
  const cardColor = tripColors?.yardPeriod ?? DEFAULT_COLORS.yardPeriod;

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    try {
      const [data] = await Promise.all([
        tripsService.getTripsByVesselAndType(vesselId, TRIP_TYPE),
        loadColors(),
      ]);
      setTrips(data);
    } catch (e) {
      console.error('Load yard period trips error:', e);
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

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getDeptColor = useCallback(
    (dept: string) => getDepartmentColor(dept, overrides),
    [overrides]
  );
  const markedDates = useMemo(
    () => getMarkedDatesFromTrips(trips, cardColor, getDeptColor),
    [trips, cardColor, getDeptColor]
  );

  const calendarTheme = {
    backgroundColor: themeColors.surface,
    calendarBackground: themeColors.surface,
    textSectionTitleColor: themeColors.textSecondary,
    selectedDayBackgroundColor: cardColor,
    selectedDayTextColor: COLORS.white,
    todayTextColor: COLORS.primary,
    dayTextColor: themeColors.textPrimary,
    textDisabledColor: COLORS.gray400,
    arrowColor: COLORS.primary,
    monthTextColor: themeColors.textPrimary,
    textDayHeaderFontSize: FONTS.sm,
    textMonthFontSize: FONTS.lg,
    textDayFontSize: FONTS.base,
  };

  const onAdd = () => {
    navigation.navigate('AddEditTrip', { type: TRIP_TYPE });
  };

  const onEdit = (trip: Trip) => {
    if (!isHOD) return;
    navigation.navigate('AddEditTrip', { type: TRIP_TYPE, tripId: trip.id });
  };

  const onDelete = (trip: Trip) => {
    if (!isHOD) return;
    Alert.alert(
      'Delete trip',
      `Delete "${trip.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await tripsService.deleteTrip(trip.id);
              loadTrips();
            } catch (e) {
              Alert.alert('Error', 'Could not delete trip');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: Trip }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: themeColors.surface, borderLeftColor: cardColor }]}
      onPress={() => onEdit(item)}
      activeOpacity={0.8}
      disabled={!isHOD}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBlock}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>{item.title}</Text>
          {item.department && (
            <View
              style={[
                styles.deptBadge,
                { backgroundColor: getDepartmentColor(item.department, overrides) },
              ]}
            >
              <Text style={styles.deptBadgeText}>
                {item.department.charAt(0) + item.department.slice(1).toLowerCase()}
              </Text>
            </View>
          )}
        </View>
        {isHOD && (
          <TouchableOpacity
            onPress={() => onDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.cardDates, { color: themeColors.textSecondary }]}>
        {formatDate(item.startDate)} – {formatDate(item.endDate)}
      </Text>
      {item.notes ? (
        <Text style={[styles.cardNotes, { color: themeColors.textSecondary }]} numberOfLines={2}>{item.notes}</Text>
      ) : null}
    </TouchableOpacity>
  );

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see yard period trips.</Text>
      </View>
    );
  }

  const ListHeader = () => (
    <>
      <View style={[styles.calendarWrap, { backgroundColor: themeColors.surface }]}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.calendarLoader} />
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
          {DEPARTMENTS.map((dept) => (
            <View key={dept} style={styles.legendRow}>
              <View
                style={[styles.legendDot, { backgroundColor: getDepartmentColor(dept, overrides) }]}
              />
              <Text style={[styles.legendText, { color: themeColors.textSecondary }]}>
                {dept.charAt(0) + dept.slice(1).toLowerCase()}
              </Text>
            </View>
          ))}
        </View>
      </View>
      {isHOD && (
        <View style={styles.addRow}>
          <Button
            title="Add Yard Period"
            onPress={onAdd}
            variant="primary"
            style={styles.addButton}
          />
        </View>
      )}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {loading && trips.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : trips.length === 0 ? (
        <FlatList
          ListHeaderComponent={<ListHeader />}
          data={[]}
          keyExtractor={() => 'empty'}
          renderItem={() => null}
          contentContainerStyle={styles.listEmpty}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🔧</Text>
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No yard periods yet</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          ListHeaderComponent={<ListHeader />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    textAlign: 'center',
  },
  calendarWrap: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.sm,
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.lg,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
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
  legendText: {
    fontSize: FONTS.sm,
  },
  calendarLoader: {
    padding: SPACING.xl,
  },
  addRow: {
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  addButton: {},
  listEmpty: {
    flexGrow: 1,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  loader: {
    marginTop: SPACING.xl,
  },
  list: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
  },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    marginTop: SPACING.xs,
    alignSelf: 'flex-start',
  },
  deptBadgeText: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    color: COLORS.white,
  },
  deleteBtn: {
    fontSize: FONTS.sm,
    color: COLORS.danger,
  },
  cardDates: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
  },
  cardNotes: {
    fontSize: FONTS.sm,
    color: COLORS.textTertiary,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.lg,
    marginBottom: SPACING.lg,
  },
  emptyBtn: {},
});
