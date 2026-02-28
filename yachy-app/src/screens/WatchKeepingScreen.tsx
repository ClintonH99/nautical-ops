/**
 * Watch Keeping Screen
 * Watch Keeping Rules (view / HOD edit), then Watch Schedule and Create buttons
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import watchKeepingService, { WatchKeepingRules } from '../services/watchKeeping';

export const WatchKeepingScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';

  const [rules, setRules] = useState<WatchKeepingRules | null>(null);
  const [loadingRules, setLoadingRules] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRules = useCallback(async () => {
    if (!vesselId) return;
    setLoadingRules(true);
    try {
      const data = await watchKeepingService.getRules(vesselId);
      setRules(data);
      setEditContent(data?.content ?? '');
    } catch (e) {
      console.error('Load watch rules error:', e);
    } finally {
      setLoadingRules(false);
    }
  }, [vesselId]);

  useFocusEffect(useCallback(() => {
    if (vesselId) loadRules();
  }, [vesselId, loadRules]));

  const handleSaveRules = async () => {
    if (!vesselId) return;
    setSaving(true);
    try {
      const updated = await watchKeepingService.upsertRules(vesselId, editContent, user?.id);
      setRules(updated);
      setEditModalOpen(false);
      Alert.alert('Saved', 'Watch Keeping Rules have been updated.');
    } catch (e) {
      console.error('Save rules error:', e);
      Alert.alert('Error', 'Could not save rules.');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = () => {
    setEditContent(rules?.content ?? '');
    setEditModalOpen(true);
  };

  if (!vesselId) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Join a vessel to use Watch Keeping.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      {/* Watch Keeping Rules - same style as Coming Soon on Home */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Watch Keeping Rules</Text>
          {isHOD && (
            <TouchableOpacity onPress={openEditModal} style={styles.editRulesBtn}>
              <Text style={styles.editRulesBtnText}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        {loadingRules ? (
          <ActivityIndicator size="small" color={COLORS.primary} style={styles.rulesLoader} />
        ) : (
          <View style={styles.featureList}>
            {rules?.content ? (
              <Text style={styles.rulesBody}>{rules.content}</Text>
            ) : (
              <Text style={styles.rulesPlaceholder}>
                {isHOD ? 'No rules set. Tap Edit to add Watch Keeping rules.' : 'No rules set for this vessel.'}
              </Text>
            )}
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('WatchSchedule')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardIcon}>📋</Text>
        <View style={styles.cardLabelWrap}>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>Watch Schedule</Text>
          <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>View published watch timetables</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('CreateWatchTimetable')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardIcon}>➕</Text>
        <View style={styles.cardLabelWrap}>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>Create</Text>
          <Text style={[styles.cardHint, { color: themeColors.textSecondary }]}>Create and publish a new watch timetable</Text>
        </View>
      </TouchableOpacity>

      {/* Edit Rules Modal (HOD only) */}
      {editModalOpen && (
        <Modal visible transparent animationType="fade">
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={60}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditModalOpen(false)} />
            <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>Edit Watch Keeping Rules</Text>
              <TextInput
                style={styles.rulesInput}
                value={editContent}
                onChangeText={setEditContent}
                placeholder="Enter rules and guidelines for watch keeping..."
                placeholderTextColor={COLORS.textTertiary}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditModalOpen(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleSaveRules}
                  disabled={saving}
                >
                  <Text style={styles.modalSaveText}>{saving ? 'Saving...' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  section: {
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
    borderRadius: 12,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.xl,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  editRulesBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  editRulesBtnText: {
    fontSize: FONTS.base,
    fontWeight: '600',
    color: COLORS.primary,
  },
  featureList: {
    gap: SPACING.sm,
  },
  rulesBody: {
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
    lineHeight: 24,
  },
  rulesPlaceholder: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    lineHeight: 24,
  },
  rulesLoader: {
    marginVertical: SPACING.md,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardIcon: {
    fontSize: 36,
    marginRight: SPACING.lg,
  },
  cardLabelWrap: {
    flex: 1,
  },
  cardLabel: {
    fontSize: FONTS.xl,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  cardHint: {
    fontSize: FONTS.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  rulesInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
    minHeight: 160,
    marginBottom: SPACING.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'flex-end',
  },
  modalCancelBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  modalCancelText: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
  },
  modalSaveBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
  },
  modalSaveText: {
    fontSize: FONTS.base,
    fontWeight: '600',
    color: COLORS.white,
  },
});
