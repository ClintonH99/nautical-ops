/**
 * Delivery Trips Screen
 * List of delivery periods; HOD can add/edit; calendar to choose dates when adding
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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import tripsService from '../services/trips';
import { Trip } from '../types';
import { Button, ButtonTagCard, ButtonTagRow } from '../components';
import { useVesselTripColors } from '../hooks/useVesselTripColors';
import { useThemeColors } from '../hooks/useThemeColors';
import { DEFAULT_COLORS } from '../services/tripColors';

const TRIP_TYPE = 'DELIVERY' as const;

export const DeliveryTripsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const { colors: tripColors, load: loadColors } = useVesselTripColors(vesselId);
  const cardColor = tripColors?.delivery ?? DEFAULT_COLORS.delivery;

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    try {
      const [data] = await Promise.all([
        tripsService.getTripsByVesselAndType(vesselId, TRIP_TYPE),
        loadColors(),
      ]);
      setTrips(data);
    } catch (e) {
      console.error('Load delivery trips error:', e);
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
          style={{
            marginRight: SPACING.md,
            paddingVertical: SPACING.sm,
            paddingHorizontal: SPACING.md,
            justifyContent: 'center',
            alignItems: 'center',
          }}
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
    <ButtonTagCard
      headerTitle={item.title ?? ''}
      accentColor={cardColor}
      onEdit={isHOD ? () => onEdit(item) : undefined}
      onDelete={isHOD ? () => onDelete(item) : undefined}
      onPress={isHOD ? () => onEdit(item) : undefined}
    >
      <ButtonTagRow label="Date" value={`${formatDate(item.startDate)} – ${formatDate(item.endDate)}`} />
      <ButtonTagRow label="Notes" value={item.notes ?? ''} />
    </ButtonTagCard>
  );

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see delivery trips.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {isHOD && (
        <View style={styles.addRow}>
          <Button
            title="Add Delivery"
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
          <Text style={styles.emptyEmoji}>🚢</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No delivery periods yet</Text>
          {isHOD && (
            <Button title="Add first" onPress={onAdd} variant="primary" style={styles.emptyBtn} />
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
    fontWeight: '600',
  },
});
