/**
 * Add / Edit Uniform Screen
 * Department (on create), Label name, entry cards: Amount | Size | Color
 * | Male/Female | Day/Night (optional). Enter on the last field of the
 * last card adds a new one and focuses it, matching Inventory/Shopping.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  KeyboardAvoidingView, Platform, Modal, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import uniformsService, { UniformEntry } from '../services/uniforms';
import { Department } from '../types';
import { Input, Button, LoadingSpinner } from '../components';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
const emptyEntry = (): UniformEntry => ({ amount: '', size: '', color: '', gender: '', dayNight: '' });

export const AddEditUniformScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const uniformId = route?.params?.uniformId as string | undefined;
  const isEdit = !!uniformId;
  const vesselId = user?.vesselId ?? null;

  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [entries, setEntries] = useState<UniformEntry[]>([emptyEntry()]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const amountRefs = useRef<Array<any>>([]);
  const sizeRefs = useRef<Array<any>>([]);
  const colorRefs = useRef<Array<any>>([]);
  const genderRefs = useRef<Array<any>>([]);
  const dayNightRefs = useRef<Array<any>>([]);

  useEffect(() => {
    if (!uniformId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const u = await uniformsService.getById(uniformId);
        if (u) {
          setLabel(u.label);
          setDepartment(u.department);
          setEntries(u.entries.length ? u.entries : [emptyEntry()]);
        }
      } catch (e) {
        console.error('Load uniform error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [uniformId]);

  const setEntryAt = (index: number, field: keyof UniformEntry, value: string) => {
    setEntries((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addEntry = () => {
    const newIndex = entries.length;
    setEntries((prev) => [...prev, emptyEntry()]);
    setTimeout(() => amountRefs.current[newIndex]?.focus(), 50);
  };

  const removeEntry = (index: number) => {
    if (entries.length <= 1) return;
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      Alert.alert('Missing label', 'Please enter a label name.');
      return;
    }
    if (!vesselId) return;
    const trimmedEntries = entries.filter(
      (e) => e.amount.trim() || e.size.trim() || e.color.trim() || e.gender.trim() || (e.dayNight ?? '').trim()
    );
    setSaving(true);
    try {
      if (isEdit) {
        await uniformsService.update(uniformId!, { label: trimmedLabel, department, entries: trimmedEntries });
      } else {
        await uniformsService.create({ vesselId, label: trimmedLabel, department, entries: trimmedEntries, createdBy: user?.id });
      }
      navigation.goBack();
    } catch (e) {
      console.error('Save uniform error:', e);
      Alert.alert('Error', 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!uniformId) return;
    Alert.alert('Delete label', `Delete "${label.trim()}" and all its entries?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await uniformsService.delete(uniformId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete.');
          }
        },
      },
    ]);
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to manage uniforms.</Text>
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
      keyboardVerticalOffset={100}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!isEdit && (
          <View style={styles.deptSection}>
            <Text style={[styles.deptLabel, { color: themeColors.textPrimary }]}>Department</Text>
            <TouchableOpacity
              style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
              onPress={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
                {department.charAt(0) + department.slice(1).toLowerCase()}
              </Text>
              <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>{departmentDropdownOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {departmentDropdownOpen && (
              <Modal visible transparent animationType="fade">
                <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentDropdownOpen(false)}>
                  <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
                    {DEPARTMENTS.map((dept) => (
                      <TouchableOpacity
                        key={dept}
                        style={[styles.modalItem, department === dept && styles.modalItemSelected]}
                        onPress={() => { setDepartment(dept); setDepartmentDropdownOpen(false); }}
                      >
                        <Text style={[styles.modalItemText, { color: themeColors.textPrimary }, department === dept && styles.modalItemTextSelected]}>
                          {dept.charAt(0) + dept.slice(1).toLowerCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Pressable>
              </Modal>
            )}
          </View>
        )}

        <Input label="Label" value={label} onChangeText={setLabel} placeholder="e.g. Swimwear" autoCapitalize="words" />

        <Text style={[styles.label, { color: themeColors.textPrimary }]}>Entries</Text>
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          return (
            <View key={index} style={[styles.entryCard, { backgroundColor: themeColors.surface, borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border }]}>
              <View style={styles.entryRow}>
                <View style={styles.amountField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>#</Text>
                  <TextInput
                    ref={(el) => { amountRefs.current[index] = el; }}
                    style={[styles.input, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                    value={entry.amount}
                    onChangeText={(v) => setEntryAt(index, 'amount', v)}
                    placeholder="#"
                    placeholderTextColor={COLORS.gray400}
                    returnKeyType="next"
                    onSubmitEditing={() => sizeRefs.current[index]?.focus()}
                  />
                </View>
                <View style={styles.wideField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Size</Text>
                  <TextInput
                    ref={(el) => { sizeRefs.current[index] = el; }}
                    style={[styles.input, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                    value={entry.size}
                    onChangeText={(v) => setEntryAt(index, 'size', v)}
                    placeholder="Size"
                    placeholderTextColor={COLORS.gray400}
                    returnKeyType="next"
                    onSubmitEditing={() => colorRefs.current[index]?.focus()}
                  />
                </View>
                <View style={styles.wideField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Color</Text>
                  <TextInput
                    ref={(el) => { colorRefs.current[index] = el; }}
                    style={[styles.input, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                    value={entry.color}
                    onChangeText={(v) => setEntryAt(index, 'color', v)}
                    placeholder="Color"
                    placeholderTextColor={COLORS.gray400}
                    returnKeyType="next"
                    onSubmitEditing={() => genderRefs.current[index]?.focus()}
                  />
                </View>
              </View>
              <View style={styles.entryRow}>
                <View style={styles.wideField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Male / female</Text>
                  <TextInput
                    ref={(el) => { genderRefs.current[index] = el; }}
                    style={[styles.input, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                    value={entry.gender}
                    onChangeText={(v) => setEntryAt(index, 'gender', v)}
                    placeholder="M / F"
                    placeholderTextColor={COLORS.gray400}
                    returnKeyType="next"
                    onSubmitEditing={() => dayNightRefs.current[index]?.focus()}
                  />
                </View>
                <View style={styles.wideField}>
                  <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Day / night (optional)</Text>
                  <TextInput
                    ref={(el) => { dayNightRefs.current[index] = el; }}
                    style={[styles.input, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                    value={entry.dayNight ?? ''}
                    onChangeText={(v) => setEntryAt(index, 'dayNight', v)}
                    placeholder="Day / Night"
                    placeholderTextColor={COLORS.gray400}
                    returnKeyType="done"
                    onSubmitEditing={() => { if (isLast) addEntry(); }}
                  />
                </View>
                <TouchableOpacity onPress={() => removeEntry(index)} style={styles.removeBtn} disabled={entries.length <= 1}>
                  <Ionicons name="trash-outline" size={18} color={entries.length <= 1 ? COLORS.gray400 : COLORS.danger} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        <TouchableOpacity onPress={addEntry} style={styles.addEntryBtn}>
          <Ionicons name="add" size={16} color={COLORS.primary} />
          <Text style={styles.addEntryBtnText}>Add entry</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <Button title={isEdit ? 'Save changes' : 'Create'} onPress={handleSave} variant="primary" loading={saving} disabled={saving} fullWidth />
          {isEdit && (
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
  label: { Size: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs, marginTop: SPACING.md },
  deptSection: { marginBottom: SPACING.lg },
  deptLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  dropdown: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  modalBox: { borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.sm, minWidth: 200 },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  modalItemSelected: {},
  modalItemText: { fontSize: FONTS.base },
  modalItemTextSelected: { color: COLORS.primary, fontWeight: '600' },
  entryCard: { borderRadius: BORDER_RADIUS.md, borderWidth: 1, padding: SPACING.md, marginBottom: SPACING.md },
  entryRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, alignItems: 'flex-end' },
  amountField: { width: 48 },
  wideField: { flex: 1 },
  fieldLabel: { fontSize: FONTS.xs, marginBottom: 3 },
  input: {
    height: SIZES.inputHeight, fontSize: FONTS.base, paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  removeBtn: { paddingHorizontal: SPACING.xs, paddingBottom: SPACING.sm },
  addEntryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACING.sm, marginBottom: SPACING.md },
  addEntryBtnText: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.primary },
  actions: { marginTop: SPACING.xl },
  deleteBtn: { marginTop: SPACING.md, alignItems: 'center', paddingVertical: SPACING.sm },
});
