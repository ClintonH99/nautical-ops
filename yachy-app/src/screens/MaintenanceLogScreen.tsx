/**
 * Maintenance Log Screen
 * Spreadsheet-style list of logs; Add Log, Edit, Delete, Export PDF.
 * Logs persist until manually deleted.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import maintenanceLogsService from '../services/maintenanceLogs';
import vesselService from '../services/vessel';
import { MaintenanceLog } from '../types';
import { Button } from '../components';

const COLUMN_WIDTH = 110;
const DATE_WIDTH = 88;
const ACTIONS_WIDTH = 90;
const CHECKBOX_WIDTH = 44;

const FILTER_KEYS = [
  { key: 'equipment', label: 'Equipment' },
  { key: 'location', label: 'Location' },
  { key: 'serialNumber', label: 'Serial #' },
  { key: 'hoursOfService', label: 'Hrs' },
  { key: 'hoursAtNextService', label: 'Hrs next' },
  { key: 'whatServiceDone', label: 'Service done' },
  { key: 'serviceDoneBy', label: 'Done by' },
  { key: 'date', label: 'Date' },
] as const;

type FilterKey = (typeof FILTER_KEYS)[number]['key'];

function getLogFilterValue(log: MaintenanceLog, filterKey: FilterKey, formatDateFn: (d: string) => string): string {
  switch (filterKey) {
    case 'equipment':
      return log.equipment?.trim() || '—';
    case 'location':
      return log.portStarboardNa?.trim() || '—';
    case 'serialNumber':
      return log.serialNumber?.trim() || '—';
    case 'hoursOfService':
      return log.hoursOfService?.trim() || '—';
    case 'hoursAtNextService':
      return log.hoursAtNextService?.trim() || '—';
    case 'whatServiceDone':
      return log.whatServiceDone?.trim() || '—';
    case 'serviceDoneBy':
      return log.serviceDoneBy?.trim() || '—';
    case 'date':
      return formatDateFn(log.createdAt);
    default:
      return '—';
  }
}

function Checkbox({
  checked,
  onPress,
  disabled,
  themeColors,
}: {
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  themeColors: { surface: string };
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.checkbox,
        { backgroundColor: checked ? undefined : themeColors.surface },
        checked && styles.checkboxChecked,
      ]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {checked && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const MaintenanceLogScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    equipment: '',
    location: '',
    serialNumber: '',
    hoursOfService: '',
    hoursAtNextService: '',
    whatServiceDone: '',
    serviceDoneBy: '',
    date: '',
  });
  const [filterDropdownKey, setFilterDropdownKey] = useState<FilterKey | null>(null);

  const vesselId = user?.vesselId ?? null;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });

  const uniqueValuesByKey = useMemo(() => {
    const out: Record<FilterKey, string[]> = {
      equipment: [],
      location: [],
      serialNumber: [],
      hoursOfService: [],
      hoursAtNextService: [],
      whatServiceDone: [],
      serviceDoneBy: [],
      date: [],
    };
    logs.forEach((log) => {
      (FILTER_KEYS as readonly { key: FilterKey; label: string }[]).forEach(({ key }) => {
        const v = getLogFilterValue(log, key, formatDate);
        if (v && v !== '—' && !out[key].includes(v)) out[key].push(v);
      });
    });
    Object.keys(out).forEach((k) => {
      out[k as FilterKey].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    });
    return out;
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      return (FILTER_KEYS as readonly { key: FilterKey; label: string }[]).every(({ key }) => {
        const selected = filters[key];
        if (!selected) return true;
        const logValue = getLogFilterValue(log, key, formatDate);
        return logValue === selected;
      });
    });
  }, [logs, filters]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredLogs.map((l) => l.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  };

  const loadLogs = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await maintenanceLogsService.getByVessel(vesselId);
      setLogs(data);
    } catch (e) {
      console.error('Load maintenance logs error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [loadLogs])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadLogs();
  };

  const onAdd = () => {
    navigation.navigate('AddEditMaintenanceLog', {});
  };

  const onEdit = (log: MaintenanceLog) => {
    navigation.navigate('AddEditMaintenanceLog', { logId: log.id });
  };

  const onDelete = (log: MaintenanceLog) => {
    Alert.alert(
      'Delete log',
      `Delete maintenance log for "${log.equipment}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await maintenanceLogsService.delete(log.id);
              loadLogs();
            } catch (e) {
              Alert.alert('Error', 'Could not delete log');
            }
          },
        },
      ]
    );
  };

  const exportPdf = async () => {
    const logsToExport = logs.filter((l) => selectedIds.has(l.id));
    if (logsToExport.length === 0) {
      Alert.alert(
        'No logs selected',
        'Please select at least one log to include in the PDF.'
      );
      return;
    }

    try {
      setExportingPdf(true);
      
      // Get vessel name for filename
      let vesselName = 'Vessel';
      if (vesselId) {
        try {
          const vessel = await vesselService.getVessel(vesselId);
          if (vessel?.name) {
            // Sanitize vessel name for filename (remove invalid chars)
            vesselName = vessel.name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Vessel';
          }
        } catch (e) {
          console.error('Error fetching vessel name:', e);
        }
      }
      
      // Format date for filename (YYYY-MM-DD)
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const filename = `${vesselName}_${dateStr}_MaintenanceLog.pdf`;
      
      const rows = logsToExport.map(
        (l) =>
          `<tr>
            <td>${escapeHtml(l.equipment)}</td>
            <td>${escapeHtml(l.portStarboardNa)}</td>
            <td>${escapeHtml(l.serialNumber)}</td>
            <td>${escapeHtml(l.hoursOfService)}</td>
            <td>${escapeHtml(l.hoursAtNextService)}</td>
            <td>${escapeHtml(l.whatServiceDone)}</td>
            <td>${escapeHtml(l.notes)}</td>
            <td>${escapeHtml(l.serviceDoneBy)}</td>
            <td>${formatDate(l.createdAt)}</td>
          </tr>`
      ).join('');

      const html = `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Maintenance Log</title>
          <style>
            @page { size: A4 landscape; margin: 16mm 14mm; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: system-ui, sans-serif; font-size: 11px; color: #111; }
            h1 { font-size: 20px; font-weight: 700; color: #1E3A8A; margin-bottom: 4px; }
            .subtitle { font-size: 11px; color: #666; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            thead tr { background: #1E3A8A; color: #fff; }
            th { padding: 8px 8px; text-align: left; font-weight: 600; font-size: 10px; }
            td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
            tr:nth-child(even) td { background: #f9fafb; }
          </style>
        </head>
        <body>
          <h1>Maintenance Log</h1>
          <p class="subtitle">${vesselName} &nbsp;·&nbsp; Generated ${dateStr}</p>
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Location</th>
                <th>Serial #</th>
                <th>Hrs service</th>
                <th>Hrs next</th>
                <th>What service done</th>
                <th>Notes</th>
                <th>Done by</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows : '<tr><td colspan="9" style="color:#999;font-style:italic;padding:12px">No entries</td></tr>'}
            </tbody>
          </table>
        </body>
        </html>`;

      const { uri } = await Print.printToFileAsync({ html });
      
      // Rename file with vessel name, date, and "Maintenance Log"
      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.moveAsync({
        from: uri,
        to: newUri,
      });
      
      await Sharing.shareAsync(newUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Save Maintenance Log PDF',
      });
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert(
        'Export failed',
        'Could not generate PDF. If you added expo-print or expo-sharing recently, try: npx expo start --clear and rebuild the app (e.g. re-open in Expo Go or create a new development build).'
      );
    } finally {
      setExportingPdf(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to see maintenance logs.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <View style={styles.actionsRow}>
        <View style={styles.leftActions}>
          <Button
            title="Add Log"
            onPress={onAdd}
            variant="primary"
            style={styles.addButton}
          />
          {logs.length > 0 && (
            <TouchableOpacity onPress={toggleSelectAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.selectAllWrap}>
              <Text style={styles.selectAllLink}>
                {filteredLogs.length > 0 && filteredLogs.every((l) => selectedIds.has(l.id)) ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Button
          title={
            exportingPdf
              ? 'Exporting…'
              : selectedIds.size > 0
                ? `Download PDF (${selectedIds.size} selected)`
                : 'Download PDF'
          }
          onPress={exportPdf}
          variant="outline"
          style={styles.pdfButton}
          disabled={exportingPdf || logs.length === 0 || selectedIds.size === 0}
        />
      </View>

      {logs.length > 0 && !loading && (
        <View style={styles.filterBarWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBarContent}>
            {FILTER_KEYS.map(({ key, label }) => {
              const value = filters[key];
              const display = value || 'All';
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterChip, { backgroundColor: themeColors.surface }, value ? styles.filterChipActive : null]}
                  onPress={() => setFilterDropdownKey(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterChipLabel, { color: themeColors.textSecondary }]} numberOfLines={1}>{label}</Text>
                  <Text style={[styles.filterChipValue, { color: themeColors.textPrimary }, value ? styles.filterChipValueActive : null]} numberOfLines={1}>
                    {display}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {(FILTER_KEYS as readonly { key: FilterKey }[]).some(({ key }) => filters[key]) && (
            <TouchableOpacity onPress={() => setFilters({ equipment: '', location: '', serialNumber: '', hoursOfService: '', hoursAtNextService: '', whatServiceDone: '', serviceDoneBy: '', date: '' })} style={styles.clearFiltersWrap}>
              <Text style={styles.clearFiltersLink}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {filterDropdownKey && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.filterModalBackdrop} onPress={() => setFilterDropdownKey(null)}>
            <View style={[styles.filterModalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.filterModalTitle, { color: themeColors.textPrimary }]}>{FILTER_KEYS.find((f) => f.key === filterDropdownKey)?.label ?? filterDropdownKey}</Text>
              <FlatList
                data={['', ...uniqueValuesByKey[filterDropdownKey]]}
                keyExtractor={(item, i) => (item || 'all') + i}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.filterModalItem, filters[filterDropdownKey] === item && styles.filterModalItemSelected]}
                    onPress={() => {
                      setFilters((prev) => ({ ...prev, [filterDropdownKey]: item }));
                      setFilterDropdownKey(null);
                    }}
                  >
                    <Text style={[styles.filterModalItemText, { color: themeColors.textPrimary }]}>{item || 'All'}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </Pressable>
        </Modal>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : logs.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
        >
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No maintenance logs yet</Text>
            <Button title="Add first log" onPress={onAdd} variant="primary" style={styles.emptyBtn} />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.verticalScroll}
          contentContainerStyle={[styles.verticalScrollContent, { paddingBottom: SIZES.bottomScrollPadding }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
          showsVerticalScrollIndicator
        >
          <ScrollView
            horizontal
            style={styles.tableScroll}
            contentContainerStyle={styles.tableContent}
            showsHorizontalScrollIndicator
          >
          <View style={styles.table}>
            <View style={[styles.row, styles.headerRow]}>
              <View style={[styles.cellView, styles.headerCellView, styles.checkboxHeaderCell, { width: CHECKBOX_WIDTH }]}>
                <Checkbox
                  checked={filteredLogs.length > 0 && filteredLogs.every((l) => selectedIds.has(l.id))}
                  onPress={toggleSelectAll}
                  disabled={filteredLogs.length === 0}
                  themeColors={themeColors}
                />
              </View>
              <Text style={[styles.cell, styles.headerCell, { width: COLUMN_WIDTH }]}>Equipment</Text>
              <Text style={[styles.cell, styles.headerCell, { width: 72 }]}>Location</Text>
              <Text style={[styles.cell, styles.headerCell, { width: COLUMN_WIDTH }]}>Serial #</Text>
              <Text style={[styles.cell, styles.headerCell, { width: 70 }]}>Hrs</Text>
              <Text style={[styles.cell, styles.headerCell, { width: 70 }]}>Hrs next</Text>
              <Text style={[styles.cell, styles.headerCell, { width: COLUMN_WIDTH }]}>Service done</Text>
              <Text style={[styles.cell, styles.headerCell, { width: COLUMN_WIDTH }]}>Notes</Text>
              <Text style={[styles.cell, styles.headerCell, { width: COLUMN_WIDTH }]}>Done by</Text>
              <Text style={[styles.cell, styles.headerCell, { width: DATE_WIDTH }]}>Date</Text>
              <View style={[styles.cellView, styles.headerCellView, { width: ACTIONS_WIDTH }]} />
            </View>
            {filteredLogs.length === 0 ? (
              <View style={styles.filterEmptyRow}>
                <Text style={[styles.filterEmptyText, { color: themeColors.textSecondary }]}>No logs match the current filters</Text>
              </View>
            ) : (
            filteredLogs.map((log) => (
              <View key={log.id} style={styles.row}>
                <View style={[styles.cell, styles.checkboxCell, { width: CHECKBOX_WIDTH }]}>
                  <Checkbox
                    checked={selectedIds.has(log.id)}
                    onPress={() => toggleSelect(log.id)}
                    themeColors={themeColors}
                  />
                </View>
                <Text style={[styles.cell, { width: COLUMN_WIDTH, color: themeColors.textPrimary }]} numberOfLines={2}>{log.equipment}</Text>
                <Text style={[styles.cell, { width: 72, color: themeColors.textPrimary }]} numberOfLines={1}>{log.portStarboardNa || '—'}</Text>
                <Text style={[styles.cell, { width: COLUMN_WIDTH, color: themeColors.textPrimary }]} numberOfLines={1}>{log.serialNumber || '—'}</Text>
                <Text style={[styles.cell, { width: 70, color: themeColors.textPrimary }]} numberOfLines={1}>{log.hoursOfService || '—'}</Text>
                <Text style={[styles.cell, { width: 70, color: themeColors.textPrimary }]} numberOfLines={1}>{log.hoursAtNextService || '—'}</Text>
                <Text style={[styles.cell, { width: COLUMN_WIDTH, color: themeColors.textPrimary }]} numberOfLines={2}>{log.whatServiceDone || '—'}</Text>
                <Text style={[styles.cell, { width: COLUMN_WIDTH, color: themeColors.textPrimary }]} numberOfLines={2}>{log.notes || '—'}</Text>
                <Text style={[styles.cell, { width: COLUMN_WIDTH, color: themeColors.textPrimary }]} numberOfLines={1}>{log.serviceDoneBy || '—'}</Text>
                <Text style={[styles.cell, { width: DATE_WIDTH }, styles.dateCell, { color: themeColors.textSecondary }]}>{formatDate(log.createdAt)}</Text>
                <View style={[styles.cell, styles.actionsCell, { width: ACTIONS_WIDTH }]}>
                  <TouchableOpacity onPress={() => onDelete(log)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onEdit(log)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.editBtn}>Edit</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
            )}
          </View>
          </ScrollView>
        </ScrollView>
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
  actionsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  leftActions: {
    flex: 1,
    gap: SPACING.xs,
  },
  addButton: {
    alignSelf: 'stretch',
  },
  selectAllWrap: {
    alignSelf: 'flex-start',
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },
  selectAllLink: {
    fontSize: FONTS.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
  pdfButton: {
    flex: 1,
  },
  filterBarWrap: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    gap: SPACING.xs,
  },
  filterBarContent: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  filterChip: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    minWidth: 72,
    maxWidth: 120,
  },
  filterChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight + '20',
  },
  filterChipLabel: {
    fontSize: FONTS.xs,
    marginBottom: 2,
  },
  filterChipValue: {
    fontSize: FONTS.sm,
    fontWeight: '500',
  },
  filterChipValueActive: {
    color: COLORS.primary,
  },
  clearFiltersWrap: {
    alignSelf: 'flex-start',
    marginTop: SPACING.xs,
  },
  clearFiltersLink: {
    fontSize: FONTS.sm,
    color: COLORS.primary,
    fontWeight: '600',
  },
  filterModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  filterModalBox: {
    borderRadius: BORDER_RADIUS.lg,
    maxHeight: '70%',
    width: '100%',
    maxWidth: 320,
    overflow: 'hidden',
  },
  filterModalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  filterModalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray200,
  },
  filterModalItemSelected: {
    backgroundColor: COLORS.primaryLight + '20',
  },
  filterModalItemText: {
    fontSize: FONTS.base,
  },
  filterEmptyRow: {
    padding: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  filterEmptyText: {
    fontSize: FONTS.base,
  },
  loader: {
    marginTop: SPACING.xl,
  },
  emptyScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  empty: {
    alignItems: 'center',
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.lg,
    marginBottom: SPACING.lg,
  },
  emptyBtn: {
    minWidth: 160,
  },
  verticalScroll: {
    flex: 1,
  },
  verticalScrollContent: {
    flexGrow: 1,
  },
  tableScroll: {
    flexGrow: 0,
  },
  tableContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  table: {
    minWidth: CHECKBOX_WIDTH + 2 * COLUMN_WIDTH * 3 + 70 * 2 + DATE_WIDTH + ACTIONS_WIDTH,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    alignItems: 'center',
    minHeight: 44,
  },
  headerRow: {
    backgroundColor: COLORS.primary,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
  },
  cell: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    fontSize: FONTS.sm,
  },
  cellView: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  headerCell: {
    color: COLORS.white,
    fontWeight: '600' as const,
    fontSize: FONTS.xs,
  },
  headerCellView: {
    /* layout only, no text props - for View */
  },
  dateCell: {},
  actionsCell: {
    flexDirection: 'row',
    gap: SPACING.xs,
    justifyContent: 'flex-start',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: COLORS.gray400,
    borderRadius: BORDER_RADIUS.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxHeaderCell: {
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
  },
  checkboxCell: {
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
  },
  editBtn: {
    fontSize: FONTS.xs,
    color: COLORS.primary,
    fontWeight: '600',
  },
  deleteBtn: {
    fontSize: FONTS.xs,
    color: COLORS.danger,
    fontWeight: '600',
  },
});
