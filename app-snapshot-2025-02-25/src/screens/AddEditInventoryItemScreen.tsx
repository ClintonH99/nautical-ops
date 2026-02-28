/**
 * Add / Edit Inventory Item Screen
 * Department selector, Title, Location, Description, Amount | Item table
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import inventoryService, { InventoryItemRow } from '../services/inventory';
import { Department } from '../types';
import { Input, Button } from '../components';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

const defaultRow: InventoryItemRow = { amount: '', item: '' };

export const AddEditInventoryItemScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const itemId = route?.params?.itemId as string | undefined;
  const isEdit = !!itemId;

  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<InventoryItemRow[]>([{ ...defaultRow }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const loadItem = useCallback(async () => {
    if (!itemId) {
      setLoading(false);
      return;
    }
    try {
      const item = await inventoryService.getById(itemId);
      if (item) {
        setDepartment(item.department);
        setTitle(item.title);
        setLocation(item.location || '');
        setDescription(item.description || '');
        setRows(item.items?.length ? item.items : [{ ...defaultRow }]);
      } else {
        Alert.alert('Error', 'Item not found.');
        navigation.goBack();
      }
    } catch (e) {
      console.error('Load inventory item error:', e);
      Alert.alert('Error', 'Could not load item.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [itemId, navigation]);

  useFocusEffect(useCallback(() => { loadItem(); }, [loadItem]));

  const addRow = () => setRows((prev) => [...prev, { ...defaultRow }]);
  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };
  const setRowAt = (index: number, field: 'amount' | 'item', value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('Missing title', 'Please enter a title.');
      return;
    }
    if (!vesselId) {
      Alert.alert('Error', 'Join a vessel to create inventory items.');
      return;
    }
    setSaving(true);
    try {
      const items = rows
        .filter((row) => row.amount.trim() || row.item.trim())
        .map((row) => ({ amount: row.amount.trim(), item: row.item.trim() }));
      const userName = user?.name ?? '';
      if (isEdit && itemId) {
        await inventoryService.update(itemId, {
          title: trimmedTitle,
          description: description.trim(),
          location: location.trim(),
          department,
          items,
          lastEditedByName: userName,
        });
        Alert.alert('Saved', 'Inventory item updated.');
      } else {
        await inventoryService.create({
          vesselId,
          department,
          title: trimmedTitle,
          description: description.trim(),
          location: location.trim(),
          items,
          lastEditedByName: userName,
        });
        Alert.alert('Created', 'Inventory item added.');
      }
      navigation.goBack();
    } catch (e) {
      console.error('Save inventory item error:', e);
      Alert.alert('Error', 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to create inventory items.</Text>
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
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Department</Text>
        <Text style={[styles.hint, { color: themeColors.textSecondary }]}>Which department is this for?</Text>
        <View style={styles.deptRow}>
          {DEPARTMENTS.map((dept) => (
            <TouchableOpacity
              key={dept}
                style={[
                  styles.chip,
                  { borderColor: getDepartmentColor(dept, overrides) },
                  department === dept && styles.chipSelected,
                  department === dept && { backgroundColor: getDepartmentColor(dept, overrides) },
                ]}
              onPress={() => setDepartment(dept)}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: department === dept ? COLORS.textInverse : themeColors.textPrimary },
                  department === dept && styles.chipTextSelected,
                ]}
                numberOfLines={1}
              >
                {dept.charAt(0) + dept.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Engine spares"
          autoCapitalize="words"
        />
        <Input
          label="Location"
          value={location}
          onChangeText={setLocation}
          placeholder="e.g. Starboard locker"
          autoCapitalize="words"
        />
        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Optional description"
          multiline
          numberOfLines={3}
          style={styles.descriptionInput}
        />

        <Text style={[styles.tableLabel, { color: themeColors.textSecondary }]}>Amount & Item</Text>
        <View style={[styles.table, { backgroundColor: themeColors.surface }]}>
          <View style={[styles.tableHeader, { backgroundColor: themeColors.surfaceAlt }]}>
            <Text style={[styles.tableHeaderCell, styles.amountCol, { color: themeColors.textPrimary }]}>Amount</Text>
            <Text style={[styles.tableHeaderCell, styles.itemCol, { color: themeColors.textPrimary }]}>Item</Text>
            <View style={styles.actionsCol} />
          </View>
          {rows.map((row, index) => (
            <View key={index} style={styles.tableRow}>
              <TextInput
                style={[styles.tableInput, styles.amountCol, { color: themeColors.textPrimary, backgroundColor: themeColors.surface }]}
                value={row.amount}
                onChangeText={(v) => setRowAt(index, 'amount', v)}
                placeholder="Amount"
                placeholderTextColor={COLORS.gray400}
              />
              <TextInput
                style={[styles.tableInput, styles.itemCol, { color: themeColors.textPrimary, backgroundColor: themeColors.surface }]}
                value={row.item}
                onChangeText={(v) => setRowAt(index, 'item', v)}
                placeholder="Item"
                placeholderTextColor={COLORS.gray400}
              />
              <TouchableOpacity
                onPress={() => removeRow(index)}
                style={styles.removeBtn}
                disabled={rows.length <= 1}
              >
                <Text
                  style={[
                    styles.removeBtnText,
                    rows.length <= 1 && styles.removeBtnDisabled,
                  ]}
                >
                  Remove
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <TouchableOpacity onPress={addRow} style={styles.addRowBtn}>
          <Text style={styles.addRowBtnText}>+ Add New</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save changes' : 'Create'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          {isEdit && (
            <Button
              title="Remove item"
              onPress={() => {
                Alert.alert(
                  'Remove item',
                  'Remove this inventory item?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: async () => {
                        if (!itemId) return;
                        setSaving(true);
                        try {
                          await inventoryService.delete(itemId);
                          Alert.alert('Removed', 'Item has been removed.');
                          navigation.goBack();
                        } catch (e) {
                          console.error('Delete inventory item error:', e);
                          Alert.alert('Error', 'Could not remove item.');
                        } finally {
                          setSaving(false);
                        }
                      },
                    },
                  ]
                );
              }}
              variant="danger"
              fullWidth
              style={styles.deleteBtn}
              disabled={saving}
            />
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: { fontSize: FONTS.base, fontFamily: FONTS.regular },
  label: { fontSize: FONTS.sm, fontFamily: FONTS.medium, marginBottom: SPACING.xs },
  hint: { fontSize: FONTS.xs, fontFamily: FONTS.regular, marginBottom: SPACING.sm },
  deptRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACING.lg },
  chip: {
    marginRight: SPACING.sm,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
  },
  chipSelected: { borderWidth: 2 },
  chipText: { fontSize: FONTS.sm, fontFamily: FONTS.medium },
  chipTextSelected: { color: COLORS.textInverse },
  descriptionInput: { minHeight: 80, textAlignVertical: 'top' as const },
  tableLabel: {
    fontSize: FONTS.sm,
    fontFamily: FONTS.medium,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  table: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableHeaderCell: { fontSize: FONTS.sm, fontFamily: FONTS.bold },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  tableInput: {
    flex: 1,
    height: SIZES.inputHeight,
    fontSize: FONTS.base,
    fontFamily: FONTS.regular,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  amountCol: { width: 90, minWidth: 90, flex: 0 },
  itemCol: { flex: 1, marginLeft: SPACING.sm },
  actionsCol: { width: 70, minWidth: 70 },
  removeBtn: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, marginLeft: SPACING.sm },
  removeBtnText: { fontSize: FONTS.xs, fontFamily: FONTS.medium, color: COLORS.primary },
  removeBtnDisabled: { color: COLORS.gray400 },
  addRowBtn: { marginTop: SPACING.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  addRowBtnText: { fontSize: FONTS.base, fontFamily: FONTS.medium, color: COLORS.primary },
  actions: { marginTop: SPACING.xl },
  deleteBtn: { marginTop: SPACING.md },
});
