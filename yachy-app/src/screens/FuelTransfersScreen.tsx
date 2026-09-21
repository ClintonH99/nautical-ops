import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  FuelVoidReasonModal,
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
  const [loadedVesselId, setLoadedVesselId] = useState<string | null>(null);
  const [storedTransfers, setStoredTransfers] = useState<FuelTransfer[]>([]);
  const [storedTanks, setStoredTanks] = useState<FuelTank[]>([]);
  const [loadError, setLoadError] = useState<{ vesselId: string; message: string } | null>(null);
  const [unit, setUnit] = useState<FuelVolumeUnit>('LITRES');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [voidTarget, setVoidTarget] = useState<FuelTransfer | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const loadGeneration = useRef(0);
  const requestedVesselId = useRef<string | null>(null);
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
      setVoidTarget(null);
      setVoidReason('');
      setVoiding(false);
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
      setVoidTarget(null);
      setVoidReason('');
      setVoiding(false);
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
          'Fuel transfers could not be refreshed. Existing records are retained, but new entries and corrections are paused until refresh succeeds.',
      });
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [vesselId]);

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

  const confirmLegacyVoid = async () => {
    if (
      !voidTarget ||
      !vesselId ||
      !voidReason.trim() ||
      voiding ||
      !canManageSetup ||
      currentLoadError ||
      voidTarget.vesselId !== vesselId ||
      voidTarget.currentInventoryOperationId
    ) {
      return;
    }
    const targetVesselId = vesselId;
    const target = voidTarget;
    setVoiding(true);
    try {
      await fuelManagementService.deleteTransfer(target.id, {
        expectedRevision: target.inventoryRevision ?? 0,
        reason: voidReason.trim(),
      });
      if (requestedVesselId.current !== targetVesselId) return;
      setVoidTarget(null);
      setVoidReason('');
      await load();
      Alert.alert(
        'Transfer voided',
        'The report-only transfer remains in the audit history. Calculated tank balances were not changed.'
      );
    } catch (error) {
      if (requestedVesselId.current !== targetVesselId) return;
      console.error('Void legacy fuel transfer error:', error);
      Alert.alert(
        'Could not void transfer',
        error instanceof Error ? error.message : 'Refresh the transfers and try again.'
      );
    } finally {
      if (requestedVesselId.current === targetVesselId) setVoiding(false);
    }
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
      <Text style={[styles.auditHint, { color: themeColors.textSecondary }]}>
        Posted transfers are retained as audit records. Corrections are recorded separately.
      </Text>

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
                  headerTitle={`${source} → ${destination}`}
                  collapsible
                  expanded={expandedId === transfer.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === transfer.id ? null : transfer.id))
                  }
                  onEdit={
                    canManageSetup && !currentLoadError && !transfer.currentInventoryOperationId
                      ? () => navigation.navigate('FuelTransfer', { transferId: transfer.id })
                      : undefined
                  }
                  onDelete={
                    canManageSetup && !currentLoadError && !transfer.currentInventoryOperationId
                      ? () => {
                          setVoidReason('');
                          setVoidTarget(transfer);
                        }
                      : undefined
                  }
                  summary={<ButtonTagRow label="Location" value={transfer.location} />}
                >
                  <ButtonTagRow label="Date" value={transfer.transferDate} />
                  <ButtonTagRow label="Time" value={transfer.transferTime} />
                  <ButtonTagRow
                    label="Amount"
                    value={`${formatVolume(fromLitres(transfer.amountLitres, unit))} ${unitLabel(unit)}`}
                  />
                  <ButtonTagRow label="Comment" value={transfer.notes} />
                </ButtonTagCard>
              );
            })
          )}
        </ScrollView>
      )}
      <FuelVoidReasonModal
        visible={!!voidTarget && voidTarget.vesselId === vesselId}
        title="Void this report-only transfer?"
        description="This does not delete history or change calculated tank balances. Nautical Ops records your name, time and reason in the legacy audit trail."
        reason={voidReason}
        onChangeReason={setVoidReason}
        onCancel={() => {
          setVoidTarget(null);
          setVoidReason('');
        }}
        onConfirm={confirmLegacyVoid}
        submitting={voiding}
      />
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
  auditHint: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    fontSize: FONTS.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
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
});
