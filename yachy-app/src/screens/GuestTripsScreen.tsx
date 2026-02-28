/**
 * Guest Trips Screen
 * List of guest (charter) trips; HOD can add/edit; calendar to choose dates when adding
 */

import React, { useState, useCallback, useEffect } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import tripsService from '../services/trips';
import { Trip } from '../types';
import { Button } from '../components';
import { useVesselTripColors } from '../hooks/useVesselTripColors';
import { useThemeColors } from '../hooks/useThemeColors';
import { DEFAULT_COLORS } from '../services/tripColors';

const TRIP_TYPE = 'GUEST' as const;

export const GuestTripsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const { colors: tripColors, load: loadColors } = useVesselTripColors(vesselId);
  const cardColor = tripColors?.guest ?? DEFAULT_COLORS.guest;

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    try {
      const [data] = await Promise.all([
        tripsService.getTripsByVesselAndType(vesselId, TRIP_TYPE),
        loadColors(),
      ]);
      setTrips(data);
    } catch (e) {
      console.error('Load guest trips error:', e);
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
          <Text style={styles.headerButtonText}>Edit colors</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, isHOD]);

  const onRefresh = () => {
    setRefreshing(true);
    loadTrips();
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
        <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>{item.title}</Text>
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
        <Text style={styles.cardNotes} numberOfLines={2}>{item.notes}</Text>
      ) : null}
    </TouchableOpacity>
  );

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see guest trips.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {isHOD && (
        <View style={styles.addRow}>
          <Button
            title="Add Guest Trip"
            onPress={onAdd}
            variant="primary"
            style={styles.addButton}
          />
        </View>
      )}
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : trips.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>👥</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No guest trips yet</Text>
          {isHOD && (
            <Button title="Add first trip" onPress={onAdd} variant="primary" style={styles.emptyBtn} />
          )}
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
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
  addRow: {
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  addButton: {},
  loader: {
    marginTop: SPACING.xl,
  },
  list: {
    padding: SPACING.lg,
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
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  cardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    flex: 1,
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
  headerButtonText: {
    fontSize: FONTS.sm,
    color: COLORS.white,
    fontWeight: '600',
  },
});
