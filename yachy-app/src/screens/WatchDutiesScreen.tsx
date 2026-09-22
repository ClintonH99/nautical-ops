/**
 * Watch Duties Screen
 * Rules (Captain/HOD editable, everyone can view/export), the week-ahead
 * watch assignment schedule, and department-tagged duty checklists
 * (built in a later pass).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import userService from '../services/user';
import { User } from '../types';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  DepartmentSelector,
  PageHeader,
  EnterToAddHint,
  PreviewActionButtons,
} from '../components';
import {
  getRules,
  saveRules,
  getWeekAssignments,
  WatchAssignment,
  getDutyGroups,
  setItemChecked,
  DutyGroup,
  Department,
  createDutyGroup,
  deleteDutyGroup,
  addDutyItem,
  deleteDutyItem,
  addWatchAssignment,
  removeWatchAssignment,
  resetDutyCompletionsForVessel,
  resetWeekAssignments,
} from '../services/watchDuties';

const DEPT_LABEL: Record<Department, string> = {
  BRIDGE: 'Bridge',
  ENGINEERING: 'Engineering',
  EXTERIOR: 'Exterior',
  INTERIOR: 'Interior',
  GALLEY: 'Galley',
};
function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeStringToDate(t: string): Date {
  const d = new Date();
  const [h, m] = t.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

const WATCH_DUTIES_INFO = {
  title: 'Watch Duties',
  description: 'Rules, the week-ahead watch schedule, and department duty checklists.',
  features: [
    'View Watch Duty Rules - Captain/HOD can edit, everyone can view and export',
    'See the week-ahead watch assignment schedule',
    'Check off duty checklist items by department',
    'Adding items: tap + Add item, type the item, and press Enter to add each new line',
    'Stay on top of who is covering what, and when',
  ],
};

export const WatchDutiesScreen = () => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const canManage = user?.role === 'CAPTAIN_MOV' || user?.role === 'HOD';

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState('');
  const [editingRules, setEditingRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [assignments, setAssignments] = useState<WatchAssignment[]>([]);
  const [dutyGroups, setDutyGroups] = useState<DutyGroup[]>([]);
  const [selectedDept, setSelectedDept] = useState<Department | 'All'>('All');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [addGroupModalVisible, setAddGroupModalVisible] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupDept, setNewGroupDept] = useState<Department>('BRIDGE');
  const [newGroupItems, setNewGroupItems] = useState<string[]>(['']);
  const [addingItemGroupId, setAddingItemGroupId] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [crewList, setCrewList] = useState<User[]>([]);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignDate, setAssignDate] = useState<string | null>(null);
  const [crewPickerVisible, setCrewPickerVisible] = useState(false);
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);
  const [assignStartTime, setAssignStartTime] = useState('18:00');
  const [assignEndTime, setAssignEndTime] = useState('08:00');
  const [activeTimeField, setActiveTimeField] = useState<'start' | 'end' | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [resettingWeek, setResettingWeek] = useState(false);
  const [resettingDuties, setResettingDuties] = useState(false);
  const newGroupItemRefs = useRef<Array<TextInput | null>>([]);
  const dutyGroupsRef = useRef<DutyGroup[]>([]);
  const confirmedDutyStatesRef = useRef(new Map<string, boolean>());
  const pendingDutyStatesRef = useRef(new Map<string, boolean>());
  const savingDutyItemIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const weekStartDate = getMonday(new Date());
  const weekStart = toDateStr(weekStartDate);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartDate);
    d.setDate(weekStartDate.getDate() + i);
    return d;
  });

  useEffect(() => {
    dutyGroupsRef.current = dutyGroups;
  }, [dutyGroups]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const replaceDutyGroups = useCallback((nextGroups: DutyGroup[]) => {
    dutyGroupsRef.current = nextGroups;
    setDutyGroups(nextGroups);
  }, []);

  const updateDutyItemLocally = useCallback(
    (itemId: string, checked: boolean) => {
      replaceDutyGroups(
        dutyGroupsRef.current.map((group) => ({
          ...group,
          items: group.items.map((item) => (item.id === itemId ? { ...item, checked } : item)),
        }))
      );
    },
    [replaceDutyGroups]
  );

  const loadData = useCallback(async () => {
    if (!user?.vesselId) return;
    setLoading(true);
    try {
      const [rulesData, assignmentData, dutyData] = await Promise.all([
        getRules(user.vesselId),
        getWeekAssignments(user.vesselId, weekStart),
        getDutyGroups(user.vesselId, user.id),
      ]);
      setRules(rulesData);
      setAssignments(assignmentData);
      confirmedDutyStatesRef.current = new Map(
        dutyData.flatMap((group) => group.items.map((item) => [item.id, item.checked] as const))
      );
      replaceDutyGroups(dutyData);

      if (canManage) {
        const crewData = await userService.getVesselCrew(user.vesselId);
        setCrewList(crewData);
      }
    } catch (e) {
      console.error('Load Watch Duties error:', e);
    } finally {
      setLoading(false);
    }
  }, [canManage, replaceDutyGroups, user?.id, user?.vesselId, weekStart]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const filteredGroups =
    selectedDept === 'All' ? dutyGroups : dutyGroups.filter((g) => g.department === selectedDept);

  const toggleExpandedGroup = (groupId: string) => {
    setExpandedGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const persistPendingDutyState = useCallback(
    async (itemId: string, userId: string) => {
      if (savingDutyItemIdsRef.current.has(itemId)) return;
      savingDutyItemIdsRef.current.add(itemId);

      try {
        while (pendingDutyStatesRef.current.has(itemId)) {
          const checked = pendingDutyStatesRef.current.get(itemId);
          pendingDutyStatesRef.current.delete(itemId);
          if (checked === undefined) continue;

          try {
            await setItemChecked(userId, itemId, checked);
            confirmedDutyStatesRef.current.set(itemId, checked);
          } catch (error) {
            console.error('Toggle duty item error:', error);
            if (!pendingDutyStatesRef.current.has(itemId) && mountedRef.current) {
              const confirmedChecked = confirmedDutyStatesRef.current.get(itemId) ?? false;
              updateDutyItemLocally(itemId, confirmedChecked);
              Alert.alert(
                'Could not update duty',
                'Your last change was not saved. Please try again.'
              );
            }
          }
        }
      } finally {
        savingDutyItemIdsRef.current.delete(itemId);
      }
    },
    [updateDutyItemLocally]
  );

  const handleToggleItem = (itemId: string) => {
    if (!user?.id) return;

    const latestItem = dutyGroupsRef.current
      .flatMap((group) => group.items)
      .find((item) => item.id === itemId);
    if (!latestItem) return;

    const checked = !latestItem.checked;
    updateDutyItemLocally(itemId, checked);
    pendingDutyStatesRef.current.set(itemId, checked);
    void persistPendingDutyState(itemId, user.id);
  };

  const openAssignModal = (dateStr: string) => {
    if (!canManage) return;
    setAssignDate(dateStr);
    setSelectedCrewId(null);
    setAssignStartTime('18:00');
    setAssignEndTime('08:00');
    setActiveTimeField(null);
    setCrewPickerVisible(false);
    setAssignModalVisible(true);
  };

  const closeAssignModal = () => {
    setAssignModalVisible(false);
    setActiveTimeField(null);
    setCrewPickerVisible(false);
  };

  const handleAssignCrew = async () => {
    if (!user?.vesselId || !assignDate || !selectedCrewId) return;
    setSavingAssignment(true);
    try {
      await addWatchAssignment(
        user.vesselId,
        assignDate,
        selectedCrewId,
        assignStartTime,
        assignEndTime
      );
      const updated = await getWeekAssignments(user.vesselId, weekStart);
      setAssignments(updated);
      setSelectedCrewId(null);
    } catch (e) {
      Alert.alert('Error', 'Failed to assign watch.');
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleRemoveAssignment = (assignmentId: string) => {
    Alert.alert('Remove Watch Assignment', 'Remove this watch assignment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeWatchAssignment(assignmentId);
            setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
          } catch (e) {
            Alert.alert('Error', 'Failed to remove assignment.');
          }
        },
      },
    ]);
  };

  const handleResetWeek = () => {
    if (!user?.vesselId || !canManage || resettingWeek) return;

    Alert.alert(
      'Reset Week Assignments?',
      'This will remove every crew assignment from the displayed week. Duty groups will not be changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Week',
          style: 'destructive',
          onPress: async () => {
            setResettingWeek(true);
            try {
              await resetWeekAssignments(user.vesselId!, weekStart);
              setAssignments([]);
            } catch (e) {
              console.error('Reset week assignments error:', e);
              Alert.alert('Error', 'Failed to reset this week. Please try again.');
            } finally {
              setResettingWeek(false);
            }
          },
        },
      ]
    );
  };

  const handleResetDuties = () => {
    if (!user?.vesselId || !canManage || resettingDuties) return;

    Alert.alert(
      'Reset Duties for All Crew?',
      'This will untick every duty for every crew member. Duty groups and duty items will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Duties',
          style: 'destructive',
          onPress: async () => {
            setResettingDuties(true);
            try {
              await resetDutyCompletionsForVessel(user.vesselId!);
              setDutyGroups((prev) =>
                prev.map((group) => ({
                  ...group,
                  items: group.items.map((item) => ({ ...item, checked: false })),
                }))
              );
            } catch (e) {
              console.error('Reset duty completions error:', e);
              Alert.alert('Error', 'Failed to reset duties. Please try again.');
            } finally {
              setResettingDuties(false);
            }
          },
        },
      ]
    );
  };

  const openAddGroupModal = () => {
    setNewGroupTitle('');
    setNewGroupDept('BRIDGE');
    setNewGroupItems(['']);
    newGroupItemRefs.current = [];
    setAddGroupModalVisible(true);
  };

  const closeAddGroupModal = () => {
    if (savingGroup) return;
    setAddGroupModalVisible(false);
  };

  const handleNewGroupItemChange = (index: number, value: string) => {
    setNewGroupItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const handleNewGroupItemSubmit = (index: number) => {
    if (!newGroupItems[index]?.trim()) return;

    if (index < newGroupItems.length - 1) {
      newGroupItemRefs.current[index + 1]?.focus();
      return;
    }

    setNewGroupItems((prev) => [...prev, '']);
    requestAnimationFrame(() => newGroupItemRefs.current[index + 1]?.focus());
  };

  const handleRemoveNewGroupItem = (index: number) => {
    setNewGroupItems((prev) => {
      if (prev.length === 1) return [''];
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const handleCreateGroup = async () => {
    const title = newGroupTitle.trim();
    if (!user?.vesselId || !title) return;

    const itemLabels = newGroupItems.map((item) => item.trim()).filter(Boolean);
    let createdGroupId: string | null = null;
    setSavingGroup(true);
    try {
      createdGroupId = await createDutyGroup(user.vesselId, title, newGroupDept);
      for (const [index, label] of itemLabels.entries()) {
        await addDutyItem(createdGroupId, label, index);
      }

      const refreshedGroups = await getDutyGroups(user.vesselId, user.id);
      setDutyGroups(refreshedGroups);
      setNewGroupTitle('');
      setNewGroupItems(['']);
      setAddGroupModalVisible(false);
    } catch (e) {
      if (createdGroupId) {
        try {
          await deleteDutyGroup(createdGroupId);
        } catch (cleanupError) {
          console.error('Clean up duty group error:', cleanupError);
        }
      }
      Alert.alert('Error', 'Failed to create duty group.');
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = (groupId: string, title: string) => {
    Alert.alert('Delete Duty Group', `Delete "${title}" and all its items?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDutyGroup(groupId);
            setDutyGroups((prev) => prev.filter((g) => g.id !== groupId));
          } catch (e) {
            Alert.alert('Error', 'Failed to delete group.');
          }
        },
      },
    ]);
  };

  const handleAddItem = async (groupId: string) => {
    const label = newItemText.trim();
    if (!label) return;
    const group = dutyGroups.find((g) => g.id === groupId);
    const sortOrder = group ? group.items.length : 0;
    try {
      const itemId = await addDutyItem(groupId, label, sortOrder);
      setDutyGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                items: [
                  ...g.items,
                  {
                    id: itemId,
                    label,
                    sortOrder,
                    checked: false,
                  },
                ],
              }
            : g
        )
      );
      setNewItemText('');
      // Field stays open so several duties can be typed one after another.
    } catch (e) {
      Alert.alert('Error', 'Failed to add item.');
    }
  };

  const handleDeleteItem = (groupId: string, itemId: string) => {
    Alert.alert('Remove Duty Item', 'Remove this duty item?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDutyItem(itemId);
            setDutyGroups((prev) =>
              prev.map((g) =>
                g.id === groupId ? { ...g, items: g.items.filter((i) => i.id !== itemId) } : g
              )
            );
          } catch (e) {
            Alert.alert('Error', 'Failed to remove item.');
          }
        },
      },
    ]);
  };

  const handleSaveRules = async () => {
    if (!user?.vesselId) return;
    setSavingRules(true);
    try {
      await saveRules(user.vesselId, rulesDraft);
      setRules(rulesDraft);
      setEditingRules(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to save rules.');
    } finally {
      setSavingRules(false);
    }
  };

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: themeColors.background, justifyContent: 'center' },
        ]}
      >
        <ActivityIndicator color={themeColors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title="Watch Duties" info={WATCH_DUTIES_INFO} infoScreenKey="watch_duties" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: themeColors.textPrimary, marginBottom: 0 }]}>
            This week
          </Text>
          {canManage && (
            <TouchableOpacity
              onPress={handleResetWeek}
              disabled={resettingWeek || assignments.length === 0}
              style={[
                styles.resetButton,
                { opacity: resettingWeek || assignments.length === 0 ? 0.45 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Reset all crew assignments for this week"
            >
              <Text style={styles.resetButtonText}>
                {resettingWeek ? 'Resetting…' : 'Reset Week'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View
          style={[
            styles.card,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          {weekDates.map((d, i) => {
            const dateStr = toDateStr(d);
            const dayAssignments = assignments.filter((a) => a.date === dateStr);
            return (
              <TouchableOpacity
                key={dateStr}
                disabled={!canManage}
                onPress={() => openAssignModal(dateStr)}
                style={[
                  styles.weekRow,
                  i < weekDates.length - 1 && styles.weekRowBorder,
                  { borderColor: themeColors.textSecondary + '30' },
                ]}
              >
                <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm }}>
                  {d.toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
                {dayAssignments.length === 0 ? (
                  canManage ? (
                    <View
                      style={{
                        backgroundColor: themeColors.accentSoft,
                        borderRadius: 12,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: themeColors.accent,
                          fontSize: FONTS.xs,
                          fontWeight: '600',
                        }}
                      >
                        {'\u2192'} Select a crew member
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={{ color: themeColors.textSecondary, fontSize: FONTS.sm, opacity: 0.6 }}
                    >
                      Not assigned
                    </Text>
                  )
                ) : (
                  <View style={{ alignItems: 'flex-end' }}>
                    {dayAssignments.map((a) => (
                      <Text
                        key={a.id}
                        style={{ color: themeColors.textPrimary, fontSize: FONTS.sm }}
                      >
                        {a.userName} · {a.startTime}–{a.endTime}
                      </Text>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {assignModalVisible && assignDate && (
          <Modal visible transparent animationType="fade" onRequestClose={closeAssignModal}>
            <View style={styles.modalBackdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeAssignModal} />
              <View
                style={[
                  styles.modalBox,
                  {
                    backgroundColor: themeColors.surfaceElevated,
                    borderColor: themeColors.border,
                    // Let short forms stay compact, while giving long assignment
                    // and crew lists room to scroll on smaller phones.
                    maxHeight: '85%',
                  },
                ]}
              >
                {crewPickerVisible ? (
                  <>
                    <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                      Select crew
                    </Text>
                    <ScrollView
                      style={styles.crewPickerList}
                      contentContainerStyle={styles.crewPickerContent}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                    >
                      {crewList.map((c) => (
                        <TouchableOpacity
                          key={c.id}
                          style={[
                            styles.modalItem,
                            selectedCrewId === c.id && {
                              backgroundColor: themeColors.controlSelected,
                            },
                          ]}
                          onPress={() => {
                            setSelectedCrewId(c.id);
                            setCrewPickerVisible(false);
                          }}
                        >
                          <Text
                            style={{
                              color:
                                selectedCrewId === c.id
                                  ? themeColors.textOnAccent
                                  : themeColors.textPrimary,
                              fontSize: FONTS.base,
                            }}
                          >
                            {c.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <TouchableOpacity
                      onPress={() => setCrewPickerVisible(false)}
                      style={[
                        styles.secondaryButton,
                        { marginTop: SPACING.md, borderColor: themeColors.borderStrong },
                      ]}
                    >
                      <Text style={{ color: themeColors.textPrimary }}>Back</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <ScrollView
                    style={styles.assignmentFormScroll}
                    contentContainerStyle={styles.assignmentFormContent}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                      {new Date(assignDate + 'T00:00:00').toLocaleDateString(undefined, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </Text>

                    {assignments.filter((a) => a.date === assignDate).length > 0 && (
                      <View style={{ marginBottom: SPACING.md }}>
                        {assignments
                          .filter((a) => a.date === assignDate)
                          .map((a) => (
                            <View
                              key={a.id}
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                paddingVertical: 6,
                              }}
                            >
                              <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.sm }}>
                                {a.userName} {'\u00b7'} {a.startTime}
                                {'\u2013'}
                                {a.endTime}
                              </Text>
                              <TouchableOpacity onPress={() => handleRemoveAssignment(a.id)}>
                                <Text style={{ color: '#dc2626', fontSize: FONTS.sm }}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                      </View>
                    )}

                    <Text
                      style={{
                        color: themeColors.textSecondary,
                        fontSize: FONTS.sm,
                        marginBottom: 6,
                      }}
                    >
                      Add crew member
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.dropdown,
                        {
                          backgroundColor: themeColors.control,
                          borderColor: themeColors.border,
                          marginBottom: SPACING.sm,
                        },
                      ]}
                      onPress={() => setCrewPickerVisible(true)}
                    >
                      <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.sm }}>
                        {selectedCrewId
                          ? (crewList.find((c) => c.id === selectedCrewId)?.name ?? 'Select crew')
                          : 'Select crew'}
                      </Text>
                    </TouchableOpacity>

                    <View
                      style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}
                    >
                      <TouchableOpacity
                        style={[
                          styles.dropdown,
                          {
                            backgroundColor: themeColors.control,
                            borderColor: themeColors.border,
                            flex: 1,
                          },
                        ]}
                        onPress={() => setActiveTimeField('start')}
                      >
                        <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.sm }}>
                          Start {assignStartTime}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.dropdown,
                          {
                            backgroundColor: themeColors.control,
                            borderColor: themeColors.border,
                            flex: 1,
                          },
                        ]}
                        onPress={() => setActiveTimeField('end')}
                      >
                        <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.sm }}>
                          End {assignEndTime}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {activeTimeField && (
                      <DateTimePicker
                        value={timeStringToDate(
                          activeTimeField === 'start' ? assignStartTime : assignEndTime
                        )}
                        mode="time"
                        display="spinner"
                        themeVariant={themeColors.isDark ? 'dark' : 'light'}
                        onChange={(event, selectedDate) => {
                          if (selectedDate) {
                            const timeStr = dateToTimeString(selectedDate);
                            if (activeTimeField === 'start') setAssignStartTime(timeStr);
                            else setAssignEndTime(timeStr);
                          }
                          if (Platform.OS === 'android') setActiveTimeField(null);
                        }}
                      />
                    )}
                    {activeTimeField && Platform.OS === 'ios' && (
                      <TouchableOpacity
                        onPress={() => setActiveTimeField(null)}
                        style={[
                          styles.primaryButton,
                          {
                            backgroundColor: themeColors.controlSelected,
                            marginBottom: SPACING.md,
                          },
                        ]}
                      >
                        <Text style={{ color: '#fff', fontWeight: '600' }}>Done</Text>
                      </TouchableOpacity>
                    )}

                    {!activeTimeField && (
                      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                        <TouchableOpacity
                          onPress={closeAssignModal}
                          style={[
                            styles.secondaryButton,
                            { borderColor: themeColors.borderStrong },
                          ]}
                        >
                          <Text style={{ color: themeColors.textPrimary }}>Done</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleAssignCrew}
                          disabled={savingAssignment || !selectedCrewId}
                          style={[
                            styles.primaryButton,
                            {
                              backgroundColor: themeColors.controlSelected,
                              opacity: savingAssignment || !selectedCrewId ? 0.6 : 1,
                            },
                          ]}
                        >
                          <Text style={{ color: '#fff', fontWeight: '600' }}>
                            {savingAssignment ? 'Assigning…' : 'Assign Crew Member'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </ScrollView>
                )}
              </View>
            </View>
          </Modal>
        )}

        <View
          style={[
            styles.card,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
              marginTop: SPACING.lg,
            },
          ]}
        >
          <View style={styles.cardHeaderRow}>
            <Text
              style={[styles.sectionTitle, { color: themeColors.textPrimary, marginBottom: 0 }]}
            >
              Rules
            </Text>
          </View>
          {editingRules ? (
            <>
              <TextInput
                value={rulesDraft}
                onChangeText={setRulesDraft}
                multiline
                style={[
                  styles.rulesInput,
                  {
                    backgroundColor: themeColors.control,
                    color: themeColors.textPrimary,
                    borderColor: themeColors.border,
                  },
                ]}
                placeholder="Enter watch duty rules..."
                placeholderTextColor={themeColors.textSecondary}
              />
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity
                  onPress={() => setEditingRules(false)}
                  style={[styles.secondaryButton, { borderColor: themeColors.borderStrong }]}
                >
                  <Text style={{ color: themeColors.textPrimary }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveRules}
                  disabled={savingRules}
                  style={[styles.primaryButton, { backgroundColor: themeColors.controlSelected }]}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>
                    {savingRules ? 'Saving…' : 'Save Changes'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : rules.trim() ? (
            <View style={{ marginTop: SPACING.sm }}>
              {rules
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line, i) => (
                  <Text
                    key={i}
                    style={{
                      color: themeColors.textSecondary,
                      fontSize: FONTS.sm,
                      marginBottom: 4,
                    }}
                  >
                    {i + 1}. {line.trim()}
                  </Text>
                ))}
            </View>
          ) : (
            <Text
              style={{
                color: themeColors.textSecondary,
                fontSize: FONTS.sm,
                marginTop: SPACING.sm,
              }}
            >
              No rules set yet.
            </Text>
          )}
          {canManage && !editingRules ? (
            <PreviewActionButtons
              onEdit={() => {
                setRulesDraft(rules);
                setEditingRules(true);
              }}
            />
          ) : null}
        </View>

        <DepartmentSelector
          value={selectedDept === 'All' ? null : selectedDept}
          onChange={(value) => setSelectedDept(value ?? 'All')}
          includeAll
        />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: SPACING.xl,
            marginBottom: SPACING.md,
          }}
        >
          <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.base, fontWeight: '600' }}>
            Duties
          </Text>
          {canManage && (
            <TouchableOpacity onPress={openAddGroupModal}>
              <Text style={{ color: themeColors.accent, fontSize: FONTS.sm, fontWeight: '600' }}>
                Create Duty Group
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {canManage && (
          <View style={styles.dutiesResetRow}>
            <TouchableOpacity
              onPress={handleResetDuties}
              disabled={resettingDuties || dutyGroups.every((group) => group.items.length === 0)}
              style={[
                styles.resetButton,
                {
                  opacity:
                    resettingDuties || dutyGroups.every((group) => group.items.length === 0)
                      ? 0.45
                      : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Reset duties for all crew members"
            >
              <Text style={styles.resetButtonText}>
                {resettingDuties ? 'Resetting…' : 'Reset Duties'}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.resetNote, { color: themeColors.textSecondary }]}>
              Resets duties for all crew members.
            </Text>
          </View>
        )}

        {addGroupModalVisible && (
          <Modal visible transparent animationType="slide" onRequestClose={closeAddGroupModal}>
            <KeyboardAvoidingView
              style={styles.groupSheetBackdrop}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={closeAddGroupModal} />
              <View
                style={[styles.groupSheet, { backgroundColor: themeColors.surface }]}
                onStartShouldSetResponder={() => true}
              >
                <View style={styles.groupSheetHeader}>
                  <Text style={[styles.groupSheetTitle, { color: themeColors.textPrimary }]}>
                    Create Duty Group
                  </Text>
                  <TouchableOpacity
                    onPress={closeAddGroupModal}
                    disabled={savingGroup}
                    style={styles.groupSheetClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close create duty group"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={[styles.groupSheetCloseText, { color: themeColors.textPrimary }]}>
                      ×
                    </Text>
                  </TouchableOpacity>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.groupSheetContent}
                >
                  <Text style={[styles.groupFieldLabel, { color: themeColors.textPrimary }]}>
                    Group name
                  </Text>
                  <TextInput
                    value={newGroupTitle}
                    onChangeText={setNewGroupTitle}
                    placeholder="e.g. Morning Duties"
                    placeholderTextColor={themeColors.textSecondary}
                    style={[
                      styles.groupNameInput,
                      {
                        color: themeColors.textPrimary,
                        borderColor: themeColors.textSecondary,
                        backgroundColor: themeColors.background,
                      },
                    ]}
                  />

                  <DepartmentSelector
                    value={newGroupDept}
                    onChange={(value) => value && setNewGroupDept(value)}
                    presentation="inline"
                  />

                  <Text
                    style={[
                      styles.groupFieldLabel,
                      { color: themeColors.textPrimary, marginTop: SPACING.md },
                    ]}
                  >
                    Duty items
                  </Text>
                  {newGroupItems.map((item, index) => (
                    <View key={index}>
                      <View
                        style={[
                          styles.groupItemInputRow,
                          {
                            borderColor: themeColors.textSecondary,
                            backgroundColor: themeColors.background,
                          },
                        ]}
                      >
                        <TextInput
                          ref={(ref) => {
                            newGroupItemRefs.current[index] = ref;
                          }}
                          value={item}
                          onChangeText={(value) => handleNewGroupItemChange(index, value)}
                          placeholder="Add a duty item"
                          placeholderTextColor={themeColors.textSecondary}
                          style={[styles.groupItemInput, { color: themeColors.textPrimary }]}
                          returnKeyType="next"
                          submitBehavior="submit"
                          onSubmitEditing={() => handleNewGroupItemSubmit(index)}
                        />
                        {(newGroupItems.length > 1 || item.length > 0) && (
                          <TouchableOpacity
                            onPress={() => handleRemoveNewGroupItem(index)}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove duty item ${index + 1}`}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text
                              style={[styles.groupItemRemove, { color: themeColors.textPrimary }]}
                            >
                              ×
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {index === newGroupItems.length - 1 && <EnterToAddHint />}
                    </View>
                  ))}

                  <TouchableOpacity
                    onPress={handleCreateGroup}
                    disabled={savingGroup || !newGroupTitle.trim()}
                    style={[
                      styles.groupCreateButton,
                      {
                        backgroundColor: themeColors.controlSelected,
                        opacity: savingGroup || !newGroupTitle.trim() ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.groupCreateButtonText}>
                      {savingGroup ? 'Creating…' : 'Create Duty Group'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={closeAddGroupModal}
                    disabled={savingGroup}
                    style={styles.groupCancelButton}
                  >
                    <Text style={[styles.groupCancelText, { color: themeColors.textPrimary }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {filteredGroups.length === 0 && (
          <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm }}>
            No duty groups yet.
          </Text>
        )}

        {filteredGroups.map((group) => (
          <View
            key={group.id}
            style={[
              styles.card,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
                marginBottom: SPACING.sm,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.cardHeaderRow}
              onPress={() => toggleExpandedGroup(group.id)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: themeColors.textPrimary,
                    fontSize: FONTS.base,
                    fontWeight: '600',
                  }}
                >
                  {group.title}
                </Text>
                <Text
                  style={{ color: themeColors.textSecondary, fontSize: FONTS.xs, marginTop: 2 }}
                >
                  {group.items.length} item{group.items.length === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    backgroundColor: themeColors.accentSoft,
                    borderRadius: 10,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: themeColors.accent, fontSize: FONTS.xs }}>
                    {DEPT_LABEL[group.department]}
                  </Text>
                </View>
                <Text style={{ color: themeColors.textSecondary, fontSize: 12 }}>
                  {expandedGroupIds.has(group.id) ? '\u25b2' : '\u25bc'}
                </Text>
              </View>
            </TouchableOpacity>
            {expandedGroupIds.has(group.id) && (
              <>
                {group.items.map((item) => (
                  <View key={item.id} style={styles.dutyItemRow}>
                    <TouchableOpacity
                      style={styles.dutyItemToggle}
                      onPress={() => handleToggleItem(item.id)}
                      activeOpacity={0.72}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.checked }}
                      accessibilityLabel={`${item.label}, ${item.checked ? 'completed' : 'not completed'}`}
                    >
                      <View
                        style={[
                          styles.dutyCheckbox,
                          {
                            backgroundColor: item.checked
                              ? themeColors.controlSelected
                              : themeColors.control,
                            borderColor: item.checked
                              ? themeColors.controlSelected
                              : themeColors.borderStrong,
                          },
                        ]}
                      >
                        {item.checked ? (
                          <Ionicons name="checkmark" size={15} color={themeColors.textOnAccent} />
                        ) : null}
                      </View>
                      <Text
                        style={{
                          color: item.checked ? themeColors.textSecondary : themeColors.textPrimary,
                          fontSize: FONTS.sm,
                          textDecorationLine: item.checked ? 'line-through' : 'none',
                          flex: 1,
                        }}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                    {canManage && (
                      <TouchableOpacity
                        onPress={() => handleDeleteItem(group.id, item.id)}
                        style={styles.dutyItemRemove}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.label}`}
                      >
                        <Text style={{ color: '#dc2626', fontSize: FONTS.xs }}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {canManage &&
                  (addingItemGroupId === group.id ? (
                    <View style={{ marginTop: 6 }}>
                      <TextInput
                        value={newItemText}
                        onChangeText={setNewItemText}
                        placeholder="New item"
                        placeholderTextColor={themeColors.textSecondary}
                        style={[
                          styles.rulesInput,
                          {
                            flex: 1,
                            minHeight: 36,
                            color: themeColors.textPrimary,
                            borderColor: themeColors.textSecondary,
                            paddingVertical: 6,
                          },
                        ]}
                        autoFocus
                        returnKeyType="done"
                        submitBehavior="submit"
                        onSubmitEditing={() => handleAddItem(group.id)}
                      />
                      <EnterToAddHint />
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => {
                        setAddingItemGroupId(group.id);
                        setNewItemText('');
                      }}
                      style={{ marginTop: 6 }}
                    >
                      <Text style={{ color: themeColors.accent, fontSize: FONTS.sm }}>
                        + Add item
                      </Text>
                    </TouchableOpacity>
                  ))}
                {canManage ? (
                  <PreviewActionButtons onDelete={() => handleDeleteGroup(group.id, group.title)} />
                ) : null}
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  sectionTitle: { fontSize: FONTS.base, fontWeight: '600', marginBottom: SPACING.sm },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  resetButton: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetButtonText: {
    color: '#dc2626',
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  dutiesResetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: -SPACING.xs,
    marginBottom: SPACING.md,
  },
  resetNote: {
    flex: 1,
    fontSize: FONTS.xs,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dutyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  dutyItemToggle: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  dutyCheckbox: {
    width: 22,
    height: 22,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dutyItemRemove: {
    minHeight: 44,
    paddingLeft: SPACING.md,
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  weekRowBorder: { borderBottomWidth: 1 },
  rulesInput: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: FONTS.sm,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
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
    width: '100%',
    maxWidth: 440,
    minWidth: 260,
    maxHeight: '85%',
    borderWidth: 1,
  },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemSelected: {
    backgroundColor: COLORS.gray200,
  },
  crewPickerList: { flexGrow: 0, flexShrink: 1, maxHeight: 360 },
  crewPickerContent: { flexGrow: 0 },
  assignmentFormScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  assignmentFormContent: {
    flexGrow: 0,
  },
  groupSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  groupSheet: {
    width: '100%',
    maxHeight: '92%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  groupSheetHeader: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 56,
    paddingTop: SPACING.sm,
  },
  groupSheetTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  groupSheetClose: {
    position: 'absolute',
    right: SPACING.lg,
    top: SPACING.md,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSheetCloseText: {
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 34,
  },
  groupSheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  groupFieldLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  groupNameInput: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.base,
  },
  groupDepartmentOptions: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    marginTop: -SPACING.xs,
    marginBottom: SPACING.sm,
  },
  groupDepartmentOption: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  groupItemInputRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  groupItemInput: {
    flex: 1,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.base,
  },
  groupItemRemove: {
    fontSize: 26,
    fontWeight: '300',
    marginLeft: SPACING.sm,
  },
  groupCreateButton: {
    minHeight: 50,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  groupCreateButtonText: {
    color: COLORS.white,
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  groupCancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  groupCancelText: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
});
