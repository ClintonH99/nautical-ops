/**
 * Inventory Screen
 * Create button, department filter, list of inventory items. Export mode: select items → Export to PDF.
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
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import inventoryService, { InventoryItem } from '../services/inventory';
import { Department } from '../types';
import { exportInventoryToPdf } from '../utils/inventoryPdf';
import { Button, Input } from '../components';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

export const InventoryScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>({
    BRIDGE: true,
    ENGINEERING: true,
    EXTERIOR: true,
    INTERIOR: true,
    GALLEY: true,
  });
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const vesselId = user?.vesselId ?? null;

  const matchesSearch = (item: InventoryItem) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    if ((item.title ?? '').toLowerCase().includes(q)) return true;
    if ((item.description ?? '').toLowerCase().includes(q)) return true;
    if ((item.location ?? '').toLowerCase().includes(q)) return true;
    for (const row of item.items ?? []) {
      if ((row.item ?? '').toLowerCase().includes(q)) return true;
      if ((row.amount ?? '').toLowerCase().includes(q)) return true;
    }
    return false;
  };

  const filteredItems = (items ?? [])
    .filter((item) => visibleDepartments[item.department ?? 'INTERIOR'])
    .filter(matchesSearch);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = filteredItems.filter((item) => selectedIds.has(item.id));

  const handleExportPdf = async () => {
    if (selectedItems.length === 0) {
      Alert.alert('No selection', 'Select at least one inventory item to export.');
      return;
    }
    setExporting(true);
    try {
      await exportInventoryToPdf(selectedItems);
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Error', 'Could not export PDF.');
    } finally {
      setExporting(false);
    }
  };

  const selectDepartment = (dept: Department) => {
    setVisibleDepartments({
      BRIDGE: dept === 'BRIDGE',
      ENGINEERING: dept === 'ENGINEERING',
      EXTERIOR: dept === 'EXTERIOR',
      INTERIOR: dept === 'INTERIOR',
      GALLEY: dept === 'GALLEY',
    });
  };

  const selectAllDepartments = () => {
    setVisibleDepartments({
      BRIDGE: true,
      ENGINEERING: true,
      EXTERIOR: true,
      INTERIOR: true,
      GALLEY: true,
    });
  };

  const handleDelete = (item: InventoryItem) => {
    Alert.alert(
      'Remove item',
      `Remove "${item.title}" from inventory?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await inventoryService.delete(item.id);
              setItems((prev) => prev.filter((i) => i.id !== item.id));
            } catch (e) {
              console.error('Delete inventory item error:', e);
              Alert.alert('Error', 'Could not remove item.');
            }
          },
        },
      ]
    );
  };

  const loadItems = useCallback(async () => {
    if (!vesselId) return;
    setLoading(true);
    try {
      const data = await inventoryService.getByVessel(vesselId);
      setItems(data);
    } catch (e) {
      console.error('Load inventory items error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadItems();
  };

  const departmentDisplayText = DEPARTMENTS.every((d) => visibleDepartments[d])
    ? 'All departments'
    : DEPARTMENTS.filter((d) => visibleDepartments[d])
        .map((d) => d.charAt(0) + d.slice(1).toLowerCase())
        .join(', ');

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Inventory.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.primary]}
        />
      }
    >
      <View style={styles.searchRow}>
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by item, title, location…"
          style={[styles.searchInput, { backgroundColor: themeColors.surface }]}
          returnKeyType="search"
        />
      </View>
      <View style={styles.createRow}>
        <Button
          title="Create"
          onPress={() => navigation.navigate('AddEditInventoryItem')}
          variant="primary"
          fullWidth
        />
        <Button
          title={exportMode ? 'Cancel' : 'Export to PDF'}
          onPress={() => {
            if (exportMode) {
              setExportMode(false);
              setSelectedIds(new Set());
            } else {
              setExportMode(true);
            }
          }}
          variant="outline"
          fullWidth
          style={styles.exportBtn}
        />
      </View>
      {exportMode && (
        <View style={styles.exportBar}>
          <Text style={[styles.exportHint, { color: themeColors.textSecondary }]}>
            Tap items to select, then export.
          </Text>
          <Button
            title={exporting ? 'Exporting…' : `Export selected (${selectedItems.length})`}
            onPress={handleExportPdf}
            disabled={exporting || selectedItems.length === 0}
            variant="primary"
            fullWidth
          />
        </View>
      )}

      <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
      <TouchableOpacity
        style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
        onPress={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
        activeOpacity={0.7}
      >
        <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>{departmentDisplayText}</Text>
        <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>{departmentDropdownOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {departmentDropdownOpen && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentDropdownOpen(false)}>
            <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <TouchableOpacity
                style={[
                  styles.modalItem,
                  { backgroundColor: themeColors.surface },
                  DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemSelected,
                ]}
                onPress={() => {
                  selectAllDepartments();
                  setDepartmentDropdownOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.modalItemText,
                    { color: themeColors.textPrimary },
                    DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemTextSelected,
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
              {DEPARTMENTS.map((dept) => (
                <TouchableOpacity
                  key={dept}
                  style={[styles.modalItem, { backgroundColor: themeColors.surface }, visibleDepartments[dept] && styles.modalItemSelected]}
                  onPress={() => {
                    selectDepartment(dept);
                    setDepartmentDropdownOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalItemText,
                      { color: themeColors.textPrimary },
                      visibleDepartments[dept] && styles.modalItemTextSelected,
                    ]}
                  >
                    {dept.charAt(0) + dept.slice(1).toLowerCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={COLORS.primary} style={styles.loader} />
      ) : filteredItems.length === 0 ? (
        <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
          {items.length === 0
            ? 'No inventory items yet. Tap Create to add one.'
            : 'No items match your search or department filter.'}
        </Text>
      ) : (
        filteredItems.map((item) => {
          const selected = selectedIds.has(item.id);
          return (
          <TouchableOpacity
            key={item.id}
            style={[styles.card, { backgroundColor: themeColors.surface }, exportMode && selected && styles.cardSelected]}
            onPress={() => {
              if (exportMode) toggleSelect(item.id);
              else navigation.navigate('AddEditInventoryItem', { itemId: item.id });
            }}
            activeOpacity={0.8}
          >
            <View style={styles.cardContent}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <View
                  style={[
                    styles.deptBadge,
                    { backgroundColor: getDepartmentColor(item.department, overrides) },
                  ]}
                >
                  <Text style={styles.deptBadgeText}>
                    {(item.department ?? 'INTERIOR').charAt(0) + (item.department ?? 'INTERIOR').slice(1).toLowerCase()}
                  </Text>
                </View>
              </View>
              {item.location ? (
                <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>📍 {item.location}</Text>
              ) : null}
              {item.description ? (
                <Text style={[styles.cardDesc, { color: themeColors.textSecondary }]} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <Text style={[styles.cardRows, { color: themeColors.textSecondary }]}>
                {(item.items?.length ?? 0)} {(item.items?.length ?? 0) === 1 ? 'row' : 'rows'} (Amount · Item)
              </Text>
            </View>
            {exportMode ? (
              <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                {selected ? <Text style={styles.checkboxTick}>✓</Text> : null}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  handleDelete(item);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="trash-outline" size={22} color={COLORS.danger} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  searchRow: { marginBottom: SPACING.sm },
  searchInput: {},
  createRow: { marginBottom: SPACING.lg },
  exportBtn: { marginTop: SPACING.sm },
  exportBar: { marginBottom: SPACING.lg, paddingVertical: SPACING.sm },
  exportHint: { fontSize: FONTS.sm, marginBottom: SPACING.sm },
  filterLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  modalBox: { borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.sm, minWidth: 200 },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  modalItemSelected: {},
  modalItemText: { fontSize: FONTS.base },
  modalItemTextSelected: { color: COLORS.primary, fontWeight: '600' },
  loader: { marginVertical: SPACING.xl },
  empty: { fontSize: FONTS.base, paddingVertical: SPACING.xl },
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
  cardSelected: { borderWidth: 2, borderColor: COLORS.primary },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkboxTick: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  deleteBtn: { padding: SPACING.sm, marginLeft: SPACING.xs },
  cardContent: { flex: 1, minWidth: 0 },
  cardHeader: { marginBottom: SPACING.sm },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600' },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    marginTop: SPACING.xs,
    alignSelf: 'flex-start',
  },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  cardMeta: { fontSize: FONTS.sm, marginTop: 2 },
  cardDesc: { fontSize: FONTS.sm, marginTop: 2 },
  cardRows: { fontSize: FONTS.xs, marginTop: 4 },
});
