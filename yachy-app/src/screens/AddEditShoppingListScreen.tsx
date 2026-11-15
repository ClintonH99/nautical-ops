import { OfflineError } from '../offline/access';
import { allowOnlineAction } from '../offline/onlineActions';
import { returnToPreviousPage } from '../navigation/returnToPreviousPage';
/**
 * Add / Edit Shopping List Screen
 * Title, department (on create), bullet-point list of items
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import shoppingListsService, {
  ShoppingList,
  ShoppingListItem,
  ShoppingListType,
} from '../services/shoppingLists';
import { Department } from '../types';
import { offlineShopping } from '../offline/shoppingService';
import {
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  DepartmentSelector,
  EnterToAddHint,
  PreviewActionButtons,
} from '../components';

export const AddEditShoppingListScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const listId = route?.params?.listId as string | undefined;
  const presetTitle = route?.params?.presetTitle as string | undefined;
  const listType = (route?.params?.listType as ShoppingListType) ?? 'general';
  const asMasterList = !!route?.params?.asMasterList;
  const isEdit = !!listId;

  const [title, setTitle] = useState(presetTitle ?? '');
  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [items, setItems] = useState<ShoppingListItem[]>([{ text: '', checked: false }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isMaster, setIsMaster] = useState(false);
  const [offlineLocalVersion, setOfflineLocalVersion] = useState<number | undefined>();

  const baseRef = useRef<Pick<ShoppingList, 'title' | 'items'> | undefined>(undefined);
  const rowKeys = useRef<string[]>(['new-item']);
  const nextRowKey = useRef(0);
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
        baseRef.current = { title: list.title, items: list.items };
        rowKeys.current = ['new-item', ...list.items.map(() => `item-${++nextRowKey.current}`)];
        setOfflineLocalVersion(list.offlineLocalVersion);
        setTitle(list.title);
        setDepartment(list.department);
        setItems([{ text: '', checked: false }, ...list.items]);
        setIsMaster(!!list.isMaster);
      } else {
        Alert.alert('Error', 'Shopping list not found.');
        returnToPreviousPage(navigation);
      }
    } catch (e) {
      console.error('Load shopping list error:', e);
      Alert.alert('Error', 'Could not load list.');
      returnToPreviousPage(navigation);
    } finally {
      setLoading(false);
    }
  }, [listId, vesselId, navigation]);

  useFocusEffect(
    useCallback(() => {
      loadList();
    }, [loadList])
  );

  useEffect(() => {
    if (!isEdit && presetTitle) {
      setTitle(presetTitle);
    }
  }, [isEdit, presetTitle]);

  const quantityInputRefs = useRef<Array<TextInput | null>>([]);
  const itemInputRefs = useRef<Array<TextInput | null>>([]);
  const addItem = () => {
    if (!items[0]?.text.trim()) {
      itemInputRefs.current[0]?.focus();
      return;
    }
    rowKeys.current.splice(1, 0, `item-${++nextRowKey.current}`);
    setItems((prev) => [{ text: '', checked: false }, ...prev]);
    setTimeout(() => quantityInputRefs.current[0]?.focus(), 0);
  };
  const removeItem = (index: number) => {
    if (index === 0) setItems((prev) => [{ text: '', checked: false }, ...prev.slice(1)]);
    else {
      rowKeys.current.splice(index, 1);
      setItems((prev) => prev.filter((_, i) => i !== index));
    }
  };
  const setItemAt = (index: number, field: 'amount' | 'text', value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
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
      .map((item) => ({
        text: item.text.trim(),
        amount: item.amount?.trim() || undefined,
        checked: item.checked,
      }))
      .filter((item) => item.text.length > 0);
    if (!vesselId) return;
    setSaving(true);
    try {
      if (isEdit) {
        const saved = await shoppingListsService.update(
          listId,
          { title: trimmedTitle, items: trimmedItems },
          offlineLocalVersion,
          baseRef.current
        );
        baseRef.current = { title: saved.title, items: saved.items };
        setOfflineLocalVersion(saved.offlineLocalVersion);
        Alert.alert(
          'Saved',
          offlineShopping.enabled()
            ? 'Saved on this device. Check the sync status before closing this browser.'
            : 'Shopping list updated.'
        );
      } else {
        await shoppingListsService.create({
          vesselId,
          department,
          listType,
          title: trimmedTitle,
          items: trimmedItems,
          createdBy: user?.id,
          isMaster: asMasterList,
        });
        Alert.alert(
          'Created',
          offlineShopping.enabled()
            ? 'Saved on this device. Check the sync status before closing this browser.'
            : 'Shopping list added.'
        );
      }
      returnToPreviousPage(navigation);
    } catch (e) {
      console.error('Save shopping list error:', e);
      Alert.alert(
        'Could not save shopping list',
        e instanceof OfflineError && e.code === 'LOCAL_CONFLICT'
          ? 'This list changed elsewhere. Your edits are still here. Reopen the list to review the latest version before editing again.'
          : 'Your edits are still here. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!allowOnlineAction('Deleting records')) return;
    if (isMaster || !listId) return;
    Alert.alert('Delete Shopping List', `Delete "${title.trim()}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await shoppingListsService.delete(listId);
            returnToPreviousPage(navigation);
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to create shopping lists.
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

  const screenTitle = isEdit
    ? 'Edit Shopping List'
    : asMasterList
      ? 'Create Personalized List'
      : listType === 'trip'
        ? 'Create Trip Shopping List'
        : 'Create General Shopping List';
  const saveButtonTitle = isEdit
    ? 'Save Changes'
    : asMasterList
      ? 'Create Personalized List'
      : listType === 'trip'
        ? 'Create Trip Shopping List'
        : 'Create Shopping List';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title={screenTitle} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.borderStrong },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            List details
          </Text>
          <Input
            label="List name"
            value={title}
            onChangeText={setTitle}
            placeholder={
              listType === 'trip' ? 'e.g. Bahamas charter shopping' : 'e.g. Weekly galley supplies'
            }
            autoCapitalize="words"
          />
          {!isEdit && !asMasterList && (
            <DepartmentSelector
              value={department}
              onChange={(value) => value && setDepartment(value)}
              tightTop
              layout="stacked"
            />
          )}
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.borderStrong },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Shopping items
          </Text>
          <View style={styles.itemColumnLabels}>
            <Text
              style={[
                styles.itemColumnLabel,
                styles.quantityColumnLabel,
                { color: themeColors.textSecondary },
              ]}
            >
              QTY
            </Text>
            <Text
              style={[
                styles.itemColumnLabel,
                styles.itemNameColumnLabel,
                { color: themeColors.textSecondary },
              ]}
            >
              ITEM
            </Text>
            <View style={styles.removeColumnSpacer} />
          </View>
          {items.map((item, index) => (
            <View key={rowKeys.current[index]}>
              <View style={styles.itemRow}>
                <TextInput
                  ref={(element) => {
                    quantityInputRefs.current[index] = element;
                  }}
                  style={[
                    styles.quantityInput,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={item.amount ?? ''}
                  onChangeText={(value) => setItemAt(index, 'amount', value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="number-pad"
                  returnKeyType="default"
                  submitBehavior="submit"
                  autoFocus={!isEdit && index === 0}
                  selectTextOnFocus
                  onSubmitEditing={() => itemInputRefs.current[index]?.focus()}
                  accessibilityLabel={`Quantity for item ${index + 1}`}
                />
                <TextInput
                  ref={(el) => {
                    itemInputRefs.current[index] = el;
                  }}
                  style={[
                    styles.itemInput,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={item.text}
                  onChangeText={(value) => setItemAt(index, 'text', value)}
                  placeholder="Shopping item"
                  placeholderTextColor={themeColors.textMuted}
                  returnKeyType="default"
                  submitBehavior="submit"
                  onSubmitEditing={() => {
                    if (index === 0) addItem();
                    else quantityInputRefs.current[index + 1]?.focus();
                  }}
                  accessibilityLabel={`Item name ${index + 1}`}
                />
                <TouchableOpacity
                  onPress={() => removeItem(index)}
                  style={styles.removeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove item ${index + 1}`}
                >
                  <Ionicons name="close" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
              {index === 0 && <Button title="Add Item" variant="outline" onPress={addItem} />}
            </View>
          ))}
          <EnterToAddHint style={styles.enterHint} />
        </View>

        <View style={styles.actions}>
          <Button
            title={saveButtonTitle}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          {isEdit && !isMaster && <PreviewActionButtons onDelete={handleDelete} />}
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
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  itemColumnLabels: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  itemColumnLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  quantityColumnLabel: {
    width: 68,
    textAlign: 'center',
  },
  itemNameColumnLabel: {
    flex: 1,
  },
  removeColumnSpacer: {
    width: 44,
  },
  itemRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  quantityInput: {
    width: 68,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 0,
    fontSize: FONTS.base,
    fontWeight: '700',
    textAlign: 'center',
  },
  itemInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 0,
    fontSize: FONTS.base,
  },
  removeBtn: {
    width: 44,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterHint: { marginTop: 0, marginBottom: 0 },
  actions: { marginTop: SPACING.sm },
});
