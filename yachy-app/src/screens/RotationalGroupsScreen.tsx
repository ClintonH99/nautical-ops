/**
 * Rotational Groups Screen
 * MOV/HOD can view, create, rename, link, and unlink named rotation groups.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import userService from '../services/user';
import { User, RotationGroup } from '../types';
import { LoadingSpinner, PageHeader } from '../components';

export const RotationalGroupsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user: currentUser } = useAuthStore();
  const [rotationalCrew, setRotationalCrew] = useState<User[]>([]);
  const [namedGroups, setNamedGroups] = useState<RotationGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Name input modal state
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameModalValue, setNameModalValue] = useState('');
  const [nameModalMode, setNameModalMode] = useState<'create' | 'rename'>('create');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  const isMOV = currentUser?.role === 'CAPTAIN_MOV';
  const canEdit = isMOV; // HOD read-only, MOV can edit

  const loadData = useCallback(async () => {
    if (!currentUser?.vesselId) return;
    try {
      const [crew, groups] = await Promise.all([
        userService.getRotationalCrew(currentUser.vesselId),
        userService.getRotationGroupsByVessel(currentUser.vesselId),
      ]);
      setRotationalCrew(crew);
      setNamedGroups(groups);
    } catch {
      Alert.alert('Error', 'Failed to load rotational crew');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser?.vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
  };

  const toggleSelect = (id: string) => {
    if (!canEdit) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Open the name modal for creating a new group
  const openCreateModal = () => {
    if (selectedIds.size < 2) {
      Alert.alert(
        'Select Members',
        'Select at least 2 rotational crew members to link as a group.'
      );
      return;
    }
    setNameModalMode('create');
    setNameModalValue('');
    setRenamingGroupId(null);
    setNameModalVisible(true);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  // Open the name modal for renaming an existing group
  const openRenameModal = (group: RotationGroup) => {
    setNameModalMode('rename');
    setNameModalValue(group.name);
    setRenamingGroupId(group.id);
    setNameModalVisible(true);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const handleNameSubmit = async () => {
    const trimmed = nameModalValue.trim();
    if (!trimmed) {
      Alert.alert('Name Required', 'Please enter a name for this group.');
      return;
    }
    setNameModalVisible(false);

    if (nameModalMode === 'create') {
      await handleCreateGroup(trimmed);
    } else if (nameModalMode === 'rename' && renamingGroupId) {
      await handleRenameGroup(renamingGroupId, trimmed);
    }
  };

  const handleCreateGroup = async (name: string) => {
    if (!currentUser?.vesselId) return;
    try {
      const newGroupId = await userService.createRotationGroup(currentUser.vesselId, name);
      await Promise.all(
        Array.from(selectedIds).map((id) => userService.updateRotationGroup(id, newGroupId))
      );
      setSelectedIds(new Set());
      await loadData();
      Alert.alert('Group Created', `"${name}" rotation group has been created.`);
    } catch {
      Alert.alert('Error', 'Failed to create rotation group');
    }
  };

  const handleRenameGroup = async (groupId: string, name: string) => {
    try {
      await userService.updateRotationGroupName(groupId, name);
      await loadData();
    } catch {
      Alert.alert('Error', 'Failed to rename group');
    }
  };

  const handleRemoveFromGroup = (member: User) => {
    Alert.alert('Remove from Group', `Remove ${member.name} from their rotation group?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const groupId = member.rotationGroupId!;
            await userService.updateRotationGroup(member.id, null);

            // If this was the last member in the group, delete the group record
            const remaining = rotationalCrew.filter(
              (c) => c.rotationGroupId === groupId && c.id !== member.id
            );
            if (remaining.length === 0) {
              await userService.deleteRotationGroup(groupId);
            }
            await loadData();
          } catch {
            Alert.alert('Error', 'Failed to remove from group');
          }
        },
      },
    ]);
  };

  const handleAddToExistingGroup = (groupId: string, groupName: string) => {
    if (selectedIds.size === 0) return;
    Alert.alert('Add to Group', `Add ${selectedIds.size} selected member(s) to "${groupName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: async () => {
          try {
            await Promise.all(
              Array.from(selectedIds).map((id) => userService.updateRotationGroup(id, groupId))
            );
            setSelectedIds(new Set());
            await loadData();
          } catch {
            Alert.alert('Error', 'Failed to add to group');
          }
        },
      },
    ]);
  };

  // Organise crew into named groups and ungrouped
  const crewByGroup = new Map<string, User[]>();
  const ungrouped: User[] = [];

  rotationalCrew.forEach((member) => {
    if (member.rotationGroupId) {
      const g = crewByGroup.get(member.rotationGroupId) ?? [];
      g.push(member);
      crewByGroup.set(member.rotationGroupId, g);
    } else {
      ungrouped.push(member);
    }
  });

  const renderMember = (member: User, inGroup: boolean) => {
    const isSelected = selectedIds.has(member.id);
    return (
      <TouchableOpacity
        key={member.id}
        style={[
          styles.memberRow,
          {
            backgroundColor: themeColors.surface,
            borderBottomColor: themeColors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          },
          isSelected && {
            backgroundColor: themeColors.isDark ? 'rgba(30,58,138,0.25)' : 'rgba(30,58,138,0.08)',
          },
        ]}
        onPress={() => {
          if (!canEdit) return;
          if (inGroup) {
            handleRemoveFromGroup(member);
          } else {
            toggleSelect(member.id);
          }
        }}
        activeOpacity={0.7}
      >
        <View style={styles.memberAvatar}>
          <Text style={styles.memberAvatarText}>{member.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.memberInfo}>
          <Text style={[styles.memberName, { color: themeColors.textPrimary }]}>{member.name}</Text>
          <Text style={[styles.memberPosition, { color: themeColors.textSecondary }]}>
            {[member.position, member.department].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {isSelected && (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={14} color={COLORS.white} />
          </View>
        )}
        {inGroup && canEdit && (
          <Text style={[styles.removeHint, { color: COLORS.danger }]}>Tap to remove</Text>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Rotational Groups" />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.infoBannerTitle, { color: themeColors.textPrimary }]}>
            About Rotation Groups
          </Text>
          <Text style={[styles.infoBannerText, { color: themeColors.textSecondary }]}>
            {canEdit
              ? 'Select ungrouped crew members below then tap "Create Group" to link them. Tap a group name to rename it. Tap a grouped member to remove them.'
              : 'Rotation groups show which crew members share the same role on rotation. Only MOV can edit groups.'}
          </Text>
        </View>

        {rotationalCrew.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              No rotational crew on this vessel yet.
            </Text>
            <Text style={[styles.emptySubtext, { color: themeColors.textSecondary }]}>
              Crew registered with Contract Type "Rotational" will appear here.
            </Text>
          </View>
        ) : (
          <>
            {/* Named groups */}
            {namedGroups.map((group) => {
              const members = crewByGroup.get(group.id) ?? [];
              if (members.length === 0) return null;
              return (
                <View key={group.id} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
                      {group.name}
                    </Text>
                    {canEdit && (
                      <TouchableOpacity
                        onPress={() => openRenameModal(group)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons
                          name="pencil-outline"
                          size={15}
                          color={themeColors.textSecondary}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View
                    style={[
                      styles.card,
                      { borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border },
                    ]}
                  >
                    {members.map((m) => renderMember(m, true))}
                    {/* Add selected ungrouped members to this group */}
                    {canEdit && selectedIds.size > 0 && (
                      <TouchableOpacity
                        style={[styles.addToGroupBtn, { borderColor: COLORS.primary }]}
                        onPress={() => handleAddToExistingGroup(group.id, group.name)}
                      >
                        <Text style={[styles.addToGroupText, { color: COLORS.primary }]}>
                          + Add selected to "{group.name}"
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Ungrouped members */}
            {ungrouped.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
                    Ungrouped
                  </Text>
                </View>
                {canEdit && (
                  <Text style={[styles.sectionHint, { color: themeColors.textSecondary }]}>
                    Tap crew members to select them, then tap "Create Group".
                  </Text>
                )}
                <View
                  style={[
                    styles.card,
                    { borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border },
                  ]}
                >
                  {ungrouped.map((m) => renderMember(m, false))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Floating create group button */}
      {canEdit && selectedIds.size >= 2 && (
        <View style={styles.fabContainer}>
          <TouchableOpacity style={styles.fab} onPress={openCreateModal} activeOpacity={0.85}>
            <Text style={styles.fabText}>Create Group ({selectedIds.size} selected)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Name input modal */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              {nameModalMode === 'create' ? 'Name this Group' : 'Rename Group'}
            </Text>
            <Text style={[styles.modalSubtitle, { color: themeColors.textSecondary }]}>
              {nameModalMode === 'create'
                ? 'Give this rotation group a name, e.g. "Bridge Team" or "Stew Team".'
                : 'Enter a new name for this rotation group.'}
            </Text>
            <TextInput
              ref={nameInputRef}
              style={[
                styles.modalInput,
                {
                  backgroundColor: themeColors.isDark ? 'rgba(255,255,255,0.08)' : COLORS.surface,
                  color: themeColors.textPrimary,
                  borderColor: themeColors.isDark ? 'rgba(255,255,255,0.15)' : COLORS.border,
                },
              ]}
              placeholder="e.g. Bridge Team, Stew Team..."
              placeholderTextColor={themeColors.textSecondary}
              value={nameModalValue}
              onChangeText={setNameModalValue}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleNameSubmit}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnCancel,
                  { borderColor: themeColors.isDark ? 'rgba(255,255,255,0.15)' : COLORS.border },
                ]}
                onPress={() => setNameModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: themeColors.textSecondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnConfirm,
                  { backgroundColor: COLORS.primary },
                ]}
                onPress={handleNameSubmit}
              >
                <Text style={[styles.modalBtnText, { color: COLORS.white }]}>
                  {nameModalMode === 'create' ? 'Create' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: SPACING.lg, paddingBottom: 120 },
  infoBanner: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  infoBannerTitle: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    marginBottom: 4,
  },
  infoBannerText: {
    fontSize: FONTS.xs,
    lineHeight: 18,
  },
  section: { marginBottom: SPACING.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: {
    fontSize: FONTS.xs,
    marginBottom: SPACING.sm,
    fontStyle: 'italic',
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  memberAvatarText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.base,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: FONTS.sm, fontWeight: '600' },
  memberPosition: { fontSize: FONTS.xs, marginTop: 2 },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeHint: { fontSize: FONTS.xs, marginLeft: SPACING.sm },
  addToGroupBtn: {
    margin: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    alignItems: 'center',
  },
  addToGroupText: { fontSize: FONTS.sm, fontWeight: '600' },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl * 2,
  },
  emptyText: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  emptySubtext: { fontSize: FONTS.sm, textAlign: 'center', lineHeight: 20 },
  fabContainer: {
    position: 'absolute',
    bottom: SPACING.xl,
    left: SPACING.lg,
    right: SPACING.lg,
  },
  fab: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.base,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalCard: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  modalTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  modalSubtitle: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.base,
    marginBottom: SPACING.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  modalBtnCancel: {
    borderWidth: 1,
  },
  modalBtnConfirm: {},
  modalBtnText: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
});
