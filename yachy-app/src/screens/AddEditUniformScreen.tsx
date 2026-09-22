/**
 * Add / Edit Uniform Screen
 * Department (on create), Label name, entry cards: Amount | Size | Color
 * | Male/Female | Day/Night (optional). Enter on the last field of the
 * last card adds a new one and focuses it, matching Inventory/Shopping.
 */
import React, { useState, useRef, useEffect } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import uniformsService, { UniformEntry } from '../services/uniforms';
import { Department } from '../types';
import {
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  DepartmentSelector,
  PreviewActionButtons,
} from '../components';

const emptyEntry = (): UniformEntry => ({
  amount: '',
  size: '',
  color: '',
  gender: '',
  dayNight: '',
});

export const AddEditUniformScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const uniformId = route?.params?.uniformId as string | undefined;
  const isEdit = !!uniformId;
  const vesselId = user?.vesselId ?? null;

  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [label, setLabel] = useState('');
  const [entries, setEntries] = useState<UniformEntry[]>([emptyEntry()]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const amountRefs = useRef<Array<TextInput | null>>([]);
  const sizeRefs = useRef<Array<TextInput | null>>([]);
  const colorRefs = useRef<Array<TextInput | null>>([]);
  const genderRefs = useRef<Array<TextInput | null>>([]);
  const dayNightRefs = useRef<Array<TextInput | null>>([]);

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
      (e) =>
        e.amount.trim() ||
        e.size.trim() ||
        e.color.trim() ||
        e.gender.trim() ||
        (e.dayNight ?? '').trim()
    );
    setSaving(true);
    try {
      if (isEdit) {
        await uniformsService.update(uniformId!, {
          label: trimmedLabel,
          department,
          entries: trimmedEntries,
        });
      } else {
        await uniformsService.create({
          vesselId,
          label: trimmedLabel,
          department,
          entries: trimmedEntries,
          createdBy: user?.id,
        });
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
    Alert.alert('Delete Uniform Label', `Delete "${label.trim()}" and all its entries?`, [
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to manage uniforms.
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
      <PageHeader title={isEdit ? 'Edit Uniform Label' : 'Create Uniform Label'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
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
            Uniform Details
          </Text>
          {!isEdit && (
            <DepartmentSelector
              value={department}
              onChange={(value) => value && setDepartment(value)}
              layout="stacked"
              tightTop
            />
          )}
          <Input
            label="Label Name"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Guest Swimwear"
            autoCapitalize="words"
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
            Uniform Entries
          </Text>
          {entries.map((entry, index) => {
            const isLast = index === entries.length - 1;
            return (
              <View
                key={index}
                style={[
                  styles.entryCard,
                  {
                    backgroundColor: themeColors.surfaceAlt,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.entryTitle,
                    { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
                  ]}
                >
                  Entry {index + 1}
                </Text>
                <View style={styles.entryRow}>
                  <View style={styles.amountField}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>
                      Qty
                    </Text>
                    <TextInput
                      ref={(el) => {
                        amountRefs.current[index] = el;
                      }}
                      style={[
                        styles.input,
                        styles.quantityInput,
                        {
                          backgroundColor: themeColors.control,
                          color: themeColors.textPrimary,
                          borderColor: themeColors.border,
                        },
                      ]}
                      value={entry.amount}
                      onChangeText={(v) => setEntryAt(index, 'amount', v)}
                      placeholder="0"
                      keyboardType="number-pad"
                      placeholderTextColor={themeColors.textSecondary}
                      returnKeyType="next"
                      onSubmitEditing={() => sizeRefs.current[index]?.focus()}
                    />
                  </View>
                  <View style={styles.wideField}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>
                      Size
                    </Text>
                    <TextInput
                      ref={(el) => {
                        sizeRefs.current[index] = el;
                      }}
                      style={[
                        styles.input,
                        {
                          backgroundColor: themeColors.control,
                          color: themeColors.textPrimary,
                          borderColor: themeColors.border,
                        },
                      ]}
                      value={entry.size}
                      onChangeText={(v) => setEntryAt(index, 'size', v)}
                      placeholder="Size"
                      placeholderTextColor={themeColors.textSecondary}
                      returnKeyType="next"
                      onSubmitEditing={() => colorRefs.current[index]?.focus()}
                    />
                  </View>
                  <View style={styles.colorField}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>
                      Colour
                    </Text>
                    <TextInput
                      ref={(el) => {
                        colorRefs.current[index] = el;
                      }}
                      style={[
                        styles.input,
                        {
                          backgroundColor: themeColors.control,
                          color: themeColors.textPrimary,
                          borderColor: themeColors.border,
                        },
                      ]}
                      value={entry.color}
                      onChangeText={(v) => setEntryAt(index, 'color', v)}
                      placeholder="Colour"
                      placeholderTextColor={themeColors.textSecondary}
                      returnKeyType="next"
                      onSubmitEditing={() => genderRefs.current[index]?.focus()}
                    />
                  </View>
                </View>
                <View style={styles.entryRowSecondary}>
                  <View style={styles.wideField}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>
                      Male / Female
                    </Text>
                    <TextInput
                      ref={(el) => {
                        genderRefs.current[index] = el;
                      }}
                      style={[
                        styles.input,
                        {
                          backgroundColor: themeColors.control,
                          color: themeColors.textPrimary,
                          borderColor: themeColors.border,
                        },
                      ]}
                      value={entry.gender}
                      onChangeText={(v) => setEntryAt(index, 'gender', v)}
                      placeholder="Male / Female"
                      placeholderTextColor={themeColors.textSecondary}
                      returnKeyType="next"
                      onSubmitEditing={() => dayNightRefs.current[index]?.focus()}
                    />
                  </View>
                  <View style={styles.wideField}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>
                      Day / Night
                    </Text>
                    <TextInput
                      ref={(el) => {
                        dayNightRefs.current[index] = el;
                      }}
                      style={[
                        styles.input,
                        {
                          backgroundColor: themeColors.control,
                          color: themeColors.textPrimary,
                          borderColor: themeColors.border,
                        },
                      ]}
                      value={entry.dayNight ?? ''}
                      onChangeText={(v) => setEntryAt(index, 'dayNight', v)}
                      placeholder="Day / Night"
                      placeholderTextColor={themeColors.textSecondary}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        if (isLast) addEntry();
                      }}
                    />
                  </View>
                </View>
                <View style={styles.entryDeleteRow}>
                  <TouchableOpacity
                    onPress={() => removeEntry(index)}
                    style={[
                      styles.removeBtn,
                      {
                        borderColor: entries.length <= 1 ? themeColors.textMuted : COLORS.danger,
                      },
                    ]}
                    disabled={entries.length <= 1}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={entries.length <= 1 ? themeColors.textMuted : COLORS.danger}
                    />
                    <Text
                      style={[
                        styles.removeBtnText,
                        { color: entries.length <= 1 ? themeColors.textMuted : COLORS.danger },
                      ]}
                    >
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          <TouchableOpacity onPress={addEntry} style={styles.addEntryBtn}>
            <Ionicons name="add" size={18} color={themeColors.accent} />
            <Text style={[styles.addEntryBtnText, { color: themeColors.accent }]}>Add Entry</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Create Uniform Label'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          {isEdit && <PreviewActionButtons onDelete={handleDelete} />}
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
  sectionTitle: { fontSize: FONTS.base, fontWeight: '700', marginBottom: SPACING.md },
  entryCard: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  entryTitle: { fontSize: FONTS.sm, fontWeight: '700', marginBottom: SPACING.md },
  entryRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'flex-end',
  },
  entryRowSecondary: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    alignItems: 'flex-end',
  },
  amountField: { width: 62 },
  wideField: { flex: 1 },
  colorField: { flex: 1.2 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  input: {
    height: SIZES.inputHeight,
    fontSize: FONTS.base,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quantityInput: { textAlign: 'center', fontWeight: '700' },
  entryDeleteRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.md },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  removeBtnText: { fontSize: FONTS.xs, fontWeight: '600' },
  addEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: SPACING.sm,
  },
  addEntryBtnText: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.primary },
  actions: { marginTop: SPACING.sm },
});
