import { ScreenLoading } from '../components/ScreenLoading';
/**
 * Add / Edit Inventory Item Screen
 * Department selector, Title, Location, Description, Amount | Item table
 */

import React, { useState, useEffect, useRef } from 'react';
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
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import inventoryService, { InventoryItemRow } from '../services/inventory';
import { Department } from '../types';
import { Input, Button, PageHeader, DepartmentSelector, EnterToAddHint } from '../components';
import { useInventoryAutoSave } from '../hooks/useInventoryAutoSave';
import { InventoryAutoSaveControl } from '../components/InventoryAutoSaveControl';
import type { InventoryValues } from '../utils/inventoryAutoSaveQueue';

const defaultRow: InventoryItemRow = { amount: '', item: '' };

export const AddEditInventoryItemScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const itemId = route?.params?.itemId as string | undefined;
  const { queue, state } = useInventoryAutoSave();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const vesselId = user?.vesselId ?? null;
  const defaultDepartment = user?.department ?? 'INTERIOR';
  const entry = editingId ? state.entries[editingId] : undefined;
  const values: InventoryValues = entry?.values ?? {
    department: defaultDepartment,
    title: '',
    location: '',
    description: '',
    items: [{ ...defaultRow }],
  };
  const { department, title, location, description } = values;
  const rows = values.items.length ? values.items : [{ ...defaultRow }];
  const isEdit = !!itemId || !!entry?.base;

  useEffect(() => {
    if (!state.ready || !vesselId) return;
    let active = true;
    let openedId: string | undefined;
    setLoading(true);
    void (async () => {
      try {
        const id = itemId ?? queue.getSnapshot().newItemId ?? Crypto.randomUUID();
        const pending = queue.getSnapshot().entries[id];
        if (
          pending &&
          !pending.deleting &&
          (pending.version !== pending.savedVersion || pending.attempt || !itemId)
        ) {
          openedId = id;
        } else if (itemId) {
          const item = await inventoryService.getFreshById(itemId, vesselId);
          if (!active) return;
          if (!item) throw new Error('Inventory item not found.');
          queue.open(
            id,
            { ...item, items: item.items.length ? item.items : [{ ...defaultRow }] },
            item
          );
          openedId = id;
        } else {
          queue.open(
            id,
            {
              department: defaultDepartment,
              title: '',
              location: '',
              description: '',
              items: [{ ...defaultRow }],
            },
            null,
            true
          );
          openedId = id;
        }
        if (active) setEditingId(id);
      } catch {
        if (active) {
          Alert.alert('Error', 'Could not load inventory item.');
          navigation.goBack();
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (openedId) void queue.leave(openedId);
    };
  }, [queue, state.ready, itemId, vesselId, defaultDepartment, navigation]);

  const change = (patch: Partial<InventoryValues>) => {
    if (!editingId) return;
    queue.change(editingId, { ...queue.getSnapshot().entries[editingId].values, ...patch });
  };

  const amountInputRefs = useRef<Array<TextInput | null>>([]);
  const itemInputRefs = useRef<Array<TextInput | null>>([]);

  const addRow = () => {
    const newIndex = rows.length;
    change({ items: [...rows, { ...defaultRow }] });
    setTimeout(() => amountInputRefs.current[newIndex]?.focus(), 50);
  };
  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    change({ items: rows.filter((_, i) => i !== index) });
  };
  const setRowAt = (index: number, field: 'amount' | 'item', value: string) => {
    change({ items: rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)) });
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('Missing title', 'Please enter a title.');
      return;
    }
    if (!vesselId || !editingId) {
      Alert.alert('Error', 'Join a vessel to create inventory items.');
      return;
    }
    setSaving(true);
    try {
      await queue.save(editingId, true);
      const latest = queue.getSnapshot().entries[editingId];
      if (latest.version !== latest.savedVersion)
        throw new Error('Your changes have not synced yet.');
      navigation.goBack();
    } catch (e) {
      Alert.alert(
        'Could not save',
        e instanceof Error ? e.message : 'Your changes are kept on this device. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const reviewOrRetry = async () => {
    if (!editingId || !vesselId) return;
    if (!entry?.blocked) {
      await queue.flush();
      return;
    }
    try {
      const latest = await inventoryService.getFreshById(editingId, vesselId);
      if (!latest) {
        Alert.alert(
          'Item unavailable',
          'This item was deleted or you no longer have access. Your unsynced changes remain on this device.'
        );
        return;
      }
      const resolve = (keepLocal: boolean) => {
        void queue
          .resolve(editingId, latest, keepLocal)
          .catch(() =>
            Alert.alert('Could not save', 'Your changes remain on this device. Please try again.')
          );
      };
      Alert.alert(
        'Inventory changed elsewhere',
        'Another edit was saved while you were working. Choose which version to keep.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Load Latest', onPress: () => resolve(false) },
          { text: 'Keep My Changes', onPress: () => resolve(true) },
        ]
      );
    } catch {
      Alert.alert('Could not connect', 'Your changes remain on this device. Please try again.');
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

  if (state.storageError && !state.ready) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <PageHeader title={isEdit ? 'Edit Inventory Item' : 'Create Inventory Item'} />
        <Button
          title="Retry"
          onPress={() => {
            void queue.load();
          }}
        />
        <Text style={{ color: themeColors.textPrimary }}>{state.storageError}</Text>
      </View>
    );
  }
  if (loading || !state.ready) {
    return <ScreenLoading title={isEdit ? 'Edit Inventory Item' : 'Create Inventory Item'} />;
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
        <InventoryAutoSaveControl />
        <TouchableOpacity
          disabled={!entry?.error && !state.storageError}
          onPress={() => {
            void reviewOrRetry();
          }}
          accessibilityRole="button"
        >
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.saveStatus, { color: themeColors.textSecondary }]}
          >
            {state.storageError ??
              entry?.error ??
              (entry?.saving
                ? 'Saving…'
                : !state.enabled
                  ? 'Auto Save is off. Use Save Changes to save.'
                  : !entry?.version
                    ? 'Changes save automatically.'
                    : !entry.localSaved
                      ? 'Saving…'
                      : !title.trim()
                        ? 'Saved on this device. Enter a title to sync.'
                        : entry.version !== entry.savedVersion
                          ? 'Saving…'
                          : 'Saved')}
          </Text>
        </TouchableOpacity>
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
            onChange={(value) => value && change({ department: value as Department })}
            layout="stacked"
            tightTop
          />
          <Input
            label="Title"
            value={title}
            onChangeText={(title) => change({ title })}
            placeholder="e.g. Deck Supplies"
            autoCapitalize="words"
          />
          <Input
            label="Location"
            value={location}
            onChangeText={(location) => change({ location })}
            placeholder="e.g. Bosun Locker"
            autoCapitalize="words"
          />
          <Input
            label="Description"
            value={description}
            onChangeText={(description) => change({ description })}
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
          {!state.enabled && (
            <Button
              title={isEdit ? 'Save Changes' : 'Create Inventory Item'}
              onPress={handleSave}
              variant="primary"
              loading={saving}
              disabled={saving}
              fullWidth
            />
          )}
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
                      if (!editingId) return;
                      setSaving(true);
                      try {
                        await queue.delete(editingId, async (created) => {
                          if (created) await inventoryService.delete(editingId);
                        });
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
  saveStatus: { fontSize: FONTS.xs, marginBottom: SPACING.md },
  deleteBtn: { marginTop: SPACING.md },
});
