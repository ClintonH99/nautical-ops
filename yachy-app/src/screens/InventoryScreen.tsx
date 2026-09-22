/**
 * Inventory Screen
 * Create button, department filter, list of inventory items. Export mode: select items → Export to PDF.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import inventoryService, { InventoryItem } from '../services/inventory';
import { Department } from '../types';
import { exportInventoryToPdf } from '../utils/inventoryPdf';
import {
  Button,
  Input,
  ButtonTagCard,
  PageHeader,
  ExportButton,
  ExportBar,
  DepartmentMultiSelector,
} from '../components';
import { DEPARTMENT_OPTIONS as DEPARTMENTS } from '../utils/departmentSelection';

const INVENTORY_INFO = {
  title: 'Inventory',
  description: 'Track stock and supplies across departments.',
  features: [
    'Create inventory items with quantities and locations',
    'Filter items by department',
    'Search across titles, descriptions, and locations',
    'Select items and export to PDF',
  ],
};

export const InventoryScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
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
  const [exportMode, setExportMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const loadedVesselIdRef = useRef<string | null>(null);

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

  const handleDelete = (item: InventoryItem) => {
    Alert.alert('Delete Inventory Item', `Delete "${item.title}" from inventory?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await inventoryService.delete(item.id);
            setItems((prev) => prev.filter((i) => i.id !== item.id));
          } catch (e) {
            console.error('Delete inventory item error:', e);
            Alert.alert('Error', 'Could not delete inventory item.');
          }
        },
      },
    ]);
  };

  const loadItems = useCallback(async () => {
    if (!vesselId) return;
    if (loadedVesselIdRef.current !== vesselId) {
      loadedVesselIdRef.current = vesselId;
      setItems([]);
      setLoading(true);
    }
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

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Inventory.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader
        title="Inventory"
        info={INVENTORY_INFO}
        infoScreenKey="inventory"
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
          count={selectedItems.length}
          onConfirm={handleExportPdf}
          exporting={exporting}
          hint="Tap items to select"
        />
      )}
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        <View style={styles.createRow}>
          <Button
            title="Create Inventory Item"
            onPress={() => navigation.navigate('AddEditInventoryItem')}
            variant="primary"
            fullWidth
          />
          <TouchableOpacity
            onPress={() => navigation.navigate('Uniforms')}
            style={[
              styles.uniformsButton,
              { borderColor: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open Uniforms"
          >
            <Ionicons
              name="shirt-outline"
              size={18}
              color={themeColors.isDark ? themeColors.textPrimary : COLORS.primary}
            />
            <Text
              style={[
                styles.uniformsButtonText,
                { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
              ]}
            >
              Uniforms
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.searchRow}>
          <Input
            variant="search"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search item, title or location…"
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>
        <DepartmentMultiSelector
          value={DEPARTMENTS.filter((department) => visibleDepartments[department])}
          onChange={(departments) =>
            setVisibleDepartments(
              DEPARTMENTS.reduce(
                (next, department) => ({ ...next, [department]: departments.includes(department) }),
                {} as Record<Department, boolean>
              )
            )
          }
          includeAll
          minSelections={1}
          layout="stacked"
          tightTop
        />

        <View style={styles.listHeading}>
          <Text
            style={[
              styles.listHeadingTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Inventory Items
          </Text>
          <Text style={[styles.recordCount, { color: themeColors.textSecondary }]}>
            {filteredItems.length} {filteredItems.length === 1 ? 'record' : 'records'}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color={COLORS.primary} style={styles.loader} />
        ) : filteredItems.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
            {items.length === 0
              ? 'No inventory items yet. Tap Create Inventory Item to add one.'
              : 'No items match your search or department filter.'}
          </Text>
        ) : (
          filteredItems.map((item) => {
            const selected = selectedIds.has(item.id);
            const dateStr = item.createdAt
              ? new Date(item.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: '2-digit',
                })
              : '';
            return (
              <ButtonTagCard
                key={item.id}
                headerTitle={item.title ?? ''}
                minimal
                showCheckbox={exportMode}
                checked={selected}
                onToggleSelect={() => toggleSelect(item.id)}
                selected={exportMode && selected}
                onEdit={() => navigation.navigate('AddEditInventoryItem', { itemId: item.id })}
                onDelete={() => handleDelete(item)}
                collapsible={!exportMode}
                expanded={expandedId === item.id}
                onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                summary={
                  <View style={styles.cardMetaLine}>
                    <View
                      style={[styles.departmentBadge, { backgroundColor: themeColors.accentSoft }]}
                    >
                      <Text
                        style={[
                          styles.departmentBadgeText,
                          { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
                        ]}
                      >
                        {item.department ?? 'INTERIOR'}
                      </Text>
                    </View>
                    {dateStr ? (
                      <Text style={[styles.cardMetaText, { color: themeColors.textSecondary }]}>
                        {dateStr}
                      </Text>
                    ) : null}
                  </View>
                }
              >
                <View
                  style={[styles.inventorySummary, { backgroundColor: themeColors.surfaceAlt }]}
                >
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                      Location
                    </Text>
                    <Text style={[styles.summaryValue, { color: themeColors.textPrimary }]}>
                      {item.location || 'Not specified'}
                    </Text>
                  </View>
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                      Items
                    </Text>
                    <Text style={[styles.summaryValue, { color: themeColors.textPrimary }]}>
                      {item.items?.length ?? 0} {(item.items?.length ?? 0) === 1 ? 'line' : 'lines'}
                    </Text>
                  </View>
                </View>
                {item.description ? (
                  <Text style={[styles.description, { color: themeColors.textSecondary }]}>
                    {item.description}
                  </Text>
                ) : null}
                {(item.items?.length ?? 0) > 0 ? (
                  <View style={[styles.itemLines, { borderTopColor: themeColors.border }]}>
                    {item.items.map((row, index) => (
                      <View
                        key={`${item.id}-${index}`}
                        style={[styles.itemLine, { borderBottomColor: themeColors.border }]}
                      >
                        <Text style={[styles.itemName, { color: themeColors.textPrimary }]}>
                          {row.item || 'Unnamed item'}
                        </Text>
                        <Text
                          style={[
                            styles.itemAmount,
                            {
                              color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary,
                            },
                          ]}
                        >
                          {row.amount || '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ButtonTagCard>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  searchRow: { marginBottom: SPACING.sm },
  searchInput: {},
  createRow: { marginBottom: SPACING.sm },
  uniformsButton: {
    minHeight: SIZES.buttonHeight,
    marginTop: SPACING.sm,
    borderWidth: 2,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  uniformsButtonText: { fontSize: FONTS.base, fontWeight: '600', letterSpacing: 0.2 },
  loader: { marginVertical: SPACING.xl },
  empty: { fontSize: FONTS.base, paddingVertical: SPACING.xl },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  listHeadingTitle: { fontSize: FONTS.base, fontWeight: '700' },
  recordCount: { fontSize: FONTS.sm },
  cardMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  departmentBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
  },
  departmentBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  cardMetaText: { fontSize: FONTS.xs },
  inventorySummary: {
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.sm,
  },
  summaryColumn: { flex: 1, minWidth: 0 },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  summaryValue: { fontSize: FONTS.sm, fontWeight: '600' },
  description: { fontSize: FONTS.sm, lineHeight: 20, marginTop: SPACING.md },
  itemLines: { marginTop: SPACING.md, borderTopWidth: 1 },
  itemLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  itemName: { flex: 1, fontSize: FONTS.sm },
  itemAmount: { fontSize: FONTS.sm, fontWeight: '700' },
});
