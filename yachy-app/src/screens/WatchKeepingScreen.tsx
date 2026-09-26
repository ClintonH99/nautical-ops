import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
/**
 * Watch Keeping Screen
 * Watch Keeping Rules (view / HOD edit), then Watch Schedule and Create buttons
 */

import React, { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader, PreviewActionButtons } from '../components';
import watchKeepingService, { WatchKeepingRules } from '../services/watchKeeping';

const WATCH_KEEPING_INFO = {
  title: 'Watch Keeping',
  description: 'Manage watch schedules and timetables.',
  features: [
    'Build watch timetables for the crew',
    'Assign watch periods to crew members',
    'Keep bridge coverage organized',
    'Adjust schedules as needed',
  ],
};

const watchKeepingRulesCache = new Map<string, WatchKeepingRules | null>();
const rulesStorageKey = (vesselId: string) => `watch-keeping-rules:${vesselId}`;

export const WatchKeepingScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const actionColor = themeColors.isDark ? COLORS.white : COLORS.primary;
  const hasCachedRules = vesselId ? watchKeepingRulesCache.has(vesselId) : false;
  const cachedRules = vesselId ? watchKeepingRulesCache.get(vesselId) : undefined;

  const [rules, setRules] = useState<WatchKeepingRules | null>(cachedRules ?? null);
  const [loadingRules, setLoadingRules] = useState(!hasCachedRules);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editContent, setEditContent] = useState(cachedRules?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [rulesHasOverflow, setRulesHasOverflow] = useState(false);

  const loadRules = useCallback(async () => {
    if (!vesselId) return;
    const hasCachedValue = watchKeepingRulesCache.has(vesselId);
    let immediateRules = hasCachedValue ? watchKeepingRulesCache.get(vesselId) : undefined;
    if (hasCachedValue) {
      const cached = immediateRules ?? null;
      setRules(cached);
      setEditContent(cached?.content ?? '');
      setLoadingRules(false);
    } else {
      setLoadingRules(true);
    }

    const remoteRulesPromise = watchKeepingService.getRules(vesselId);
    try {
      if (!hasCachedValue) {
        try {
          const storedRules = await AsyncStorage.getItem(rulesStorageKey(vesselId));
          if (storedRules) {
            immediateRules = JSON.parse(storedRules) as WatchKeepingRules | null;
            watchKeepingRulesCache.set(vesselId, immediateRules ?? null);
            setRules(immediateRules ?? null);
            setEditContent(immediateRules?.content ?? '');
            setLoadingRules(false);
          }
        } catch (cacheError) {
          console.warn('Load cached watch rules error:', cacheError);
        }
      }

      const data = await remoteRulesPromise;
      if (data || immediateRules === undefined) {
        watchKeepingRulesCache.set(vesselId, data);
        setRules(data);
        setEditContent(data?.content ?? '');
        setRulesExpanded(false);
        setRulesHasOverflow(false);
        await AsyncStorage.setItem(rulesStorageKey(vesselId), JSON.stringify(data));
      }
    } catch (e) {
      console.error('Load watch rules error:', e);
    } finally {
      setLoadingRules(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      if (vesselId) loadRules();
    }, [vesselId, loadRules])
  );

  const handleSaveRules = async () => {
    if (!vesselId) return;
    setSaving(true);
    try {
      const updated = await watchKeepingService.upsertRules(vesselId, editContent, user?.id);
      watchKeepingRulesCache.set(vesselId, updated);
      await AsyncStorage.setItem(rulesStorageKey(vesselId), JSON.stringify(updated));
      setRules(updated);
      setRulesExpanded(false);
      setRulesHasOverflow(false);
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
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Watch Keeping.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Watch Keeping" info={WATCH_KEEPING_INFO} infoScreenKey="watch_keeping" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.rulesBoard,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <View style={styles.rulesBoardInner}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: actionColor }]}>Watch Keeping Rules</Text>
              {rulesHasOverflow && rulesExpanded ? (
                <TouchableOpacity
                  style={styles.seeLessButton}
                  onPress={() => setRulesExpanded(false)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.seeMoreText, { color: actionColor }]}>See Less</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {loadingRules ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={styles.rulesLoader} />
            ) : (
              <View style={styles.featureList}>
                {rules?.content ? (
                  <>
                    <Text
                      style={[styles.rulesBody, { color: themeColors.textPrimary }]}
                      numberOfLines={rulesHasOverflow && !rulesExpanded ? 10 : undefined}
                      onTextLayout={(event) => {
                        if (!rulesHasOverflow && event.nativeEvent.lines.length > 10) {
                          setRulesHasOverflow(true);
                        }
                      }}
                    >
                      {rules.content}
                    </Text>
                    {rulesHasOverflow && !rulesExpanded ? (
                      <TouchableOpacity
                        style={styles.seeMoreButton}
                        onPress={() => setRulesExpanded(true)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.seeMoreText, { color: actionColor }]}>See More</Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : (
                  <Text style={[styles.rulesPlaceholder, { color: themeColors.textSecondary }]}>
                    {isHOD
                      ? 'No rules set. Tap Edit to add Watch Keeping rules.'
                      : 'No rules set for this vessel.'}
                  </Text>
                )}
              </View>
            )}
            {isHOD && !loadingRules ? <PreviewActionButtons onEdit={openEditModal} /> : null}
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.navigationCard,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
          onPress={() => navigation.navigate('WatchSchedule')}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.navigationIcon,
              { backgroundColor: themeColors.control, borderColor: themeColors.border },
            ]}
          >
            <Ionicons name="calendar-outline" size={22} color={actionColor} />
          </View>
          <View style={styles.navigationCopy}>
            <Text style={[styles.navigationTitle, { color: actionColor }]}>Watch Schedule</Text>
            <Text style={[styles.navigationHint, { color: themeColors.textSecondary }]}>
              View published watch schedules
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navigationCard,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
          onPress={() => navigation.navigate('CreateWatchTimetable')}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.navigationIcon,
              { backgroundColor: themeColors.control, borderColor: themeColors.border },
            ]}
          >
            <Ionicons name="add" size={24} color={actionColor} />
          </View>
          <View style={styles.navigationCopy}>
            <Text style={[styles.navigationTitle, { color: actionColor }]}>
              Create Watch Schedule
            </Text>
            <Text style={[styles.navigationHint, { color: themeColors.textSecondary }]}>
              Create and publish a new schedule
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
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
              <View
                style={[
                  styles.modalBox,
                  { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                ]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={[styles.modalTitle, { color: actionColor }]}>
                  Edit Watch Keeping Rules
                </Text>
                <TextInput
                  style={[
                    styles.rulesInput,
                    {
                      backgroundColor: themeColors.control,
                      color: themeColors.textPrimary,
                      borderColor: themeColors.borderStrong,
                    },
                  ]}
                  value={editContent}
                  onChangeText={setEditContent}
                  placeholder="Enter rules and guidelines for watch keeping..."
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalCancelBtn, { borderColor: actionColor }]}
                    onPress={() => setEditModalOpen(false)}
                  >
                    <Text style={[styles.modalCancelText, { color: actionColor }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalSaveBtn}
                    onPress={handleSaveRules}
                    disabled={saving}
                  >
                    <Text style={styles.modalSaveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
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
    textAlign: 'center',
  },
  rulesBoard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rulesBoardInner: {
    padding: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: 'bold',
  },
  editRulesBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  editRulesBtnText: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  featureList: {
    gap: SPACING.sm,
  },
  rulesBody: {
    fontSize: FONTS.base,
    lineHeight: 24,
  },
  seeMoreButton: {
    alignSelf: 'flex-end',
    minHeight: 40,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeLessButton: {
    minHeight: 36,
    paddingHorizontal: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeMoreText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  rulesPlaceholder: {
    fontSize: FONTS.base,
    fontStyle: 'italic',
    lineHeight: 24,
  },
  rulesLoader: {
    marginVertical: SPACING.md,
  },
  navigationCard: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  navigationIcon: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  navigationCopy: {
    flex: 1,
  },
  navigationTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  navigationHint: {
    fontSize: FONTS.sm,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
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
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveText: {
    fontSize: FONTS.base,
    fontWeight: '600',
    color: COLORS.white,
  },
});
