/**
 * Add / Edit Pre-Departure Checklist Screen
 * Title, optional trip link, checklist items (read-and-do, not tickable)
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { usePostHog } from 'posthog-react-native';
import preDepartureChecklistsService from '../services/preDepartureChecklists';
import tripsService from '../services/trips';
import { PreDepartureChecklistItem, Department } from '../types';
import {
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  LabeledDropdown,
  DepartmentSelector,
  EnterToAddHint,
} from '../components';
import { Trip } from '../types';
import { formatLocalDateString } from '../utils';

const DEPARTMENT_OPTIONS: { value: Department | null; label: string }[] = [
  { value: null, label: 'All Departments' },
  { value: 'BRIDGE', label: 'Bridge' },
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'EXTERIOR', label: 'Exterior' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'GALLEY', label: 'Galley' },
];

const DEFAULT_ITEMS = [
  'Fuel topped up',
  'Water tanks full',
  'Safety equipment checked',
  'Provisions on board',
  'Engine room inspection',
  'Navigation equipment ready',
];

export const AddEditPreDepartureChecklistScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const posthog = usePostHog();
  const checklistId = route?.params?.checklistId as string | undefined;
  const initialTripId = route?.params?.tripId as string | undefined;
  const isEdit = !!checklistId;
  const isHOD = user?.role === 'HOD';
  const isCaptain = user?.role === 'CAPTAIN_MOV';

  // Captain/MOV and appointed HODs can manage every pre-departure checklist.
  const canEdit = () => isCaptain || isHOD;

  const [title, setTitle] = useState('');
  const [tripId, setTripId] = useState<string | null>(initialTripId ?? null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [items, setItems] = useState<PreDepartureChecklistItem[]>([]);
  const [draftItems, setDraftItems] = useState<string[]>(DEFAULT_ITEMS);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [loading, setLoading] = useState(!!checklistId);
  const [saving, setSaving] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripModalVisible, setTripModalVisible] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const loadChecklist = useCallback(async () => {
    if (!checklistId) return;
    try {
      const c = await preDepartureChecklistsService.getById(checklistId);
      if (c) {
        setTitle(c.title);
        setTripId(c.tripId);
        setDepartment(c.department);
        setItems(c.items);
      } else {
        Alert.alert('Error', 'Checklist not found.');
        navigation.goBack();
      }
    } catch (e) {
      console.error('Load checklist error:', e);
      Alert.alert('Error', 'Could not load checklist.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [checklistId, navigation]);

  const loadTrips = useCallback(async () => {
    if (!vesselId) return;
    const data = await tripsService.getTripsByVessel(vesselId);
    setTrips(data);
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadTrips();
      if (checklistId) loadChecklist();
      else setLoading(false);
    }, [checklistId, loadChecklist, loadTrips])
  );

  const isEditable = canEdit();
  // When creating, both HOD and Captain need to see the form to pick department. When editing, only authorized editor.
  const showEditableFields = isEdit ? isEditable : isHOD || isCaptain;

  useEffect(() => {
    navigation.setOptions({
      title: isEdit
        ? isEditable
          ? 'Edit Checklist'
          : 'Pre-Departure Checklist'
        : 'Create Pre-Departure Checklist',
    });
  }, [navigation, isEdit, isEditable]);

  const addItem = async () => {
    const label = newItemLabel.trim();
    if (!label || !isEditable) return;

    if (!isEdit) {
      setDraftItems((previous) => [...previous, label]);
      setNewItemLabel('');
      return;
    }

    if (!checklistId) return;
    try {
      const added = await preDepartureChecklistsService.addItem(checklistId, label);
      setItems((prev) => [...prev, added].sort((a, b) => a.sortOrder - b.sortOrder));
      setNewItemLabel('');
    } catch (e) {
      Alert.alert('Error', 'Could not add item.');
    }
  };

  const removeItem = async (item: PreDepartureChecklistItem) => {
    try {
      await preDepartureChecklistsService.deleteItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      Alert.alert('Error', 'Could not remove item.');
    }
  };

  const removeDraftItem = (index: number) => {
    setDraftItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleSave = async () => {
    if (!isEditable) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('Missing title', 'Please enter a title for the checklist.');
      return;
    }
    if (!vesselId) return;

    setSaving(true);
    try {
      if (isEdit) {
        await preDepartureChecklistsService.update(checklistId!, {
          title: trimmedTitle,
          tripId,
          department,
        });
        Alert.alert('Saved', 'Checklist updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        const itemLabels = draftItems.map((label) => label.trim()).filter(Boolean);
        const created = await preDepartureChecklistsService.create({
          vesselId,
          tripId: tripId || undefined,
          department: department || undefined,
          title: trimmedTitle,
          items: itemLabels.map((label) => ({ label })),
        });
        posthog.capture('pre_departure_checklist_created', {
          checklist_id: created.id,
          department: department ?? 'all',
          has_linked_trip: !!tripId,
          item_count: itemLabels.length,
        });
        Alert.alert('Created', 'Pre-departure checklist created.', [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not save checklist.');
    } finally {
      setSaving(false);
    }
  };

  const selectedTrip = trips.find((t) => t.id === tripId);

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to create checklists.
        </Text>
      </View>
    );
  }

  if (!(isHOD || isCaptain) && !isEdit) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Only HODs and Captain have access.
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

  if (isEdit && !isEditable) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Only HODs and Captain have access.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title="Pre-Departure Checklist" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {showEditableFields ? (
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Deck/Interior Team or Miami to Nassau"
          />
        ) : (
          <>
            <View style={styles.fieldContainer}>
              <Text style={[styles.label, { color: themeColors.textPrimary }]}>Title</Text>
              <Text style={[styles.readOnlyTitle, { color: themeColors.textPrimary }]}>
                {title || '—'}
              </Text>
            </View>
            {department != null && (
              <View style={styles.fieldContainer}>
                <Text style={[styles.label, { color: themeColors.textPrimary }]}>Department</Text>
                <Text style={[styles.readOnlyTitle, { color: themeColors.textPrimary }]}>
                  {DEPARTMENT_OPTIONS.find((o) => o.value === department)?.label ?? department}
                </Text>
              </View>
            )}
          </>
        )}

        {showEditableFields && (
          <>
            <View style={styles.fieldContainer}>
              <DepartmentSelector value={department} onChange={setDepartment} includeAll />
            </View>
            <View style={styles.fieldContainer}>
              <LabeledDropdown
                label="Linked Trip"
                value={selectedTrip?.title ?? (tripId ? 'Linked trip' : 'None')}
                open={tripModalVisible}
                onPress={() => setTripModalVisible(true)}
              />
            </View>

            {tripModalVisible && (
              <Modal visible transparent animationType="fade">
                <Pressable style={styles.modalBackdrop} onPress={() => setTripModalVisible(false)}>
                  <View
                    style={[
                      styles.modalBox,
                      {
                        backgroundColor: themeColors.surfaceElevated,
                        borderColor: themeColors.border,
                      },
                    ]}
                    onStartShouldSetResponder={() => true}
                  >
                    <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                      Select linked trip
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.modalItem,
                        !tripId && { backgroundColor: themeColors.controlSelected },
                      ]}
                      onPress={() => {
                        setTripId(null);
                        setTripModalVisible(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalItemText,
                          {
                            color: !tripId ? themeColors.textOnAccent : themeColors.textPrimary,
                          },
                        ]}
                      >
                        No linked trip
                      </Text>
                      {!tripId && (
                        <Text style={[styles.selectedMark, { color: themeColors.textOnAccent }]}>
                          ✓
                        </Text>
                      )}
                    </TouchableOpacity>
                    <ScrollView style={styles.tripOptions} nestedScrollEnabled>
                      {trips.map((t) => (
                        <TouchableOpacity
                          key={t.id}
                          style={[
                            styles.modalItem,
                            tripId === t.id && {
                              backgroundColor: themeColors.controlSelected,
                            },
                          ]}
                          onPress={() => {
                            setTripId(t.id);
                            setTripModalVisible(false);
                          }}
                        >
                          <View style={styles.modalItemContent}>
                            <Text
                              style={[
                                styles.modalItemText,
                                {
                                  color:
                                    tripId === t.id
                                      ? themeColors.textOnAccent
                                      : themeColors.textPrimary,
                                },
                              ]}
                            >
                              {t.title}
                            </Text>
                            <Text
                              style={[
                                styles.modalItemSub,
                                {
                                  color:
                                    tripId === t.id
                                      ? themeColors.textOnAccent
                                      : themeColors.textSecondary,
                                },
                              ]}
                            >
                              {formatLocalDateString(t.startDate)} –{' '}
                              {formatLocalDateString(t.endDate)}
                            </Text>
                          </View>
                          {tripId === t.id && (
                            <Text
                              style={[styles.selectedMark, { color: themeColors.textOnAccent }]}
                            >
                              ✓
                            </Text>
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </Pressable>
              </Modal>
            )}
          </>
        )}

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>
          Checklist items
        </Text>

        <>
          {isEdit
            ? items.map((item, idx) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={[styles.itemBullet, { color: themeColors.accent }]}>{idx + 1}.</Text>
                  <Text style={[styles.itemLabel, { color: themeColors.textPrimary }]}>
                    {item.label}
                  </Text>
                  {isEditable && (
                    <TouchableOpacity
                      onPress={() => removeItem(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.removeBtn}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            : draftItems.map((label, idx) => (
                <View key={`${label}-${idx}`} style={styles.itemRow}>
                  <Text style={[styles.itemBullet, { color: themeColors.accent }]}>{idx + 1}.</Text>
                  <Text style={[styles.itemLabel, { color: themeColors.textPrimary }]}>
                    {label}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeDraftItem(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.removeBtn}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}

          {isEditable && (
            <View style={styles.addSection}>
              <Input
                value={newItemLabel}
                onChangeText={setNewItemLabel}
                placeholder="Add new item..."
                containerStyle={styles.addInput}
                returnKeyType="done"
                submitBehavior="submit"
                onSubmitEditing={addItem}
              />
              <EnterToAddHint />
            </View>
          )}
        </>

        {showEditableFields && (
          <View style={styles.actions}>
            <Button
              title={isEdit ? 'Save' : 'Create Checklist'}
              onPress={handleSave}
              variant="primary"
              loading={saving}
              disabled={saving || !isEditable}
              fullWidth
            />
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => navigation.goBack()}
              disabled={saving}
            >
              <Text style={[styles.cancelText, { color: themeColors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: 88 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  readOnlyTitle: { fontSize: FONTS.base, fontWeight: '600' },
  fieldContainer: { marginBottom: SPACING.md },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
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
    minWidth: 280,
    maxHeight: 400,
    borderWidth: 1,
  },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemContent: { flex: 1 },
  modalItemSelected: { backgroundColor: COLORS.primaryLight },
  modalItemText: { fontSize: FONTS.base },
  modalItemSub: { fontSize: FONTS.xs, marginTop: 2 },
  selectedMark: { color: COLORS.primary, fontSize: FONTS.lg, fontWeight: '700' },
  tripOptions: { maxHeight: 300 },
  sectionLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  itemBullet: {
    fontSize: FONTS.base,
    fontWeight: '600',
    minWidth: 24,
  },
  itemLabel: { flex: 1, fontSize: FONTS.base },
  removeBtn: { fontSize: FONTS.sm, color: COLORS.danger },
  addSection: { marginTop: SPACING.sm },
  addInput: { marginBottom: 0 },
  hint: { fontSize: FONTS.sm, marginTop: SPACING.xs },
  actions: { marginTop: SPACING.xl, gap: SPACING.sm },
  cancelBtn: { alignSelf: 'center', padding: SPACING.sm },
  cancelText: { fontSize: FONTS.base },
});
