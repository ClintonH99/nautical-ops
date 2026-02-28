/**
 * Pre-Departure Checklist Screen
 * List of pre-departure checklists; Create button to add new
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import preDepartureChecklistsService from '../services/preDepartureChecklists';
import vesselService from '../services/vessel';
import { PreDepartureChecklist, Department } from '../types';
import { Button } from '../components';
import { generatePreDepartureChecklistPdf } from '../utils/preDepartureChecklistPdf';

const CAPTAIN_CHECKLIST_MAX_ITEMS = 15;

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
  const [checklists, setChecklists] = useState<PreDepartureChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [departmentFilter, setDepartmentFilter] = useState<Department | ''>('');
  const [departmentModalVisible, setDepartmentModalVisible] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';
  const isCaptain = user?.position?.toLowerCase() === 'captain';

  const canEditChecklist = (checklist: PreDepartureChecklist) =>
    checklist.department === null ? isCaptain : isHOD;

  const filteredChecklists = useMemo(() => {
    if (!departmentFilter) return checklists;
    return checklists.filter(
      (c) => c.department === departmentFilter || c.department === null
    );
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

  const allSelected = filteredChecklists.length > 0 && selectedIds.size === filteredChecklists.length;

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
  }, [vesselId]);

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
    Alert.alert(
      'Delete checklist',
      `Delete "${checklist.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await preDepartureChecklistsService.delete(checklist.id);
              loadChecklists();
            } catch (e) {
              Alert.alert('Error', 'Could not delete checklist');
            }
          },
        },
      ]
    );
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
      const safeName = vesselName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Vessel';
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
      ? DEPARTMENT_OPTIONS.find((o) => o.value === item.department)?.label ?? item.department
      : 'All';
    const isSelected = selectedIds.has(item.id);
    return (
      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <TouchableOpacity
          style={[styles.cardCheckbox, isSelected && styles.cardCheckboxSelected]}
          onPress={() => toggleSelection(item.id)}
          activeOpacity={0.7}
        >
          <Text style={[styles.checkboxIcon, styles.cardCheckboxIcon]}>{isSelected ? '✓' : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cardContent}
          onPress={() => onEdit(item)}
          activeOpacity={0.8}
        >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.cardDateHeader, { color: themeColors.textSecondary }]}>{formatDate(item.createdAt)}</Text>
          {canEditChecklist(item) && (
            <TouchableOpacity
              onPress={() => onDelete(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.cardMeta}>
          <Text style={[styles.deptBadge, { color: themeColors.textSecondary }]}>{deptLabel}</Text>
          <Text style={[styles.cardProgress, { color: themeColors.textSecondary }]}>{count} items</Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.cardActionBtn, styles.cardActionBtnView]}
            onPress={() => onView(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.cardActionBtnText}>View</Text>
          </TouchableOpacity>
        </View>
        </TouchableOpacity>
      </View>
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to manage pre-departure checklists.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const ListHeader = (
    <>
      <View style={styles.boardHeader}>
        <Text style={[styles.boardTitle, { color: COLORS.primary }]}>Pre-Departure Checklist</Text>
        <Text style={[styles.boardHint, { color: themeColors.textSecondary }]}>
          {isHOD
            ? 'Add tasks for crew to complete before each departure. Read and do.'
            : 'Tasks to complete before departure. Read and do.'}
        </Text>
      </View>
      <View style={styles.actionBar}>
        {(isHOD || isCaptain) && (
          <Button title="Create" onPress={onCreate} variant="primary" fullWidth />
        )}
        <Button
          title={
            exportingPdf
              ? 'Exporting…'
              : selectedChecklists.length > 0
                ? `Export to PDF (${selectedChecklists.length})`
                : 'Export to PDF'
          }
          onPress={onExportPdf}
          variant="outline"
          fullWidth
          disabled={exportingPdf || selectedChecklists.length === 0}
          style={styles.exportBtn}
        />
      </View>
      {filteredChecklists.length > 0 && (
        <View style={[styles.selectionBar, { backgroundColor: themeColors.surface }]}>
          <View style={styles.selectionBarActions}>
            <TouchableOpacity onPress={toggleSelectAll} style={styles.selectionBarBtn} activeOpacity={0.7}>
              <Text style={styles.selectionBarBtnText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {captainBoard && (
        <View style={styles.captainBoard}>
          <TouchableOpacity
            style={[styles.checkbox, selectedIds.has(captainBoard.id) && styles.checkboxSelected]}
            onPress={() => toggleSelection(captainBoard.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.checkboxIcon}>{selectedIds.has(captainBoard.id) ? '✓' : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.captainBoardContent}
            onPress={() => onEdit(captainBoard)}
            activeOpacity={0.9}
          >
          <Text style={styles.captainBoardBadge}>Captain's Checklist</Text>
            <Text style={styles.captainBoardTitle} numberOfLines={1}>
              {captainBoard.title}
            </Text>
            <View style={styles.captainBoardItems}>
              {captainBoard.items
                .slice(0, CAPTAIN_CHECKLIST_MAX_ITEMS)
                .map((item, idx) => (
                  <View key={item.id} style={styles.captainBoardItemRow}>
                    <Text style={styles.captainBoardItemNum}>{idx + 1}.</Text>
                    <Text style={styles.captainBoardItemLabel}>{item.label}</Text>
                  </View>
                ))}
              {captainBoard.items.length === 0 && (
                <Text style={styles.captainBoardEmpty}>No items yet</Text>
              )}
              {captainBoard.items.length > CAPTAIN_CHECKLIST_MAX_ITEMS && (
                <Text style={styles.readMore}>Read More...</Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.filterBar}>
        <View style={styles.filterBarContent}>
          <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
          <TouchableOpacity
            style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
            onPress={() => setDepartmentModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
              {departmentFilter ? DEPARTMENT_OPTIONS.find((o) => o.value === departmentFilter)?.label ?? departmentFilter : 'All departments'}
            </Text>
            <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
              {departmentModalVisible ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
        </View>
        {departmentFilter ? (
          <TouchableOpacity onPress={() => setDepartmentFilter('')} style={styles.clearFilters}>
            <Text style={[styles.clearFiltersText, { color: themeColors.textPrimary }]}>Clear filter</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {departmentModalVisible && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentModalVisible(false)}>
            <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>Filter by department</Text>
              {DEPARTMENT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value || 'all'}
                  style={[styles.modalItem, departmentFilter === opt.value && styles.modalItemSelected]}
                  onPress={() => {
                    setDepartmentFilter(opt.value);
                    setDepartmentModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
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
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
                {filteredChecklists.length === 0 && checklists.length > 0 ? 'No matching checklists' : 'No checklists yet'}
              </Text>
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
                {filteredChecklists.length === 0 && checklists.length > 0
                  ? 'Try a different department filter.'
                  : (isHOD || isCaptain)
                    ? 'Tap "Create" to add a checklist. Use "All Departments" for the Captain\'s board.'
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
  boardHeader: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  boardTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.xs },
  boardHint: { fontSize: FONTS.sm },
  actionBar: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  exportBtn: { marginTop: SPACING.sm },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  filterBarContent: { flex: 1 },
  filterLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  clearFilters: {
    paddingVertical: SPACING.xs,
  },
  clearFiltersText: {
    fontSize: FONTS.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    minWidth: 260,
    maxHeight: 400,
  },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemSelected: {
    backgroundColor: COLORS.gray200,
  },
  modalItemText: { fontSize: FONTS.base },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
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
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
    marginTop: 2,
  },
  checkboxIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
  checkboxSelected: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderColor: COLORS.white,
  },
  captainBoard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  captainBoardContent: { flex: 1 },
  captainBoardBadge: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    color: COLORS.white,
    opacity: 0.9,
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  captainBoardTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  captainBoardItems: {},
  captainBoardItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
  },
  captainBoardItemNum: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.white,
    opacity: 0.9,
    marginRight: SPACING.sm,
  },
  captainBoardItemLabel: {
    flex: 1,
    fontSize: FONTS.base,
    color: COLORS.white,
    lineHeight: 22,
  },
  captainBoardEmpty: {
    fontSize: FONTS.sm,
    color: COLORS.white,
    opacity: 0.7,
  },
  readMore: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.white,
    opacity: 0.95,
    marginTop: SPACING.sm,
  },
  list: {
    padding: SPACING.lg,
    paddingBottom: 88,
  },
  listEmpty: {
    flexGrow: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
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
    gap: SPACING.sm,
  },
  cardCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.gray300,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
    marginTop: 2,
  },
  cardCheckboxSelected: {
    backgroundColor: COLORS.gray100,
    borderColor: COLORS.primary,
  },
  cardCheckboxIcon: {
    color: COLORS.primary,
    fontSize: 12,
  },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1, minWidth: 0 },
  cardDateHeader: { fontSize: FONTS.sm, flexShrink: 0 },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  deptBadge: {
    fontSize: FONTS.xs,
    backgroundColor: COLORS.gray100,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  cardActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
  },
  cardActionBtn: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.sm,
  },
  cardActionBtnView: {
    backgroundColor: COLORS.gray100,
  },
  cardActionBtnText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  cardProgress: { fontSize: FONTS.sm },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyEmoji: { fontSize: 48, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '600', marginBottom: SPACING.sm, textAlign: 'center' },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
});
