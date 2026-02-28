/**
 * Add / Edit Shopping List Screen
 * Title, department (on create), bullet-point list of items
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import shoppingListsService, { ShoppingList, ShoppingListItem, ShoppingListType } from '../services/shoppingLists';
import { Department } from '../types';
import { Input, Button } from '../components';

export const AddEditShoppingListScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const listId = route?.params?.listId as string | undefined;
  const presetTitle = route?.params?.presetTitle as string | undefined;
  const listType = (route?.params?.listType as ShoppingListType) ?? 'general';
  const isEdit = !!listId;

  const [title, setTitle] = useState(presetTitle ?? '');
  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [items, setItems] = useState<ShoppingListItem[]>([{ text: '', checked: false }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isMaster, setIsMaster] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const loadList = useCallback(async () => {
    if (!listId) {
      setLoading(false);
      return;
    }
    try {
      const lists = await shoppingListsService.getByVessel(vesselId!);
      const list = lists.find((l) => l.id === listId);
      if (list) {
        setTitle(list.title);
        setDepartment(list.department);
        setItems(list.items.length > 0 ? list.items : [{ text: '', checked: false }]);
        setIsMaster(!!list.isMaster);
      } else {
        Alert.alert('Error', 'Shopping list not found.');
        navigation.goBack();
      }
    } catch (e) {
      console.error('Load shopping list error:', e);
      Alert.alert('Error', 'Could not load list.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [listId, vesselId, navigation]);

  useFocusEffect(useCallback(() => {
    loadList();
  }, [loadList]));

  useEffect(() => {
    if (!isEdit && presetTitle) {
      setTitle(presetTitle);
    }
  }, [isEdit, presetTitle]);

  const addItem = () => setItems((prev) => [...prev, { text: '', checked: false }]);
  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };
  const setItemAt = (index: number, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], text: value };
      return next;
    });
  };
  const toggleChecked = (index: number) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], checked: !next[index].checked };
      return next;
    });
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('Missing title', 'Please enter a title for the shopping list.');
      return;
    }
    const trimmedItems: ShoppingListItem[] = items
      .map((item) => ({ text: item.text.trim(), checked: item.checked }))
      .filter((item) => item.text.length > 0);
    if (!vesselId) return;
    setSaving(true);
    try {
      if (isEdit) {
        await shoppingListsService.update(listId, { title: trimmedTitle, items: trimmedItems });
        Alert.alert('Saved', 'Shopping list updated.');
      } else {
        await shoppingListsService.create({
          vesselId,
          department,
          listType,
          title: trimmedTitle,
          items: trimmedItems,
          createdBy: user?.id,
        });
        Alert.alert('Created', 'Shopping list added.');
      }
      navigation.goBack();
    } catch (e) {
      console.error('Save shopping list error:', e);
      Alert.alert('Error', 'Could not save shopping list.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (isMaster || !listId) return;
    Alert.alert('Delete list', `Delete "${title.trim()}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await shoppingListsService.delete(listId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete list.');
          }
        },
      },
    ]);
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to create shopping lists.</Text>
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Galley weekly shop"
          autoCapitalize="words"
        />
        {!isEdit && (
          <View style={styles.deptDisplay}>
            <Text style={[styles.deptLabel, { color: themeColors.textSecondary }]}>Department</Text>
            <View
              style={[
                styles.deptBadge,
                { backgroundColor: getDepartmentColor(department, overrides) },
              ]}
            >
              <Text style={styles.deptBadgeText}>
                {department.charAt(0) + department.slice(1).toLowerCase()}
              </Text>
            </View>
          </View>
        )}

        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Items</Text>
        {items.map((item, index) => (
          <View key={index} style={styles.itemRow}>
            <TouchableOpacity
              onPress={() => toggleChecked(index)}
              style={[styles.checkbox, item.checked && styles.checkboxChecked]}
              activeOpacity={0.7}
            >
              {item.checked ? (
                <Text style={styles.checkboxTick}>✓</Text>
              ) : null}
            </TouchableOpacity>
            <TextInput
              style={[styles.itemInput, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }, item.checked && styles.itemInputChecked]}
              value={item.text}
              onChangeText={(v) => setItemAt(index, v)}
              placeholder="Item"
              placeholderTextColor={COLORS.textTertiary}
            />
            <TouchableOpacity
              onPress={() => removeItem(index)}
              style={styles.removeBtn}
              disabled={items.length <= 1}
            >
              <Text style={[styles.removeBtnText, items.length <= 1 && styles.removeBtnDisabled]}>
                Remove
              </Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={addItem} style={styles.addItemBtn}>
          <Text style={styles.addItemBtnText}>+ Add item</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save changes' : 'Create list'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          {isEdit && !isMaster && (
            <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs, marginTop: SPACING.md },
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
  deptDisplay: { marginBottom: SPACING.lg },
  deptLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  deptBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
  },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  checkbox: {
    width: 24,
    height: 24,
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
  checkboxTick: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  itemInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.base,
  },
  itemInputChecked: { textDecorationLine: 'line-through', color: COLORS.textTertiary },
  addItemBtn: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, marginTop: SPACING.xs },
  addItemBtnText: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.primary },
  removeBtn: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, marginLeft: SPACING.xs },
  removeBtnText: { fontSize: FONTS.sm, color: COLORS.danger },
  removeBtnDisabled: { color: COLORS.textTertiary },
  actions: { marginTop: SPACING.xl },
  deleteBtn: { marginTop: SPACING.md, alignItems: 'center', paddingVertical: SPACING.sm },
  deleteBtnText: { fontSize: FONTS.sm, color: COLORS.danger, fontWeight: '600' },
});
