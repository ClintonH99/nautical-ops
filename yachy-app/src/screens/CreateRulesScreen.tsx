/**
 * Create Rules Screen
 * Fill-in form for rules (title + rule items), Export to PDF, Publish
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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import rulesService from '../services/rules';
import { Button, LoadingSpinner, PageHeader, ExportButton, EnterToAddHint } from '../components';
import { generateRulesPdf } from '../utils/rulesPdf';

export const CreateRulesScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const ruleId = route.params?.ruleId as string | undefined;
  const isEdit = !!ruleId;
  const [loading, setLoading] = useState(isEdit);
  const [title, setTitle] = useState('');
  const [rules, setRules] = useState<string[]>(['']);
  const [activeRuleIndex, setActiveRuleIndex] = useState(0);
  const ruleInputRefs = useRef<Array<TextInput | null>>([]);

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
  const addRule = () => {
    const newIndex = rules.length;
    setActiveRuleIndex(newIndex);
    setRules((previous) => [...previous, '']);
    setTimeout(() => ruleInputRefs.current[newIndex]?.focus(), 50);
  };
  const handleRuleSubmit = (index: number) => {
    if (index < rules.length - 1) {
      ruleInputRefs.current[index + 1]?.focus();
      return;
    }
    if (rules[index].trim()) addRule();
  };
  const removeRule = (i: number) => {
    if (rules.length <= 1) return;
    setRules(rules.filter((_, idx) => idx !== i));
    setActiveRuleIndex((current) => {
      if (i < current) return current - 1;
      if (i === current) return Math.max(0, Math.min(i, rules.length - 2));
      return current;
    });
  };

  const filteredRules = rules.filter(Boolean);

  const onExport = async () => {
    const t = title || 'Rules';
    const fn = t.replace(/[^a-z0-9]/gi, '_') + '.pdf';
    await generateRulesPdf(t, filteredRules, fn);
  };

  const onPublish = async () => {
    if (!vesselId || !isHOD) return;
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to create rules.
        </Text>
      </View>
    );
  }
  if (!isHOD) {
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader
        title="Create Rules"
        actions={<ExportButton active={false} onPress={onExport} />}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Text
          style={[
            styles.label,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Rule Title
        </Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="eg. Deck/Interior Team or Miami to Nassau"
          placeholderTextColor={themeColors.textSecondary}
        />
        <Text
          style={[
            styles.label,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Rules
        </Text>
        {rules.map((r, i) => (
          <React.Fragment key={i}>
            <View style={styles.ruleRow}>
              <TextInput
                ref={(element) => {
                  ruleInputRefs.current[i] = element;
                }}
                style={[
                  styles.input,
                  styles.flex,
                  { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
                ]}
                value={r}
                onChangeText={(v) => setRule(i, v)}
                placeholder="Enter rule"
                placeholderTextColor={themeColors.textSecondary}
                returnKeyType="done"
                submitBehavior="submit"
                onFocus={() => setActiveRuleIndex(i)}
                onSubmitEditing={() => handleRuleSubmit(i)}
              />
              {rules.length > 1 && (
                <TouchableOpacity onPress={() => removeRule(i)}>
                  <Text style={styles.remove}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {i === activeRuleIndex && <EnterToAddHint />}
          </React.Fragment>
        ))}

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save' : 'Publish'}
            onPress={onPublish}
            variant="primary"
            fullWidth
            style={styles.btn}
          />
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
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  flex: { flex: 1 },
  remove: { fontSize: FONTS.sm, color: COLORS.primary, padding: SPACING.sm },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
