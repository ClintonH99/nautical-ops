import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [loadedVesselId, setLoadedVesselId] = useScreenState<string | null>('loadedVesselId', null);
  const [storedTransfers, setStoredTransfers] = useScreenState<FuelTransfer[]>(
    'storedTransfers',
    []
  );
  const [storedTanks, setStoredTanks] = useScreenState<FuelTank[]>('storedTanks', []);
  const [loadError, setLoadError] = useState<{ vesselId: string; message: string } | null>(null);
  const [unit, setUnit] = useScreenState<FuelVolumeUnit>('unit', 'LITRES');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const requestedVesselId = useRef<string | null>(vesselId);
  const transfers = useMemo(
    () => (loadedVesselId === vesselId ? storedTransfers : []),
    [loadedVesselId, storedTransfers, vesselId]
  );
  const tanks = useMemo(
    () => (loadedVesselId === vesselId ? storedTanks : []),
    [loadedVesselId, storedTanks, vesselId]
  );
  const currentLoadError = loadError?.vesselId === vesselId ? loadError.message : null;
  const waitingForCurrentVessel = loadedVesselId !== vesselId && !currentLoadError;

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!vesselId) {
      requestedVesselId.current = null;
      setLoadedVesselId(null);
      setStoredTransfers([]);
      setStoredTanks([]);
      setLoadError(null);
      setDeletingId(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (requestedVesselId.current !== vesselId) {
      requestedVesselId.current = vesselId;
      setLoadedVesselId(null);
      setStoredTransfers([]);
      setStoredTanks([]);
      setLoadError(null);
      setExpandedId(null);
      setDeletingId(null);
      setLoading(true);
    }
    try {
      const [records, setup] = await Promise.all([
        fuelManagementService.getTransfersByVessel(vesselId),
        fuelManagementService.getSetup(vesselId),
      ]);
      if (generation !== loadGeneration.current) return;
      setStoredTransfers(records);
      setStoredTanks(setup.tanks);
      setUnit(setup.settings?.volumeUnit ?? 'LITRES');
      setLoadedVesselId(vesselId);
      setLoadError(null);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      console.error('Load fuel transfers error:', error);
      setLoadError({
        vesselId,
        message:
          'Fuel transfers could not be refreshed. Existing records are retained, but new entries and changes are paused until refresh succeeds.',
      });
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [setLoadedVesselId, setLoading, setStoredTanks, setStoredTransfers, setUnit, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        loadGeneration.current += 1;
      };
    }, [load])
  );

  const tankNames = useMemo(() => new Map(tanks.map((tank) => [tank.id, tank.name])), [tanks]);

  const filteredTransfers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return transfers;
    return transfers.filter((transfer) => {
      const source = transfer.sourceTankName ?? tankNames.get(transfer.sourceTankId) ?? '';
      const destination =
        transfer.destinationTankName ?? tankNames.get(transfer.destinationTankId) ?? '';
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

  const deleteTransfer = async (target: FuelTransfer) => {
    if (
      !vesselId ||
      deletingId ||
      !canManageSetup ||
      currentLoadError ||
      target.vesselId !== vesselId
    ) {
      return;
    }
    const targetVesselId = vesselId;
    setDeletingId(target.id);
    try {
      await fuelManagementService.deleteTransfer(target.id, {
        expectedRevision: target.inventoryRevision ?? 0,
        reason: 'Deleted by user',
      });
      if (requestedVesselId.current !== targetVesselId) return;
      await load();
      Alert.alert('Fuel transfer deleted.');
    } catch (error) {
      if (requestedVesselId.current !== targetVesselId) return;
      if (__DEV__) console.warn('Delete fuel transfer warning:', error);
      Alert.alert(
        'Could not delete fuel transfer',
        error instanceof Error ? error.message : 'Refresh the transfers and try again.'
      );
    } finally {
      if (requestedVesselId.current === targetVesselId) setDeletingId(null);
    }
  };

  const confirmDelete = (target: FuelTransfer) => {
    Alert.alert('Delete fuel transfer?', 'This will remove the transfer from the vessel records.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteTransfer(target),
      },
    ]);
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
          disabled={!!currentLoadError}
        />
        <Button
          title={canManageSetup ? 'Edit Setup' : 'View Setup'}
          variant="outline"
          onPress={() => navigation.navigate('FuelSetup')}
          style={styles.action}
        />
      </View>
      {currentLoadError ? (
        <View
          style={[
            styles.loadError,
            { backgroundColor: themeColors.surface, borderColor: COLORS.warning },
          ]}
        >
          <Text style={[styles.loadErrorText, { color: themeColors.textPrimary }]}>
            {currentLoadError}
          </Text>
          <Button title="Retry" variant="outline" onPress={load} style={styles.retryButton} />
        </View>
      ) : null}

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

      {loading || waitingForCurrentVessel ? (
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
                {currentLoadError && transfers.length === 0
                  ? 'Could not load transfers'
                  : transfers.length === 0
                    ? 'No transfers yet'
                    : 'No matching transfers'}
              </Text>
              <Text style={[styles.message, { color: themeColors.textSecondary }]}>
                {currentLoadError && transfers.length === 0
                  ? 'Retry when your connection is available. Nautical Ops will not treat a load failure as an empty audit log.'
                  : transfers.length === 0
                    ? 'Record a transfer to update the calculated tank inventory.'
                    : 'Try a different search term.'}
              </Text>
            </View>
          ) : (
            filteredTransfers.map((transfer) => {
              const source =
                transfer.sourceTankName ??
                tankNames.get(transfer.sourceTankId) ??
                'Unknown source tank';
              const destination =
                transfer.destinationTankName ??
                tankNames.get(transfer.destinationTankId) ??
                'Unknown destination tank';
              return (
                <ButtonTagCard
                  key={transfer.id}
                  headerLeft={
                    <View style={styles.transferHeaderCopy}>
                      <Text
                        style={[
                          styles.transferTitle,
                          { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                        ]}
                        numberOfLines={1}
                      >
                        {source} → {destination}
                      </Text>
                      <Text style={[styles.transferDate, { color: themeColors.textSecondary }]}>
                        {transfer.transferDate || 'Date not recorded'}
                        {transfer.transferTime ? `  •  ${transfer.transferTime}` : ''}
                      </Text>
                    </View>
                  }
                  collapsible
                  expanded={expandedId === transfer.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === transfer.id ? null : transfer.id))
                  }
                  onEdit={
                    canManageSetup && !currentLoadError
                      ? () =>
                          navigation.navigate('FuelTransfer', {
                            transferId: transfer.id,
                            correctionOperationId:
                              transfer.currentInventoryOperationId ?? undefined,
                          })
                      : undefined
                  }
                  onDelete={
                    canManageSetup && !currentLoadError && deletingId !== transfer.id
                      ? () => confirmDelete(transfer)
                      : undefined
                  }
                  footer={
                    transfer.createdByName ? `Logged by ${transfer.createdByName}` : undefined
                  }
                  summary={
                    <View style={[styles.statsRow, { backgroundColor: themeColors.background }]}>
                      <View style={styles.statBox}>
                        <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                          From
                        </Text>
                        <Text
                          style={[styles.statValue, { color: themeColors.textPrimary }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {source}
                        </Text>
                      </View>
                      <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
                      <View style={styles.statBox}>
                        <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                          To
                        </Text>
                        <Text
                          style={[styles.statValue, { color: themeColors.textPrimary }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {destination}
                        </Text>
                      </View>
                      <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
                      <View style={styles.statBox}>
                        <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>
                          Amount
                        </Text>
                        <Text
                          style={[styles.statValue, { color: themeColors.accent }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.7}
                        >
                          {formatVolume(fromLitres(transfer.amountLitres, unit))} {unitLabel(unit)}
                        </Text>
                      </View>
                    </View>
                  }
                >
                  {transfer.location || transfer.notes ? (
                    <View
                      style={[
                        styles.transferDetails,
                        {
                          backgroundColor: themeColors.control,
                          borderColor: themeColors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.detailsTitle, { color: themeColors.textSecondary }]}>
                        Transfer details
                      </Text>
                      <ButtonTagRow label="Location" value={transfer.location} />
                      <ButtonTagRow label="Comment" value={transfer.notes} />
                    </View>
                  ) : null}
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
  loadError: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  loadErrorText: { flex: 1, fontSize: FONTS.sm, lineHeight: 19 },
  retryButton: { minWidth: 80 },
  list: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptyCard: {
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginTop: SPACING.xs },
  transferHeaderCopy: { flex: 1, minWidth: 0 },
  transferTitle: { fontSize: FONTS.lg, fontWeight: '800' },
  transferDate: { fontSize: FONTS.xs, marginTop: 3 },
  statsRow: {
    flexDirection: 'row',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  statBox: { flex: 1, minWidth: 0, paddingHorizontal: SPACING.xs },
  statDivider: { width: 1, marginVertical: 2 },
  statLabel: {
    height: 32,
    fontSize: FONTS.xs,
    fontWeight: '600',
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  statValue: { height: 20, fontSize: FONTS.sm, fontWeight: '700', lineHeight: 18 },
  transferDetails: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  detailsTitle: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
});
