/**
 * Create Rules Screen
 * Fill-in form for rules (title + rule items), Export to PDF, Publish
 */

import React, { useState, useEffect } from 'react';
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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import rulesService from '../services/rules';
import { Button } from '../components';
import { generateRulesPdf } from '../utils/rulesPdf';

export const CreateRulesScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const ruleId = route.params?.ruleId as string | undefined;
  const isEdit = !!ruleId;
  const [loading, setLoading] = useState(isEdit);
  const [title, setTitle] = useState('');
  const [rules, setRules] = useState<string[]>(['']);

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Rules' : 'Create Rules' });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!ruleId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const item = await rulesService.getById(ruleId);
        if (item) {
          setTitle(item.data?.title ?? item.title ?? '');
          const r = item.data?.rules ?? [];
          setRules(r.length ? r : ['']);
        }
      } catch (e) {
        console.error('Load rules error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [ruleId]);

  const setRule = (i: number, v: string) => {
    const next = [...rules];
    next[i] = v;
    setRules(next);
  };
  const addRule = () => setRules([...rules, '']);
  const removeRule = (i: number) => {
    if (rules.length <= 1) return;
    setRules(rules.filter((_, idx) => idx !== i));
  };

  const filteredRules = rules.filter(Boolean);

  const onExport = async () => {
    const t = title || 'Rules';
    const fn = t.replace(/[^a-z0-9]/gi, '_') + '.pdf';
    await generateRulesPdf(t, filteredRules, fn);
  };

  const onPublish = async () => {
    if (!vesselId) return;
    const t = title || 'General Rules';
    try {
      if (isEdit && ruleId) {
        await rulesService.update(ruleId, t, filteredRules);
      } else {
        await rulesService.create(vesselId, t, filteredRules, user?.id);
      }
      navigation.goBack();
    } catch (e) {
      console.error('Publish error:', e);
      Alert.alert('Error', 'Could not publish');
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to create rules.</Text>
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
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: themeColors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Rule Title</Text>
        <TextInput
          style={[styles.input, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
          value={title}
          onChangeText={setTitle}
          placeholder="eg. Deck/Interior Team or Miami to Nassau"
          placeholderTextColor={COLORS.textTertiary}
        />
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Rules</Text>
        {rules.map((r, i) => (
          <View key={i} style={styles.ruleRow}>
            <TextInput
              style={[styles.input, styles.textArea, styles.flex, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={r}
              onChangeText={(v) => setRule(i, v)}
              placeholder="Enter rule"
              placeholderTextColor={COLORS.textTertiary}
              multiline
            />
            {rules.length > 1 && (
              <TouchableOpacity onPress={() => removeRule(i)}>
                <Text style={styles.remove}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <TouchableOpacity onPress={addRule}>
          <Text style={styles.add}>+ New Rule</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <Button title="Export to PDF" onPress={onExport} variant="outline" fullWidth style={styles.btn} />
          <Button title={isEdit ? 'Save' : 'Publish'} onPress={onPublish} variant="primary" fullWidth style={styles.btn} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding + 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: 4, marginTop: SPACING.md },
  input: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginBottom: SPACING.sm },
  flex: { flex: 1 },
  remove: { fontSize: FONTS.sm, color: COLORS.primary, paddingTop: SPACING.md },
  add: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600', marginBottom: SPACING.sm },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
