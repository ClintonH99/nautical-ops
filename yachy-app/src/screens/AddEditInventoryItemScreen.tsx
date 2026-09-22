/**
 * Add / Edit Inventory Item Screen
 * Department selector, Title, Location, Description, Amount | Item table
 */

import React, { useState, useCallback, useRef } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import inventoryService, { InventoryItemRow } from '../services/inventory';
import { Department } from '../types';
import {
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  DepartmentSelector,
  EnterToAddHint,
} from '../components';

const defaultRow: InventoryItemRow = { amount: '', item: '' };

export const AddEditInventoryItemScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
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

  useFocusEffect(
    useCallback(() => {
      loadItem();
    }, [loadItem])
  );

  const amountInputRefs = useRef<Array<TextInput | null>>([]);
  const itemInputRefs = useRef<Array<TextInput | null>>([]);

  const addRow = () => {
    const newIndex = rows.length;
    setRows((prev) => [...prev, { ...defaultRow }]);
    setTimeout(() => amountInputRefs.current[newIndex]?.focus(), 50);
  };
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to create inventory items.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title={isEdit ? 'Edit Inventory Item' : 'Create Inventory Item'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Inventory Details
          </Text>
          <DepartmentSelector
            value={department}
            onChange={(value) => value && setDepartment(value)}
            layout="stacked"
            tightTop
          />
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Deck Supplies"
            autoCapitalize="words"
          />
          <Input
            label="Location"
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Bosun Locker"
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
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Inventory Items
          </Text>
          {rows.map((row, index) => (
            <View
              key={index}
              style={[
                styles.itemCard,
                { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border },
              ]}
            >
              <View style={styles.itemCardHeader}>
                <Text
                  style={[
                    styles.itemCardTitle,
                    { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
                  ]}
                >
                  Item {index + 1}
                </Text>
                <TouchableOpacity
                  onPress={() => removeRow(index)}
                  style={[
                    styles.removeBtn,
                    { borderColor: rows.length <= 1 ? themeColors.textMuted : COLORS.danger },
                  ]}
                  disabled={rows.length <= 1}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete item ${index + 1}`}
                >
                  <Ionicons
                    name="trash-outline"
                    size={17}
                    color={rows.length <= 1 ? themeColors.textMuted : COLORS.danger}
                  />
                  <Text
                    style={[
                      styles.removeBtnText,
                      { color: rows.length <= 1 ? themeColors.textMuted : COLORS.danger },
                    ]}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.itemFieldsRow}>
                <View style={styles.quantityField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Qty</Text>
                  <TextInput
                    ref={(el) => {
                      amountInputRefs.current[index] = el;
                    }}
                    style={[
                      styles.itemInput,
                      styles.quantityInput,
                      {
                        color: themeColors.textPrimary,
                        backgroundColor: themeColors.control,
                        borderColor: themeColors.border,
                      },
                    ]}
                    value={row.amount}
                    onChangeText={(v) => setRowAt(index, 'amount', v)}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    placeholderTextColor={themeColors.textSecondary}
                    returnKeyType="default"
                    submitBehavior="submit"
                    onSubmitEditing={() => itemInputRefs.current[index]?.focus()}
                  />
                </View>
                <View style={styles.itemField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>
                    Item
                  </Text>
                  <TextInput
                    ref={(el) => {
                      itemInputRefs.current[index] = el;
                    }}
                    style={[
                      styles.itemInput,
                      {
                        color: themeColors.textPrimary,
                        backgroundColor: themeColors.control,
                        borderColor: themeColors.border,
                      },
                    ]}
                    value={row.item}
                    onChangeText={(v) => setRowAt(index, 'item', v)}
                    placeholder="Inventory item"
                    placeholderTextColor={themeColors.textSecondary}
                    returnKeyType="default"
                    submitBehavior="submit"
                    onSubmitEditing={() => {
                      if (index === rows.length - 1) addRow();
                      else amountInputRefs.current[index + 1]?.focus();
                    }}
                  />
                </View>
              </View>
            </View>
          ))}
          <EnterToAddHint style={styles.enterHint} />
        </View>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Create Inventory Item'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          {isEdit && (
            <Button
              title="Delete Inventory Item"
              onPress={() => {
                Alert.alert('Delete Inventory Item', 'Delete this inventory item?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      if (!itemId) return;
                      setSaving(true);
                      try {
                        await inventoryService.delete(itemId);
                        Alert.alert('Deleted', 'Inventory item deleted.');
                        navigation.goBack();
                      } catch (e) {
                        console.error('Delete inventory item error:', e);
                        Alert.alert('Error', 'Could not remove item.');
                      } finally {
                        setSaving(false);
                      }
                    },
                  },
                ]);
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
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.md },
  descriptionInput: { minHeight: 80, textAlignVertical: 'top' as const },
  itemCard: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  itemCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  itemCardTitle: { fontSize: FONTS.sm, fontWeight: '700' },
  itemFieldsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
  },
  quantityField: { width: 72 },
  itemField: { flex: 1, minWidth: 0 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  itemInput: {
    flex: 1,
    minHeight: 48,
    fontSize: FONTS.base,
    fontFamily: FONTS.regular,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
  },
  quantityInput: { textAlign: 'center', fontWeight: '700' },
  removeBtn: {
    minHeight: 38,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  removeBtnText: { fontSize: FONTS.xs, fontWeight: '600' },
  enterHint: { marginTop: 0, marginBottom: 0 },
  actions: { marginTop: SPACING.sm },
  deleteBtn: { marginTop: SPACING.md },
});
