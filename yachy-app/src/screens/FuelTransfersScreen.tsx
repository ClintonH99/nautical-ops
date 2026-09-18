import React, { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  ButtonTagCard,
  ButtonTagRow,
  Input,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { fuelManagementService } from '../services/fuelManagement';
import { useAuthStore } from '../store';
import { FuelTank, FuelTransfer, FuelVolumeUnit } from '../types';
import { fromLitres } from '../utils/fuelUnits';

function unitLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

export const FuelTransfersScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const canManageSetup = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transfers, setTransfers] = useState<FuelTransfer[]>([]);
  const [tanks, setTanks] = useState<FuelTank[]>([]);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!vesselId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [records, setup] = await Promise.all([
        fuelManagementService.getTransfersByVessel(vesselId),
        fuelManagementService.getSetup(vesselId),
      ]);
      setTransfers(records);
      setTanks(setup.tanks);
      setUnit(setup.settings?.volumeUnit ?? 'LITRES');
    } catch (error) {
      console.error('Load fuel transfers error:', error);
      Alert.alert('Could not load transfers', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const tankNames = useMemo(() => new Map(tanks.map((tank) => [tank.id, tank.name])), [tanks]);

  const filteredTransfers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return transfers;
    return transfers.filter((transfer) => {
      const source = tankNames.get(transfer.sourceTankId) ?? '';
      const destination = tankNames.get(transfer.destinationTankId) ?? '';
      return [
        source,
        destination,
        transfer.transferDate,
        transfer.transferTime,
        transfer.location,
        transfer.notes,
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [query, tankNames, transfers]);

  const deleteTransfer = (transfer: FuelTransfer) => {
    Alert.alert(
      'Delete fuel transfer?',
      'This will reverse its effect on the recorded tank balances.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await fuelManagementService.deleteTransfer(transfer.id);
              setExpandedId(null);
              await load();
            } catch (error) {
              console.error('Delete fuel transfer error:', error);
              Alert.alert('Could not delete transfer', 'No changes were made. Please try again.');
            }
          },
        },
      ]
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to view fuel transfers.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Fuel Transfers" />
      <View style={styles.actions}>
        <Button
          title="Record Transfer"
          onPress={() => navigation.navigate('FuelTransfer')}
          style={styles.action}
        />
        <Button
          title={canManageSetup ? 'Edit Setup' : 'View Setup'}
          variant="outline"
          onPress={() => navigation.navigate('FuelSetup')}
          style={styles.action}
        />
      </View>

      {!loading && transfers.length > 0 ? (
        <View style={styles.searchRow}>
          <Input
            variant="search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search tanks, date or notes…"
            returnKeyType="search"
          />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, filteredTransfers.length === 0 && styles.emptyList]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[COLORS.primary]}
            />
          }
        >
          {filteredTransfers.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}>
              <Ionicons
                name="swap-horizontal-outline"
                size={48}
                color={themeColors.textSecondary}
              />
              <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
                {transfers.length === 0 ? 'No transfers yet' : 'No matching transfers'}
              </Text>
              <Text style={[styles.message, { color: themeColors.textSecondary }]}>
                {transfers.length === 0
                  ? 'Record a transfer to keep tank-level fuel balances accurate.'
                  : 'Try a different search term.'}
              </Text>
            </View>
          ) : (
            filteredTransfers.map((transfer) => {
              const source = tankNames.get(transfer.sourceTankId) ?? 'Unknown source tank';
              const destination =
                tankNames.get(transfer.destinationTankId) ?? 'Unknown destination tank';
              return (
                <ButtonTagCard
                  key={transfer.id}
                  headerTitle={`${source} → ${destination}`}
                  onEdit={() => navigation.navigate('FuelTransfer', { transferId: transfer.id })}
                  onDelete={() => deleteTransfer(transfer)}
                  collapsible
                  expanded={expandedId === transfer.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === transfer.id ? null : transfer.id))
                  }
                  summary={
                    <ButtonTagRow
                      label="Date"
                      value={[transfer.transferDate, transfer.transferTime]
                        .filter(Boolean)
                        .join('  ·  ')}
                    />
                  }
                >
                  <ButtonTagRow
                    label="Amount"
                    value={`${formatVolume(fromLitres(transfer.amountLitres, unit))} ${unitLabel(unit)}`}
                  />
                  <ButtonTagRow label="Location" value={transfer.location} />
                  <ButtonTagRow label="Comment" value={transfer.notes} />
                </ButtonTagCard>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  message: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  action: { flex: 1 },
  searchRow: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  list: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptyCard: {
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginTop: SPACING.xs },
});
