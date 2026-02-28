/**
 * Shopping List Screen
 * Shows lists for a single category (General or Trip), with department filter
 * Navigate here from ShoppingListCategoryScreen with listType param
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
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import shoppingListsService, { ShoppingList, ShoppingListItem } from '../services/shoppingLists';
import { Department } from '../types';
import { Button } from '../components';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

const allDeptsVisible: Record<Department, boolean> = {
  BRIDGE: true,
  ENGINEERING: true,
  EXTERIOR: true,
  INTERIOR: true,
  GALLEY: true,
};

export const ShoppingListScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const listType = (route?.params?.listType as 'general' | 'trip') ?? 'general';

  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>(allDeptsVisible);
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const selectDepartment = (dept: Department) => {
    setVisibleDepartments({
      BRIDGE: dept === 'BRIDGE',
      ENGINEERING: dept === 'ENGINEERING',
      EXTERIOR: dept === 'EXTERIOR',
      INTERIOR: dept === 'INTERIOR',
      GALLEY: dept === 'GALLEY',
    });
  };

  const selectAllDepartments = () => setVisibleDepartments(allDeptsVisible);

  const masterList = lists.find((l) => (l.listType ?? 'general') === 'trip' && l.isMaster);
  const listsForType = lists.filter((l) => (l.listType ?? 'general') === listType && !l.isMaster);
  const filteredLists = listsForType.filter((l) => visibleDepartments[l.department ?? 'INTERIOR']);

  const loadLists = useCallback(async () => {
    if (!vesselId) return;
    setLoading(true);
    try {
      let data = await shoppingListsService.getByVessel(vesselId);
      if (listType === 'trip') {
        const master = await shoppingListsService.getOrCreateMasterTripList(vesselId, user?.id);
        if (!data.some((l) => l.id === master.id)) {
          data = [master, ...data];
        } else {
          data = data.map((l) => (l.id === master.id ? { ...l, isMaster: true } : l));
        }
      }
      setLists(data);
    } catch (e) {
      console.error('Load shopping lists error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId, listType, user?.id]);

  useFocusEffect(useCallback(() => {
    loadLists();
  }, [loadLists]));

  const onRefresh = () => {
    setRefreshing(true);
    loadLists();
  };

  const toggleItemChecked = async (list: ShoppingList, itemIndex: number) => {
    const newItems: ShoppingListItem[] = list.items.map((item, idx) =>
      idx === itemIndex ? { ...item, checked: !item.checked } : item
    );
    try {
      await shoppingListsService.update(list.id, { items: newItems });
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, items: newItems } : l))
      );
    } catch (e) {
      console.error('Toggle item error:', e);
    }
  };

  const resetMasterChecks = async (list: ShoppingList) => {
    const newItems: ShoppingListItem[] = list.items.map((item) => ({ ...item, checked: false }));
    try {
      await shoppingListsService.update(list.id, { items: newItems });
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, items: newItems } : l))
      );
    } catch (e) {
      console.error('Reset checks error:', e);
    }
  };

  const onCreate = () => {
    if (listType === 'trip') {
      navigation.navigate('AddEditShoppingList', { presetTitle: 'Trip Shopping', listType: 'trip' });
    } else {
      navigation.navigate('AddEditShoppingList', {});
    }
  };

  const onDelete = (list: ShoppingList) => {
    if (list.isMaster) return;
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

  const getDepartmentDisplayText = () =>
    DEPARTMENTS.every((d) => visibleDepartments[d])
      ? 'All departments'
      : DEPARTMENTS.filter((d) => visibleDepartments[d])
          .map((d) => d.charAt(0) + d.slice(1).toLowerCase())
          .join(', ');

  const sectionTitle = listType === 'trip' ? 'Trip Shopping' : 'General Shopping';

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Shopping List.</Text>
      </View>
    );
  }

  const renderMasterBoard = () => {
    if (listType !== 'trip' || !masterList) return null;
    return (
      <View style={styles.masterBoard}>
        <View style={styles.masterBoardHeader}>
          <Text style={[styles.masterBoardTitle, { color: themeColors.textPrimary }]}>Every Trip</Text>
          <Text style={[styles.masterBoardSubtitle, { color: themeColors.textSecondary }]}>Items you need before every trip</Text>
          <TouchableOpacity
            onPress={() => resetMasterChecks(masterList)}
            style={styles.resetBtn}
            disabled={!masterList.items.some((i) => i.checked)}
          >
            <Text
              style={[
                styles.resetBtnText,
                !masterList.items.some((i) => i.checked) && styles.resetBtnDisabled,
              ]}
            >
              Reset checks for next trip
            </Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.masterCard, { backgroundColor: themeColors.surface }]}>
          <View style={styles.bulletList}>
            {masterList.items.length === 0 ? (
              <Text style={[styles.bulletPlaceholder, { color: COLORS.textTertiary }]}>No items yet. Tap "Edit items" below to add items.</Text>
            ) : (
              masterList.items.map((item, idx) => (
                <View key={idx} style={styles.bulletRow}>
                  <TouchableOpacity
                    onPress={() => toggleItemChecked(masterList, idx)}
                    style={[styles.checkbox, item.checked && styles.checkboxChecked]}
                    activeOpacity={0.7}
                  >
                    {item.checked ? (
                      <Text style={styles.checkboxTick}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                  <Text
                    style={[styles.bulletText, { color: themeColors.textPrimary }, item.checked && styles.bulletTextChecked]}
                    numberOfLines={2}
                  >
                    {item.text}
                  </Text>
                </View>
              ))
            )}
          </View>
          <Button
            title="Edit items"
            onPress={() => navigation.navigate('AddEditShoppingList', { listId: masterList.id })}
            variant="text"
            size="small"
            style={styles.editBtnMaster}
          />
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
      }
    >
      {renderMasterBoard()}
      <View style={styles.section}>
        <Button
          title={`Create ${sectionTitle} List`}
          onPress={onCreate}
          variant="primary"
          fullWidth
        />
        <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
          <TouchableOpacity
            style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
            onPress={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
            activeOpacity={0.7}
          >
            <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>{getDepartmentDisplayText()}</Text>
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
          ) : filteredLists.length === 0 ? (
            <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
              {listsForType.length === 0
                ? `No ${sectionTitle.toLowerCase()} lists yet. Tap Create to add one.`
                : 'No lists for the selected department(s).'}
            </Text>
          ) : (
            filteredLists.map((list) => (
          <View key={list.id} style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleBlock}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('AddEditShoppingList', { listId: list.id })}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
                    {list.title}
                  </Text>
                </TouchableOpacity>
                <View
                  style={[
                    styles.deptBadge,
                    { backgroundColor: getDepartmentColor(list.department, overrides) },
                  ]}
                >
                  <Text style={styles.deptBadgeText}>
                    {list.department.charAt(0) + list.department.slice(1).toLowerCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => onDelete(list)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
                <Button
                  title="Edit"
                  onPress={() => navigation.navigate('AddEditShoppingList', { listId: list.id })}
                  variant="text"
                  size="small"
                />
              </View>
            </View>
            <View style={styles.bulletList}>
              {list.items.length === 0 ? (
                <Text style={[styles.bulletPlaceholder, { color: COLORS.textTertiary }]}>No items</Text>
              ) : (
                list.items.map((item, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <TouchableOpacity
                      onPress={() => toggleItemChecked(list, idx)}
                      style={[styles.checkbox, item.checked && styles.checkboxChecked]}
                      activeOpacity={0.7}
                    >
                      {item.checked ? (
                        <Text style={styles.checkboxTick}>✓</Text>
                      ) : null}
                    </TouchableOpacity>
                    <Text
                      style={[
                        styles.bulletText,
                        { color: themeColors.textPrimary },
                        item.checked && styles.bulletTextChecked,
                      ]}
                      numberOfLines={2}
                    >
                      {item.text}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        ))
      )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  section: { marginBottom: SPACING.lg },
  filterLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginTop: SPACING.lg,
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
  masterBoard: { marginBottom: SPACING.xl },
  masterBoardHeader: { marginBottom: SPACING.sm },
  masterBoardTitle: { fontSize: FONTS.xl, fontWeight: '700' },
  masterBoardSubtitle: { fontSize: FONTS.sm, marginTop: 2 },
  resetBtn: { marginTop: SPACING.sm },
  resetBtnText: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.primary },
  resetBtnDisabled: { color: COLORS.textTertiary },
  editBtnMaster: { marginTop: SPACING.sm, alignSelf: 'flex-start' },
  masterCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 2,
    borderColor: COLORS.primaryLight,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SPACING.sm },
  cardTitleBlock: { flex: 1 },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  deleteBtn: { fontSize: FONTS.sm, color: COLORS.danger, fontWeight: '600' },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    marginTop: SPACING.xs,
    alignSelf: 'flex-start',
  },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  bulletList: { marginTop: SPACING.xs },
  bulletRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xs },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  checkboxTick: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  bulletText: { fontSize: FONTS.base, flex: 1 },
  bulletTextChecked: { textDecorationLine: 'line-through', color: COLORS.textTertiary },
  bulletPlaceholder: { fontSize: FONTS.sm, fontStyle: 'italic' },
});
