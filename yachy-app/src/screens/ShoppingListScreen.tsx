import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Shopping List Screen
 * Shows lists for a single category (General or Trip), with department filter
 * Navigate here from ShoppingListCategoryScreen with listType param
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import shoppingListsService, { ShoppingList, ShoppingListItem } from '../services/shoppingLists';
import { Department } from '../types';
import { Button, DepartmentMultiSelector, PageHeader, PreviewActionButtons } from '../components';
import {
  DEPARTMENT_OPTIONS as DEPARTMENTS,
  formatDepartmentLabel,
} from '../utils/departmentSelection';

const allDeptsVisible: Record<Department, boolean> = {
  BRIDGE: true,
  ENGINEERING: true,
  EXTERIOR: true,
  INTERIOR: true,
  GALLEY: true,
};

const TRIP_SHOPPING_INFO = {
  title: 'Trip Shopping',
  description: 'Keep recurring trip essentials separate from shopping needed for one trip.',
  features: [
    'Personalized Lists are reusable checklists of items your vessel needs before every trip',
    'Tick items as they are purchased, then reset the checks before the next trip',
    'Trip Shopping Lists are for one-off or department-specific purchases for a particular trip',
  ],
};

export const ShoppingListScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const listType = (route?.params?.listType as 'general' | 'trip') ?? 'general';

  const [lists, setLists] = useScreenState<ShoppingList[]>('lists', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] =
    useState<Record<Department, boolean>>(allDeptsVisible);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const listsRef = useRef<ShoppingList[]>(lists);
  const confirmedItemsRef = useRef(
    new Map<string, ShoppingListItem[]>(lists.map((list) => [list.id, list.items]))
  );
  const pendingItemsRef = useRef(new Map<string, ShoppingListItem[]>());
  const savingListIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const loadedVesselIdRef = useRef<string | null>(user?.vesselId ?? null);

  const vesselId = user?.vesselId ?? null;

  const masterLists = lists.filter((l) => (l.listType ?? 'general') === 'trip' && l.isMaster);
  const listsForType = lists.filter((l) => (l.listType ?? 'general') === listType && !l.isMaster);
  const filteredLists = listsForType.filter((l) => visibleDepartments[l.department ?? 'INTERIOR']);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const replaceLists = useCallback(
    (nextLists: ShoppingList[]) => {
      listsRef.current = nextLists;
      setLists(nextLists);
    },
    [setLists]
  );

  const updateListItemsLocally = useCallback(
    (listId: string, items: ShoppingListItem[]) => {
      const nextLists = listsRef.current.map((list) =>
        list.id === listId ? { ...list, items } : list
      );
      replaceLists(nextLists);
    },
    [replaceLists]
  );

  const loadLists = useCallback(async () => {
    if (!vesselId) return;
    if (loadedVesselIdRef.current !== vesselId) {
      loadedVesselIdRef.current = vesselId;
      replaceLists([]);
      setLoading(true);
    }
    try {
      const data = await shoppingListsService.getByVessel(vesselId);
      data.forEach((list) => confirmedItemsRef.current.set(list.id, list.items));
      replaceLists(data);
    } catch (e) {
      console.error('Load shopping lists error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [replaceLists, setLoading, vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadLists();
    }, [loadLists])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadLists();
  };

  const persistPendingItems = useCallback(
    async (listId: string) => {
      if (savingListIdsRef.current.has(listId)) return;
      savingListIdsRef.current.add(listId);

      try {
        while (pendingItemsRef.current.has(listId)) {
          const itemsToSave = pendingItemsRef.current.get(listId);
          pendingItemsRef.current.delete(listId);
          if (!itemsToSave) continue;

          try {
            const savedList = await shoppingListsService.update(listId, { items: itemsToSave });
            confirmedItemsRef.current.set(listId, savedList.items);
          } catch (error) {
            console.error('Save shopping item state error:', error);
            if (!pendingItemsRef.current.has(listId) && mountedRef.current) {
              const confirmedItems = confirmedItemsRef.current.get(listId);
              if (confirmedItems) updateListItemsLocally(listId, confirmedItems);
              Alert.alert(
                'Could not update shopping list',
                'Your last change was not saved. Please try again.'
              );
            }
          }
        }
      } finally {
        savingListIdsRef.current.delete(listId);
      }
    },
    [updateListItemsLocally]
  );

  const saveItemsInBackground = useCallback(
    (listId: string, items: ShoppingListItem[]) => {
      pendingItemsRef.current.set(listId, items);
      void persistPendingItems(listId);
    },
    [persistPendingItems]
  );

  const toggleItemChecked = (listId: string, itemIndex: number) => {
    const latestList = listsRef.current.find((list) => list.id === listId);
    if (!latestList || !latestList.items[itemIndex]) return;

    const nextItems = latestList.items.map((item, index) =>
      index === itemIndex ? { ...item, checked: !item.checked } : item
    );
    updateListItemsLocally(listId, nextItems);
    saveItemsInBackground(listId, nextItems);
  };

  const resetMasterChecks = (listId: string) => {
    const latestList = listsRef.current.find((list) => list.id === listId);
    if (!latestList) return;

    const nextItems = latestList.items.map((item) => ({ ...item, checked: false }));
    updateListItemsLocally(listId, nextItems);
    saveItemsInBackground(listId, nextItems);
  };

  const onCreate = () => {
    if (listType === 'trip') {
      navigation.navigate('AddEditShoppingList', {
        presetTitle: 'Trip Shopping',
        listType: 'trip',
      });
    } else {
      navigation.navigate('AddEditShoppingList', {});
    }
  };

  const onDelete = (list: ShoppingList) => {
    Alert.alert('Delete list', `Delete "${list.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await shoppingListsService.delete(list.id);
            loadLists();
          } catch {
            Alert.alert('Error', 'Could not delete list.');
          }
        },
      },
    ]);
  };

  const sectionTitle = listType === 'trip' ? 'Trip Shopping' : 'General Shopping';

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Shopping List.
        </Text>
      </View>
    );
  }

  const handleAddMasterList = () => {
    navigation.navigate('AddEditShoppingList', { listType: 'trip', asMasterList: true });
  };

  const renderMasterBoard = () => {
    if (listType !== 'trip') return null;
    return (
      <View style={styles.listGroup}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleBlock}>
            <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
              Personalized lists
            </Text>
            <Text style={[styles.sectionSubtitle, { color: themeColors.textSecondary }]}>
              Reusable before every trip
            </Text>
          </View>
          <Text style={[styles.sectionCount, { color: themeColors.textSecondary }]}>
            {masterLists.length} {masterLists.length === 1 ? 'list' : 'lists'}
          </Text>
        </View>
        <Button
          title="Create Personalized List"
          onPress={handleAddMasterList}
          variant={themeColors.isDark ? 'outlineLight' : 'outline'}
          fullWidth
          style={styles.secondaryAction}
        />
        {masterLists.map((masterList) => (
          <View
            key={masterList.id}
            style={[
              styles.card,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <TouchableOpacity
              style={styles.masterBoardHeader}
              onPress={() =>
                setExpandedListId((current) => (current === masterList.id ? null : masterList.id))
              }
              activeOpacity={0.8}
            >
              <View style={styles.expandableHeaderRow}>
                <View style={styles.cardTitleBlock}>
                  <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>
                    {masterList.title}
                  </Text>
                  <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>
                    {masterList.items.length}{' '}
                    {masterList.items.length === 1 ? 'reusable item' : 'reusable items'}
                  </Text>
                </View>
                <Ionicons
                  name={expandedListId === masterList.id ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={themeColors.accent}
                />
              </View>
            </TouchableOpacity>
            {expandedListId === masterList.id && (
              <>
                <TouchableOpacity
                  onPress={() => resetMasterChecks(masterList.id)}
                  style={styles.resetBtn}
                  disabled={!masterList.items.some((i) => i.checked)}
                >
                  <Text
                    style={[
                      styles.resetBtnText,
                      { color: themeColors.accent },
                      !masterList.items.some((i) => i.checked) && styles.resetBtnDisabled,
                    ]}
                  >
                    Reset checks for next trip
                  </Text>
                </TouchableOpacity>
                <View style={[styles.bulletList, { borderTopColor: themeColors.border }]}>
                  {masterList.items.length === 0 ? (
                    <Text style={[styles.bulletPlaceholder, { color: COLORS.textTertiary }]}>
                      No items yet. Tap "Edit" below to add items.
                    </Text>
                  ) : (
                    masterList.items.map((item, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.bulletRow}
                        onPress={() => toggleItemChecked(masterList.id, idx)}
                        activeOpacity={0.7}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: item.checked }}
                        accessibilityLabel={
                          item.amount ? `${item.amount} x ${item.text}` : item.text
                        }
                      >
                        <View
                          style={[
                            styles.checkbox,
                            {
                              borderColor: item.checked
                                ? themeColors.controlSelected
                                : themeColors.borderStrong,
                              backgroundColor: item.checked
                                ? themeColors.controlSelected
                                : themeColors.control,
                            },
                          ]}
                        >
                          {item.checked ? (
                            <Ionicons name="checkmark" size={15} color={themeColors.textOnAccent} />
                          ) : null}
                        </View>
                        <Text
                          style={[
                            styles.bulletText,
                            { color: themeColors.textPrimary },
                            item.checked && styles.bulletTextChecked,
                          ]}
                          numberOfLines={2}
                        >
                          {item.amount ? `${item.amount} x ${item.text}` : item.text}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
                <PreviewActionButtons
                  onEdit={() =>
                    navigation.navigate('AddEditShoppingList', { listId: masterList.id })
                  }
                  onDelete={() => onDelete(masterList)}
                />
              </>
            )}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title={listType === 'trip' ? 'Trip Shopping' : 'General Shopping'}
        info={listType === 'trip' ? TRIP_SHOPPING_INFO : undefined}
        infoScreenKey={listType === 'trip' ? 'trip_shopping' : undefined}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={themeColors.accent}
            colors={[themeColors.controlSelected]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Button
          title={`Create ${sectionTitle} List`}
          onPress={onCreate}
          variant="primary"
          fullWidth
          style={styles.primaryAction}
        />
        <DepartmentMultiSelector
          value={DEPARTMENTS.filter((department) => visibleDepartments[department])}
          onChange={(departments) =>
            setVisibleDepartments(
              DEPARTMENTS.reduce(
                (next, department) => ({
                  ...next,
                  [department]: departments.includes(department),
                }),
                {} as Record<Department, boolean>
              )
            )
          }
          includeAll
          minSelections={1}
          tightTop
        />
        {renderMasterBoard()}
        <View style={styles.listGroup}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
              {listType === 'trip' ? 'Trip shopping lists' : 'Shopping lists'}
            </Text>
            <Text style={[styles.sectionCount, { color: themeColors.textSecondary }]}>
              {filteredLists.length} {filteredLists.length === 1 ? 'list' : 'lists'}
            </Text>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={themeColors.accent} style={styles.loader} />
          ) : filteredLists.length === 0 ? (
            <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
              {listsForType.length === 0
                ? `No ${sectionTitle.toLowerCase()} lists yet. Tap Create ${sectionTitle} List to add one.`
                : 'No lists for the selected department(s).'}
            </Text>
          ) : (
            filteredLists.map((list) => {
              const dept = list.department ?? 'INTERIOR';
              return (
                <View
                  key={list.id}
                  style={[
                    styles.card,
                    { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.cardHeader}
                    onPress={() =>
                      setExpandedListId((current) => (current === list.id ? null : list.id))
                    }
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardTitleBlock}>
                      <View style={styles.cardTitleRow}>
                        <Text
                          style={[styles.cardTitle, { color: themeColors.textPrimary }]}
                          numberOfLines={1}
                        >
                          {list.title}
                        </Text>
                        <View
                          style={[
                            styles.deptBadge,
                            { backgroundColor: getDepartmentColor(dept, overrides) },
                          ]}
                        >
                          <Text style={styles.deptBadgeText}>{formatDepartmentLabel(dept)}</Text>
                        </View>
                      </View>
                      <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>
                        {list.items.length} {list.items.length === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                    <Ionicons
                      name={expandedListId === list.id ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={themeColors.accent}
                    />
                  </TouchableOpacity>
                  {expandedListId === list.id && (
                    <>
                      <View style={[styles.bulletList, { borderTopColor: themeColors.border }]}>
                        {list.items.length === 0 ? (
                          <Text style={[styles.bulletPlaceholder, { color: COLORS.textTertiary }]}>
                            No items
                          </Text>
                        ) : (
                          list.items.map((item, idx) => (
                            <TouchableOpacity
                              key={idx}
                              style={styles.bulletRow}
                              onPress={() => toggleItemChecked(list.id, idx)}
                              activeOpacity={0.7}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: item.checked }}
                              accessibilityLabel={
                                item.amount ? `${item.amount} x ${item.text}` : item.text
                              }
                            >
                              <View
                                style={[
                                  styles.checkbox,
                                  {
                                    borderColor: item.checked
                                      ? themeColors.controlSelected
                                      : themeColors.borderStrong,
                                    backgroundColor: item.checked
                                      ? themeColors.controlSelected
                                      : themeColors.control,
                                  },
                                ]}
                              >
                                {item.checked ? (
                                  <Ionicons
                                    name="checkmark"
                                    size={15}
                                    color={themeColors.textOnAccent}
                                  />
                                ) : null}
                              </View>
                              <Text
                                style={[
                                  styles.bulletText,
                                  { color: themeColors.textPrimary },
                                  item.checked && styles.bulletTextChecked,
                                ]}
                                numberOfLines={2}
                              >
                                {item.amount ? `${item.amount} x ${item.text}` : item.text}
                              </Text>
                            </TouchableOpacity>
                          ))
                        )}
                      </View>
                      <PreviewActionButtons
                        onEdit={() =>
                          navigation.navigate('AddEditShoppingList', { listId: list.id })
                        }
                        onDelete={() => onDelete(list)}
                      />
                    </>
                  )}
                </View>
              );
            })
          )}
        </View>
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
  primaryAction: { marginBottom: SPACING.md },
  secondaryAction: { marginBottom: SPACING.md },
  listGroup: { marginTop: SPACING.md, marginBottom: SPACING.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  sectionTitleBlock: { flex: 1 },
  sectionTitle: { fontSize: FONTS.lg, fontWeight: '700' },
  sectionSubtitle: { fontSize: FONTS.sm, marginTop: 2 },
  sectionCount: { fontSize: FONTS.xs, marginTop: 3 },
  loader: { marginVertical: SPACING.xl },
  empty: { fontSize: FONTS.base, paddingVertical: SPACING.xl },
  masterBoardHeader: {},
  resetBtn: { alignSelf: 'flex-start', paddingVertical: SPACING.sm },
  resetBtnText: { fontSize: FONTS.sm, fontWeight: '600' },
  resetBtnDisabled: { color: COLORS.textTertiary },
  expandableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  cardTitleBlock: { flex: 1, minWidth: 0 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flexShrink: 1 },
  cardSubtitle: { fontSize: FONTS.sm, marginTop: SPACING.xs },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  bulletList: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
  },
  bulletRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    marginRight: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bulletText: { fontSize: FONTS.base, flex: 1 },
  bulletTextChecked: { textDecorationLine: 'line-through', color: COLORS.textTertiary },
  bulletPlaceholder: { fontSize: FONTS.sm, fontStyle: 'italic' },
});
