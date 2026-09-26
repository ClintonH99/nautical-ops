import { optimisticDelete } from '../utils/optimisticDelete';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Maintenance Log Screen
 * Expandable maintenance records with create, edit, delete, and PDF export actions.
 * Logs persist until manually deleted.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { printStandardPdf } from '../utils/standardPdf';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import maintenanceLogsService from '../services/maintenanceLogs';
import vesselService from '../services/vessel';
import { MaintenanceLog } from '../types';
import {
  Button,
  LoadingSpinner,
  PageHeader,
  ExportButton,
  ExportBar,
  ButtonTagCard,
  ButtonTagRow,
} from '../components';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MAINTENANCE_LOG_INFO = {
  title: 'Maintenance Log',
  description: 'Record and track maintenance on vessel equipment.',
  features: [
    'Add maintenance log entries per equipment',
    'Review equipment, location, serial number, and service hours',
    'Track service intervals and hours to next service',
    'Select entries and export to PDF',
  ],
};

export const MaintenanceLogScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [logs, setLogs] = useScreenState<MaintenanceLog[]>('logs', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });

  const filteredLogs = logs;

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
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
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
  }, [setLoading, setLogs, vesselId]);

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

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const onEdit = (log: MaintenanceLog) => {
    navigation.navigate('AddEditMaintenanceLog', { logId: log.id });
  };

  const onDelete = (log: MaintenanceLog) => {
    Alert.alert('Delete log', `Delete maintenance log for "${log.equipment}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await optimisticDelete(log, setLogs, () => maintenanceLogsService.delete(log.id));
          } catch (e) {
            Alert.alert('Error', 'Could not delete log');
          }
        },
      },
    ]);
  };

  const exportPdf = async () => {
    const logsToExport = logs.filter((l) => selectedIds.has(l.id));
    if (logsToExport.length === 0) {
      Alert.alert('No logs selected', 'Please select at least one log to include in the PDF.');
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
            vesselName =
              vessel.name
                .replace(/[^a-z0-9]/gi, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '') || 'Vessel';
          }
        } catch (e) {
          console.error('Error fetching vessel name:', e);
        }
      }

      // Format date for filename (YYYY-MM-DD)
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const filename = `${vesselName}_${dateStr}_MaintenanceLog.pdf`;

      const rows = logsToExport
        .map(
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
        )
        .join('');

      const html = `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Maintenance Log</title>
          <style>
            @page { size: A4 portrait; margin: 16mm 14mm; }
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

      const { uri } = await printStandardPdf({ html, title: 'Maintenance Log' });

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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to see maintenance logs.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Maintenance Log"
        info={MAINTENANCE_LOG_INFO}
        infoScreenKey="maintenance_log"
        actions={
          <ExportButton
            active={exportMode}
            onPress={() => {
              if (exportMode) setSelectedIds(new Set());
              setExportMode(!exportMode);
            }}
          />
        }
      />
      {exportMode && (
        <ExportBar
          count={selectedIds.size}
          onConfirm={exportPdf}
          exporting={exportingPdf}
          hint="Tap logs to select"
        />
      )}
      <View style={styles.actionsRow}>
        <View style={styles.leftActions}>
          <Button
            title="Create Maintenance Log"
            onPress={onAdd}
            variant="primary"
            style={styles.addButton}
          />
          {exportMode && logs.length > 0 && (
            <TouchableOpacity
              onPress={toggleSelectAll}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.selectAllWrap}
            >
              <Text style={[styles.selectAllLink, { color: themeColors.accent }]}>
                {filteredLogs.length > 0 && filteredLogs.every((l) => selectedIds.has(l.id))
                  ? 'Deselect All'
                  : 'Select All'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <LoadingSpinner />
      ) : logs.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[themeColors.accent]}
              tintColor={themeColors.accent}
            />
          }
        >
          <View style={styles.empty}>
            <Ionicons
              name="clipboard-outline"
              size={44}
              color={themeColors.textSecondary}
              style={styles.emptyIcon}
            />
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              No maintenance logs yet
            </Text>
            <Button
              title="Create Maintenance Log"
              onPress={onAdd}
              variant="primary"
              style={styles.emptyBtn}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.verticalScroll}
          contentContainerStyle={[
            styles.verticalScrollContent,
            { paddingBottom: SIZES.bottomScrollPadding },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[themeColors.accent]}
              tintColor={themeColors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.recordList}>
            {filteredLogs.map((log) => {
              const selected = selectedIds.has(log.id);
              const summary = [formatDate(log.createdAt), log.portStarboardNa]
                .filter(Boolean)
                .join(' · ');
              return (
                <ButtonTagCard
                  key={log.id}
                  headerTitle={log.equipment}
                  minimal
                  collapsible
                  expanded={expandedId === log.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === log.id ? null : log.id))
                  }
                  summary={
                    <Text style={[styles.recordSummary, { color: themeColors.textSecondary }]}>
                      {summary}
                    </Text>
                  }
                  showCheckbox={exportMode}
                  checked={selected}
                  selected={selected}
                  onToggleSelect={() => toggleSelect(log.id)}
                  onEdit={() => onEdit(log)}
                  onDelete={() => onDelete(log)}
                >
                  <View style={[styles.serviceSummary, { borderColor: themeColors.border }]}>
                    <View style={styles.serviceSummaryCell}>
                      <Text style={[styles.detailLabel, { color: themeColors.textSecondary }]}>
                        Hours of service
                      </Text>
                      <Text style={[styles.detailValue, { color: themeColors.textPrimary }]}>
                        {log.hoursOfService || '—'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.serviceSummaryCell,
                        styles.serviceSummaryDivider,
                        { borderColor: themeColors.border },
                      ]}
                    >
                      <Text style={[styles.detailLabel, { color: themeColors.textSecondary }]}>
                        Next service
                      </Text>
                      <Text style={[styles.detailValue, { color: themeColors.textPrimary }]}>
                        {log.hoursAtNextService || '—'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.recordDetails}>
                    <ButtonTagRow label="Serial number" value={log.serialNumber || '—'} />
                    <ButtonTagRow label="Service completed" value={log.whatServiceDone || '—'} />
                    <ButtonTagRow label="Notes" value={log.notes || '—'} />
                    <ButtonTagRow label="Service done by" value={log.serviceDoneBy || '—'} />
                  </View>
                </ButtonTagCard>
              );
            })}
          </View>
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
  emptyScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  empty: {
    alignItems: 'center',
  },
  emptyIcon: {
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
    paddingHorizontal: SPACING.lg,
  },
  recordList: {
    paddingTop: SPACING.sm,
  },
  recordSummary: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  serviceSummary: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  serviceSummaryCell: {
    flex: 1,
    padding: SPACING.md,
  },
  serviceSummaryDivider: {
    borderLeftWidth: 1,
  },
  detailLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  detailValue: {
    fontSize: FONTS.lg,
    fontWeight: '700',
  },
  recordDetails: {
    marginTop: SPACING.xs,
  },
});
