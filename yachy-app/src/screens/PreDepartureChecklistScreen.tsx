import { ScreenLoading } from '../components/ScreenLoading';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
import { optimisticDelete } from '../utils/optimisticDelete';
/**
 * Pre-Departure Checklist Screen
 * List of pre-departure checklists; Create button to add new
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import preDepartureChecklistsService from '../services/preDepartureChecklists';
import vesselService from '../services/vessel';
import { PreDepartureChecklist, Department } from '../types';
import {
  Button,
  ButtonTagCard,
  ButtonTagRow,
  DepartmentSelector,
  LoadingSpinner,
  PageHeader,
  ExportButton,
  ExportBar,
} from '../components';
import { generatePreDepartureChecklistPdf } from '../utils/preDepartureChecklistPdf';

const CAPTAIN_CHECKLIST_PREVIEW_ITEMS = 3;

const PRE_DEPARTURE_INFO = {
  title: 'Pre-Departure Checklist',
  description: 'Prepare the vessel and crew before departure.',
  features: [
    'Create checklists for all departments or a specific department',
    'Link a checklist to an upcoming trip',
    'Review published departure requirements',
    'Select and export checklists to PDF',
  ],
};

const DEPARTMENT_OPTIONS: { value: Department | ''; label: string }[] = [
  { value: '', label: 'All Departments' },
  { value: 'BRIDGE', label: 'Bridge' },
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'EXTERIOR', label: 'Exterior' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'GALLEY', label: 'Galley' },
];

export const PreDepartureChecklistScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [checklists, setChecklists] = useScreenState<PreDepartureChecklist[]>('checklists', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [departmentFilter, setDepartmentFilter] = useState<Department | ''>('');

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const isCaptain = user?.role === 'CAPTAIN_MOV';

  const canEditChecklist = (_checklist: PreDepartureChecklist) => isCaptain || isHOD;

  const filteredChecklists = useMemo(() => {
    if (!departmentFilter) return checklists;
    return checklists.filter((c) => c.department === departmentFilter || c.department === null);
  }, [checklists, departmentFilter]);

  const captainBoard = useMemo(() => {
    const allDeptChecklists = filteredChecklists.filter((c) => c.department === null);
    return allDeptChecklists[0] ?? null;
  }, [filteredChecklists]);

  const otherChecklists = useMemo(() => {
    if (!captainBoard) return filteredChecklists;
    return filteredChecklists.filter((c) => c.id !== captainBoard.id);
  }, [filteredChecklists, captainBoard]);

  const selectedChecklists = useMemo(() => {
    return filteredChecklists.filter((c) => selectedIds.has(c.id));
  }, [filteredChecklists, selectedIds]);

  useEffect(() => {
    const validIds = new Set(filteredChecklists.map((c) => c.id));
    setSelectedIds((prev) => {
      const kept = new Set([...prev].filter((id) => validIds.has(id)));
      return kept;
    });
  }, [filteredChecklists]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected =
    filteredChecklists.length > 0 && selectedIds.size === filteredChecklists.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredChecklists.map((c) => c.id)));
    }
  }, [filteredChecklists, allSelected]);

  const loadChecklists = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await preDepartureChecklistsService.getByVessel(vesselId);
      setChecklists(data);
    } catch (e) {
      console.error('Load pre-departure checklists error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setChecklists, setLoading, vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadChecklists();
    }, [loadChecklists])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadChecklists();
  };

  const onCreate = () => {
    navigation.navigate('AddEditPreDepartureChecklist', {});
  };

  const onEdit = (checklist: PreDepartureChecklist) => {
    if (!canEditChecklist(checklist)) {
      onView(checklist);
      return;
    }
    navigation.navigate('AddEditPreDepartureChecklist', { checklistId: checklist.id });
  };

  const onDelete = (checklist: PreDepartureChecklist) => {
    if (!canEditChecklist(checklist)) return;
    Alert.alert('Delete checklist', `Delete "${checklist.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await optimisticDelete(checklist, setChecklists, () =>
              preDepartureChecklistsService.delete(checklist.id)
            );
          } catch (e) {
            Alert.alert('Error', 'Could not delete checklist');
          }
        },
      },
    ]);
  };

  const onView = (checklist: PreDepartureChecklist) => {
    navigation.navigate('ViewPreDepartureChecklist', { checklistId: checklist.id });
  };

  const onExportPdf = async () => {
    if (!vesselId || selectedChecklists.length === 0) {
      Alert.alert('No selection', 'Select at least one checklist to export.');
      return;
    }
    setExportingPdf(true);
    try {
      const vessel = await vesselService.getVessel(vesselId);
      const vesselName = vessel?.name || 'Vessel';
      const safeName =
        vesselName
          .replace(/[^a-z0-9]/gi, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '') || 'Vessel';
      const filename = `${safeName}_Pre_Departure_Checklist.pdf`;
      await generatePreDepartureChecklistPdf(selectedChecklists, vesselName, filename);
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Error', 'Could not export PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const itemCount = (c: PreDepartureChecklist) => c.items.length;

  const renderItem = ({ item }: { item: PreDepartureChecklist }) => {
    const count = itemCount(item);
    const deptLabel = item.department
      ? (DEPARTMENT_OPTIONS.find((o) => o.value === item.department)?.label ?? item.department)
      : 'All';
    const isSelected = selectedIds.has(item.id);
    return (
      <ButtonTagCard
        headerTitle={item.title ?? ''}
        minimal
        onPress={() => onView(item)}
        showCheckbox={exportMode}
        checked={isSelected}
        onToggleSelect={() => toggleSelection(item.id)}
        selected={isSelected}
        onEdit={() => onEdit(item)}
        onDelete={canEditChecklist(item) ? () => onDelete(item) : undefined}
      >
        <ButtonTagRow label="Date" value={formatDate(item.createdAt)} />
        <ButtonTagRow label="Department" value={deptLabel} />
        {item.linkedTrip && (
          <ButtonTagRow
            label="Linked Trip"
            value={`${item.linkedTrip.title} · ${formatDate(item.linkedTrip.startDate)}`}
          />
        )}
        <ButtonTagRow label="Items" value={`${count} items`} />
      </ButtonTagCard>
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to manage pre-departure checklists.
        </Text>
      </View>
    );
  }

  if (loading) {
    return <ScreenLoading title="Pre-Departure Checklist" />;
  }

  const ListHeader = (
    <>
      <View style={styles.actionBar}>
        {(isHOD || isCaptain) && (
          <Button
            title="Create Pre-Departure Checklist"
            onPress={onCreate}
            variant="primary"
            fullWidth
          />
        )}
      </View>
      {exportMode && filteredChecklists.length > 0 && (
        <View
          style={[
            styles.selectionBar,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <View style={styles.selectionBarActions}>
            <TouchableOpacity
              onPress={toggleSelectAll}
              style={styles.selectionBarBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.selectionBarBtnText}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <View style={styles.filterBar}>
        <View style={styles.filterBarContent}>
          <DepartmentSelector
            value={departmentFilter || null}
            onChange={(value) => setDepartmentFilter(value ?? '')}
            includeAll
            tightTop
          />
        </View>
        {departmentFilter ? (
          <TouchableOpacity onPress={() => setDepartmentFilter('')} style={styles.clearFilters}>
            <Text style={[styles.clearFiltersText, { color: themeColors.textPrimary }]}>
              Clear filter
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {captainBoard && (
        <ButtonTagCard
          headerLeft={
            <View style={styles.captainHeader}>
              <Text style={[styles.captainEyebrow, { color: themeColors.textSecondary }]}>
                CAPTAIN'S CHECKLIST
              </Text>
              <Text
                style={[
                  styles.captainTitle,
                  { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                ]}
                numberOfLines={1}
              >
                {captainBoard.title}
              </Text>
            </View>
          }
          minimal
          onPress={() => onView(captainBoard)}
          showCheckbox={exportMode}
          checked={selectedIds.has(captainBoard.id)}
          onToggleSelect={() => toggleSelection(captainBoard.id)}
          selected={selectedIds.has(captainBoard.id)}
          onEdit={() => onEdit(captainBoard)}
          onDelete={canEditChecklist(captainBoard) ? () => onDelete(captainBoard) : undefined}
        >
          <View style={styles.captainMeta}>
            <Text style={[styles.captainMetaText, { color: themeColors.textSecondary }]}>
              All Departments
            </Text>
            <Text style={[styles.captainMetaText, { color: themeColors.textSecondary }]}>
              {itemCount(captainBoard)} items
            </Text>
          </View>
          {captainBoard.linkedTrip && (
            <Text
              style={[styles.captainTrip, { color: themeColors.textSecondary }]}
              numberOfLines={1}
            >
              {captainBoard.linkedTrip.title} · {formatDate(captainBoard.linkedTrip.startDate)}
            </Text>
          )}
          <View style={[styles.previewItems, { borderTopColor: themeColors.border }]}>
            {captainBoard.items
              .slice(0, CAPTAIN_CHECKLIST_PREVIEW_ITEMS)
              .map((checklistItem, index) => (
                <View key={checklistItem.id} style={styles.previewItemRow}>
                  <Text style={[styles.previewItemNumber, { color: themeColors.textSecondary }]}>
                    {index + 1}
                  </Text>
                  <Text style={[styles.previewItemLabel, { color: themeColors.textPrimary }]}>
                    {checklistItem.label}
                  </Text>
                </View>
              ))}
            {captainBoard.items.length === 0 && (
              <Text style={[styles.captainEmpty, { color: themeColors.textSecondary }]}>
                No items yet
              </Text>
            )}
          </View>
        </ButtonTagCard>
      )}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Pre-Departure Checklist"
        info={PRE_DEPARTURE_INFO}
        infoScreenKey="pre_departure_checklist"
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
          count={selectedChecklists.length}
          onConfirm={onExportPdf}
          exporting={exportingPdf}
          hint="Tap checklists to select"
        />
      )}
      <FlatList
        data={otherChecklists}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          styles.list,
          otherChecklists.length === 0 && !captainBoard && styles.listEmpty,
        ]}
        ListEmptyComponent={
          otherChecklists.length === 0 && !captainBoard ? (
            <View style={styles.empty}>
              <Ionicons
                name="clipboard-outline"
                size={42}
                color={themeColors.textSecondary}
                style={styles.emptyIcon}
              />
              <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
                {filteredChecklists.length === 0 && checklists.length > 0
                  ? 'No matching checklists'
                  : 'No checklists yet'}
              </Text>
              <Text
                style={[
                  styles.emptyText,
                  { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                ]}
              >
                {filteredChecklists.length === 0 && checklists.length > 0
                  ? 'Try a different department filter.'
                  : isHOD || isCaptain
                    ? 'Tap Create Pre-Departure Checklist to add one. Use "All Departments" for the Captain\'s board.'
                    : 'No pre-departure tasks have been added yet.'}
              </Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  actionBar: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  filterBar: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
    gap: SPACING.xs,
  },
  filterBarContent: { width: '100%', alignSelf: 'stretch' },
  clearFilters: {
    paddingVertical: SPACING.xs,
    alignSelf: 'flex-end',
  },
  clearFiltersText: {
    fontSize: FONTS.sm,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  selectionBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  selectionBarBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  selectionBarBtnText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  captainHeader: { flex: 1 },
  captainEyebrow: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  captainTitle: { fontSize: FONTS.lg, fontWeight: '700' },
  captainMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  captainMetaText: { fontSize: FONTS.xs },
  captainTrip: { fontSize: FONTS.sm, marginBottom: SPACING.sm },
  previewItems: {
    borderTopWidth: 1,
    paddingTop: SPACING.sm,
    marginTop: SPACING.xs,
  },
  previewItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  previewItemNumber: {
    width: 24,
    fontSize: FONTS.xs,
    fontWeight: '700',
  },
  previewItemLabel: { flex: 1, fontSize: FONTS.sm, lineHeight: 20 },
  captainEmpty: { fontSize: FONTS.sm },
  list: {
    padding: SPACING.lg,
    paddingBottom: 88,
  },
  listEmpty: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: { marginBottom: SPACING.md },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
});
