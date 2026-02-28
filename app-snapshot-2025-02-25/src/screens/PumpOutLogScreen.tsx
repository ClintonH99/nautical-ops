/**
 * Pump Out Log Screen
 * List of pump out log entries with Add, Edit, Delete, and selective PDF export.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import pumpOutLogsService from '../services/pumpOutLogs';
import vesselService from '../services/vessel';
import { PumpOutLog, DischargeType } from '../types';
import { Button, Input } from '../components';
import { exportPumpOutLogPdf } from '../utils/vesselLogsPdf';

const DISCHARGE_LABELS: Record<DischargeType, string> = {
  DIRECT_DISCHARGE: 'Direct Discharge',
  TREATMENT_PLANT: 'Treatment Plant Discharge',
  PUMPOUT_SERVICE: 'Pumpout Service',
};

const DISCHARGE_COLORS: Record<DischargeType, string> = {
  DIRECT_DISCHARGE: COLORS.danger,
  TREATMENT_PLANT: COLORS.success,
  PUMPOUT_SERVICE: COLORS.primaryLight,
};

function Checkbox({ checked, onPress, themeColors }: { checked: boolean; onPress: () => void; themeColors: { surface: string } }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.checkbox, !checked && { backgroundColor: themeColors.surface }, checked && styles.checkboxChecked]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {checked && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

export const PumpOutLogScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<PumpOutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const vesselId = user?.vesselId ?? null;

  const filteredLogs = searchQuery.trim()
    ? logs.filter((log) => {
        const q = searchQuery.toLowerCase().trim();
        return (
          (log.logDate?.toLowerCase().includes(q)) ||
          (log.logTime?.toLowerCase().includes(q)) ||
          (log.location?.toLowerCase().includes(q)) ||
          (log.pumpoutServiceName?.toLowerCase().includes(q)) ||
          (log.description?.toLowerCase().includes(q)) ||
          DISCHARGE_LABELS[log.dischargeType].toLowerCase().includes(q)
        );
      })
    : logs;

  const loadLogs = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await pumpOutLogsService.getByVessel(vesselId);
      setLogs(data);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Load pump out logs error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(useCallback(() => { loadLogs(); }, [loadLogs]));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filteredLogs.length > 0 && filteredLogs.every((l) => selectedIds.has(l.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredLogs.map((l) => l.id)));
  };

  const onRefresh = () => { setRefreshing(true); loadLogs(); };
  const onAdd = () => navigation.navigate('AddEditPumpOutLog', {});
  const onEdit = (log: PumpOutLog) => navigation.navigate('AddEditPumpOutLog', { logId: log.id });

  const onDelete = (log: PumpOutLog) => {
    Alert.alert('Delete entry', 'Delete this pump out log entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await pumpOutLogsService.delete(log.id); loadLogs(); }
          catch { Alert.alert('Error', 'Could not delete entry.'); }
        },
      },
    ]);
  };

  const onExportPdf = async () => {
    const toExport = logs.filter((l) => selectedIds.has(l.id));
    if (toExport.length === 0) {
      Alert.alert('Nothing selected', 'Select at least one entry to export.');
      return;
    }
    setExportingPdf(true);
    try {
      let vesselName = 'Vessel';
      if (vesselId) {
        const vessel = await vesselService.getVessel(vesselId);
        if (vessel?.name) vesselName = vessel.name;
      }
      await exportPumpOutLogPdf(toExport, vesselName);
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Export failed', 'Could not generate PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to view pump out logs.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <View style={styles.actionBar}>
        <Button title="Add Log" onPress={onAdd} variant="primary" style={styles.actionBtn} />
        <Button
          title={exportingPdf ? 'Exporting…' : selectedIds.size > 0 ? `Download PDF (${selectedIds.size})` : 'Download PDF'}
          onPress={onExportPdf}
          variant="outline"
          style={styles.actionBtn}
          disabled={exportingPdf || selectedIds.size === 0}
        />
      </View>

      {logs.length > 0 && !loading && (
        <>
          <View style={styles.searchRow}>
            <Input
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by date, location, service, description…"
              style={[styles.searchInput, { backgroundColor: themeColors.surface }]}
              returnKeyType="search"
            />
          </View>
          <TouchableOpacity onPress={toggleSelectAll} style={styles.selectAllRow}>
            <Text style={styles.selectAllText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
          </TouchableOpacity>
        </>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.listContent, filteredLogs.length === 0 && styles.emptyContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
        >
          {filteredLogs.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: themeColors.surface }]}>
              <Text style={styles.emptyIcon}>🚿</Text>
              <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
                {logs.length === 0 ? 'No entries yet' : 'No matching entries'}
              </Text>
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
                {logs.length === 0
                  ? 'Tap "Add Log" to record your first pump out entry.'
                  : 'Try a different search term.'}
              </Text>
            </View>
          ) : (
            filteredLogs.map((log) => {
              const selected = selectedIds.has(log.id);
              return (
                <TouchableOpacity
                  key={log.id}
                  style={[styles.card, { backgroundColor: themeColors.surface }, selected && styles.cardSelected]}
                  onPress={() => toggleSelect(log.id)}
                  activeOpacity={0.85}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardLeft}>
                      <Checkbox checked={selected} onPress={() => toggleSelect(log.id)} themeColors={themeColors} />
                      <View style={styles.cardMeta}>
                        <Text style={[styles.cardDate, { color: COLORS.primary }]}>{log.logDate}</Text>
                        <Text style={[styles.cardDot, { color: themeColors.textSecondary }]}>·</Text>
                        <Text style={[styles.cardTime, { color: themeColors.textSecondary }]}>{log.logTime}</Text>
                      </View>
                    </View>
                    <View style={styles.cardActions}>
                      <TouchableOpacity onPress={() => onDelete(log)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => onEdit(log)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.editBtn}>Edit</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={[styles.badge, { backgroundColor: DISCHARGE_COLORS[log.dischargeType] + '20' }]}>
                    <Text style={[styles.badgeText, { color: DISCHARGE_COLORS[log.dischargeType] }]}>
                      {DISCHARGE_LABELS[log.dischargeType]}
                    </Text>
                  </View>

                  {log.dischargeType === 'PUMPOUT_SERVICE' && !!log.pumpoutServiceName && (
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Service</Text>
                      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>{log.pumpoutServiceName}</Text>
                    </View>
                  )}
                  {!!log.location && (
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Location</Text>
                      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>{log.location}</Text>
                    </View>
                  )}
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Amount</Text>
                      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>{log.amountInGallons} gallons</Text>
                  </View>
                  {!!log.description && (
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Description</Text>
                      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>{log.description}</Text>
                    </View>
                  )}
                  {!!log.createdByName && (
                    <Text style={[styles.cardCreatedBy, { color: themeColors.textSecondary }]}>Logged by {log.createdByName}</Text>
                  )}
                </TouchableOpacity>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  actionBar: {
    flexDirection: 'row', gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.sm,
  },
  actionBtn: { flex: 1 },
  searchRow: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  searchInput: {},
  selectAllRow: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  selectAllText: { fontSize: FONTS.sm, color: COLORS.primary, fontWeight: '600' },
  loader: { marginTop: SPACING.xl },
  listContent: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  emptyState: {
    borderRadius: 12, padding: SPACING.xl, alignItems: 'center',
    shadowColor: COLORS.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  card: {
    borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md,
    shadowColor: COLORS.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
    borderWidth: 2, borderColor: 'transparent',
  },
  cardSelected: { borderColor: COLORS.primary },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  cardDate: { fontSize: FONTS.base, fontWeight: '700' },
  cardDot: { fontSize: FONTS.base },
  cardTime: { fontSize: FONTS.base, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: SPACING.md },
  editBtn: { fontSize: FONTS.sm, color: COLORS.primary, fontWeight: '600' },
  deleteBtn: { fontSize: FONTS.sm, color: COLORS.danger, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: SPACING.sm },
  badgeText: { fontSize: FONTS.sm, fontWeight: '700' },
  cardRow: { marginBottom: SPACING.sm },
  cardLabel: { fontSize: FONTS.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  cardValue: { fontSize: FONTS.base },
  cardCreatedBy: { fontSize: FONTS.xs, fontStyle: 'italic', marginTop: SPACING.xs },
  checkbox: {
    width: 22, height: 22, borderRadius: BORDER_RADIUS.sm, borderWidth: 2,
    borderColor: COLORS.gray300, justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkmark: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
});
