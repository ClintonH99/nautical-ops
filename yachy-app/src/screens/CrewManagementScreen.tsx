/**
 * Crew Management Screen
 * HOD can view all crew members, their roles, and manage them
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Image,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import {
  useAuthStore,
  useDepartmentColorStore,
  getDepartmentColor as getDeptColor,
} from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import userService from '../services/user';
import { User, Department } from '../types';
import { getPlanTier } from '../constants/subscriptionPlans';
import { LoadingSpinner, PageHeader } from '../components';
import { canAccessVesselManagement, isMasterOfVessel } from '../utils/access';
import { getWatchKeepers, addWatchKeeper, removeWatchKeeper, WatchKeeperEntry } from '../services/watchKeepers';

export const CrewManagementScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user: currentUser } = useAuthStore();
  const [crew, setCrew] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [photoLoadFailedIds, setPhotoLoadFailedIds] = useState<Set<string>>(new Set());
  const [contractFilter, setContractFilter] = useState<
    'all' | 'permanent' | 'temporary' | 'rotational'
  >('all');

  const canManageCrew = canAccessVesselManagement(currentUser);
  const isMOV = isMasterOfVessel(currentUser);
  const [watchKeepers, setWatchKeepers] = useState<WatchKeeperEntry[]>([]);
  const [watchKeeperPickerOpen, setWatchKeeperPickerOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentUser?.vesselId) return;

    try {
      const crewData = await userService.getVesselCrew(currentUser.vesselId);
      setCrew(crewData);
      setPhotoLoadFailedIds(new Set());
      const watchKeeperData = await getWatchKeepers(currentUser.vesselId);
      setWatchKeepers(watchKeeperData);
    } catch (error) {
      console.error('Load data error:', error);
      Alert.alert('Error', 'Failed to load crew members');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.vesselId]);

  useFocusEffect(
    useCallback(() => {
      if (!canManageCrew) {
        navigation.goBack();
        return;
      }

      loadData();
    }, [canManageCrew, navigation, loadData])
  );

  const loadCrew = async () => {
    if (!currentUser?.vesselId) return;

    try {
      const crewData = await userService.getVesselCrew(currentUser.vesselId);
      setCrew(crewData);
    } catch (error) {
      console.error('Load crew error:', error);
      Alert.alert('Error', 'Failed to load crew members');
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleRemoveCrew = (crewMember: User) => {
    Alert.alert(
      'Remove Crew Member',
      `Are you sure you want to remove ${crewMember.name} from the vessel? They can rejoin using the invite code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await userService.removeCrewMember(crewMember.id);
              Alert.alert('Success', `${crewMember.name} has been removed from the vessel`);
              loadCrew(); // Refresh list
            } catch (error) {
              console.error('Remove crew error:', error);
              Alert.alert('Error', 'Failed to remove crew member');
            }
          },
        },
      ]
    );
  };

  const handlePromoteToDemote = (crewMember: User) => {
    const isCurrentlyHOD = crewMember.role === 'HOD';
    const newRole = isCurrentlyHOD ? 'CREW' : 'HOD';
    const action = isCurrentlyHOD ? 'demote' : 'promote';

    Alert.alert(
      `${action === 'promote' ? 'Promote' : 'Demote'} ${crewMember.name}`,
      `${
        action === 'promote'
          ? `Promote ${crewMember.name} to Head of Department (HOD)? They will receive the app permissions assigned to HODs.`
          : `Demote ${crewMember.name} to regular crew? They will lose HOD permissions.`
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'promote' ? 'Promote' : 'Demote',
          onPress: async () => {
            try {
              await userService.updateUserRole(crewMember.id, newRole);
              Alert.alert('Success', `${crewMember.name} has been ${action}d to ${newRole}`);
              loadCrew(); // Refresh list
            } catch (error) {
              console.error('Update role error:', error);
              Alert.alert('Error', `Failed to ${action} crew member`);
            }
          },
        },
      ]
    );
  };

  const handleChangeContractType = (crewMember: User) => {
    Alert.alert(`Contract Type — ${crewMember.name}`, 'Select the new contract type:', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Permanent',
        onPress: async () => {
          try {
            await userService.updateContractType(crewMember.id, 'permanent');
            loadCrew();
          } catch {
            Alert.alert('Error', 'Failed to update contract type');
          }
        },
      },
      {
        text: 'Rotational',
        onPress: async () => {
          try {
            await userService.updateContractType(crewMember.id, 'rotational');
            loadCrew();
          } catch {
            Alert.alert('Error', 'Failed to update contract type');
          }
        },
      },
      {
        text: 'Temporary',
        onPress: async () => {
          try {
            await userService.updateContractType(crewMember.id, 'temporary');
            loadCrew();
          } catch {
            Alert.alert('Error', 'Failed to update contract type');
          }
        },
      },
    ]);
  };

  const handlePromoteToCaptain = (crewMember: User) => {
    Alert.alert(
      `Promote ${crewMember.name} to Captain/MOV`,
      `This will give ${crewMember.name} full Captain/MOV permissions on this vessel. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Promote to Captain',
          onPress: async () => {
            try {
              await userService.updateUserRole(crewMember.id, 'CAPTAIN_MOV');
              await userService.updatePosition(crewMember.id, 'Captain');
              Alert.alert('Success', `${crewMember.name} is now a Captain/MOV.`);
              loadCrew();
            } catch {
              Alert.alert('Error', 'Failed to promote to Captain');
            }
          },
        },
      ]
    );
  };

  const { subscription } = useSubscriptionStatus(currentUser?.vesselId ?? null);
  const currentPlan = subscription ? getPlanTier(subscription.planTier) : null;
  const needsUpgrade =
    currentPlan && crew.length >= currentPlan.maxCrew && currentPlan.maxCrew !== Infinity;

  const overrides = useDepartmentColorStore((s) => s.overrides);
  const getDepartmentColor = (department: Department) => getDeptColor(department, overrides);

  const formatDepartmentDisplay = (user: User) => {
    const dept1 = user.department
      ? user.department.charAt(0) + user.department.slice(1).toLowerCase()
      : '';
    const dept2 = user.department2
      ? user.department2.charAt(0) + user.department2.slice(1).toLowerCase()
      : '';
    return [dept1, dept2].filter(Boolean).join(', ') || '—';
  };

  const renderCrewMember = ({ item }: { item: User }) => {
    const isCurrentUser = item.id === currentUser?.id;
    const departmentDisplay = formatDepartmentDisplay(item);

    return (
      <TouchableOpacity
        style={[styles.crewCard, { backgroundColor: themeColors.surface }]}
        onPress={() => {
          if (isCurrentUser) return;
          Alert.alert('Manage ' + item.name, 'Choose an action', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: item.role === 'HOD' ? 'Demote to Crew' : 'Promote to HOD',
              onPress: () => handlePromoteToDemote(item),
            },
            ...(isMOV && item.role !== 'CAPTAIN_MOV'
              ? [
                  {
                    text: 'Promote to Captain/MOV',
                    onPress: () => handlePromoteToCaptain(item),
                  },
                ]
              : []),
            {
              text: 'Change Contract Type',
              onPress: () => handleChangeContractType(item),
            },
            {
              text: 'Remove from Vessel',
              onPress: () => handleRemoveCrew(item),
              style: 'destructive' as const,
            },
          ]);
        }}
        activeOpacity={isCurrentUser ? 1 : 0.7}
      >
        <View style={styles.crewCardLeft}>
          {!photoLoadFailedIds.has(item.id) ? (
            <Image
              source={{ uri: item.profilePhoto || userService.getProfilePhotoUrl(item.id) }}
              style={styles.avatar}
              onError={() => setPhotoLoadFailedIds((prev) => new Set(prev).add(item.id))}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <View style={styles.crewInfo}>
            <View style={styles.crewNameRow}>
              <Text style={[styles.crewName, { color: themeColors.textPrimary }]}>{item.name}</Text>
              {departmentDisplay !== '—' && (
                <Text style={[styles.departmentLabel, { color: themeColors.textSecondary }]}>
                  {' - '}
                  {departmentDisplay}
                </Text>
              )}
              {isCurrentUser && <Text style={styles.youBadge}>YOU</Text>}
            </View>
            <Text style={[styles.crewPosition, { color: themeColors.textSecondary }]}>
              {item.position}
            </Text>
            <View style={styles.crewBadges}>
              {[item.department, item.department2].filter(Boolean).map((dept) => (
                <View
                  key={dept}
                  style={[styles.departmentBadge, { backgroundColor: getDepartmentColor(dept!) }]}
                >
                  <Text style={styles.departmentText}>
                    {dept!.charAt(0) + dept!.slice(1).toLowerCase()}
                  </Text>
                </View>
              ))}
              <View
                style={[
                  styles.roleBadge,
                  item.role === 'CAPTAIN_MOV'
                    ? styles.roleBadgeMOV
                    : item.role === 'HOD'
                      ? styles.roleBadgeHOD
                      : styles.roleBadgeCrew,
                ]}
              >
                <Text style={styles.roleText}>
                  {item.role === 'CAPTAIN_MOV' ? 'MOV' : item.role}
                </Text>
              </View>
              {item.contractType === 'temporary' && (
                <View style={styles.contractBadgeTemp}>
                  <Text style={styles.contractBadgeText}>TEMP</Text>
                </View>
              )}
              {item.contractType === 'rotational' && (
                <View style={styles.contractBadgeRotation}>
                  <Text style={styles.contractBadgeText}>Rotation</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const filterLabel =
    contractFilter === 'all'
      ? 'All Crew'
      : contractFilter.charAt(0).toUpperCase() + contractFilter.slice(1);
  const filteredCrew =
    contractFilter === 'all' ? crew : crew.filter((c) => c.contractType === contractFilter);

  const renderHeader = () => (
    <View style={styles.header}>
      {needsUpgrade && (
        <TouchableOpacity
          style={[
            styles.upgradeBanner,
            { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: COLORS.warning },
          ]}
          onPress={() => navigation.navigate('VesselSettings')}
        >
          <Text style={[styles.upgradeBannerText, { color: themeColors.textPrimary }]}>
            You have reached your crew limit ({crew.length}/{currentPlan!.maxCrew}). Upgrade your
            plan to invite more crew members.
          </Text>
        </TouchableOpacity>
      )}

      {/* Rotational Captain Info Banner */}
      <View style={[styles.rotationalInfoBanner, { backgroundColor: themeColors.surface }]}>
        <Text style={[styles.rotationalInfoTitle, { color: themeColors.textPrimary }]}>
          Adding a Rotational Captain?
        </Text>
        <Text style={[styles.rotationalInfoText, { color: themeColors.textSecondary }]}>
          A second captain should join via the Invite Code on the Create Crew Account page — they
          should NOT create a new vessel. Once joined, promote them to Captain/MOV from this screen.
        </Text>
      </View>

      <View style={styles.statsContainer}>
        <View style={[styles.statBox, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.statNumber, { color: themeColors.textPrimary }]}>{crew.length}</Text>
          <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>Total Crew</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.statNumber, { color: themeColors.textPrimary }]}>
            {crew.filter((c) => c.role === 'HOD').length}
          </Text>
          <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>HODs</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.statNumber, { color: themeColors.textPrimary }]}>
            {crew.filter((c) => c.role === 'CREW').length}
          </Text>
          <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>Crew</Text>
        </View>
      </View>

      <View style={[styles.infoCard, { backgroundColor: themeColors.surface, marginBottom: SPACING.md }]}>
        <Text style={[styles.infoText, { color: themeColors.textPrimary, fontWeight: '600', marginBottom: SPACING.xs }]}>
          Designated Watch Keepers
        </Text>
        {watchKeepers.length === 0 ? (
          <Text style={{ color: themeColors.textSecondary, fontSize: FONTS.sm, marginBottom: SPACING.xs }}>
            No watch keepers selected yet.
          </Text>
        ) : (
          watchKeepers.map((wk) => (
            <TouchableOpacity
              key={wk.userId}
              onPress={() => {
                Alert.alert('Remove watch keeper', `Remove ${wk.userName} as a designated watch keeper?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                      if (!currentUser?.vesselId) return;
                      await removeWatchKeeper(currentUser.vesselId, wk.userId);
                      setWatchKeepers((prev) => prev.filter((w) => w.userId !== wk.userId));
                    },
                  },
                ]);
              }}
            >
              <Text style={{ color: themeColors.textPrimary, fontSize: FONTS.sm, marginBottom: 2 }}>
                {'\u2022'} {wk.userName}
              </Text>
            </TouchableOpacity>
          ))
        )}
        <TouchableOpacity
          onPress={() => setWatchKeeperPickerOpen(true)}
          style={{ marginTop: SPACING.xs }}
        >
          <Text style={{ color: COLORS.primary, fontSize: FONTS.sm, fontWeight: '600' }}>+ Add watch keeper</Text>
        </TouchableOpacity>
        {watchKeeperPickerOpen && (
          <Modal visible transparent animationType="fade">
            <Pressable style={styles.modalBackdrop} onPress={() => setWatchKeeperPickerOpen(false)}>
              <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
                <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>Select watch keeper</Text>
                {crew
                  .filter((c) => !watchKeepers.some((wk) => wk.userId === c.id))
                  .map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.modalItem}
                      onPress={async () => {
                        if (!currentUser?.vesselId) return;
                        await addWatchKeeper(currentUser.vesselId, c.id);
                        setWatchKeepers((prev) => [...prev, { userId: c.id, userName: c.name }]);
                        setWatchKeeperPickerOpen(false);
                      }}
                    >
                      <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </Pressable>
          </Modal>
        )}
      </View>

      <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
        <Text style={[styles.infoText, { color: themeColors.textPrimary }]}>
          💡 Tap any crew member to view details and manage their role
        </Text>
      </View>

      {/* Filter row */}
      <TouchableOpacity
        style={[styles.actionRow, { backgroundColor: themeColors.surface }]}
        onPress={() => {
          Alert.alert('Filter Crew', 'Show crew by contract type:', [
            { text: 'All Crew', onPress: () => setContractFilter('all') },
            { text: 'Permanent', onPress: () => setContractFilter('permanent') },
            { text: 'Rotational', onPress: () => setContractFilter('rotational') },
            { text: 'Temporary', onPress: () => setContractFilter('temporary') },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.actionRowLabel, { color: themeColors.textPrimary }]}>
          Filter: {filterLabel}
        </Text>
        <Text style={[styles.actionRowChevron, { color: themeColors.textSecondary }]}>›</Text>
      </TouchableOpacity>

      {/* Rotational Groups row */}
      <TouchableOpacity
        style={[styles.actionRow, { backgroundColor: themeColors.surface }]}
        onPress={() => navigation.navigate('RotationalGroups')}
        activeOpacity={0.7}
      >
        <Text style={[styles.actionRowLabel, { color: COLORS.primary }]}>Rotational Groups</Text>
        <Text style={[styles.actionRowChevron, { color: COLORS.primary }]}>›</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
        {filterLabel} ({filteredCrew.length})
      </Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>👥</Text>
      <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>No Crew Members</Text>
      <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
        Crew members will appear here once they join. Manage invite code in Vessel Settings.
      </Text>
    </View>
  );

  if (!canManageCrew) {
    return null;
  }

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
        <Text style={[styles.loadingText, { color: themeColors.textSecondary }]}>
          Loading crew...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Crew Management" />
      <FlatList
        data={filteredCrew}
        renderItem={renderCrewMember}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.base,
  },
  listContent: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  upgradeBanner: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  upgradeBannerText: {
    fontSize: FONTS.sm,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  statBox: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: FONTS['2xl'],
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: FONTS.xs,
    textAlign: 'center',
  },
  infoCard: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  infoText: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  rotationalInfoBanner: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryLight,
  },
  rotationalInfoTitle: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    marginBottom: 4,
  },
  rotationalInfoText: {
    fontSize: FONTS.xs,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  actionRowLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  actionRowChevron: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '300',
  },
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  crewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  crewCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: SPACING.md,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    fontSize: FONTS.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  crewInfo: {
    flex: 1,
  },
  crewNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  crewName: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginRight: SPACING.xs,
  },
  departmentLabel: {
    fontSize: FONTS.sm,
    marginRight: SPACING.xs,
    flex: 1,
  },
  youBadge: {
    fontSize: FONTS.xs,
    fontWeight: 'bold',
    color: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  crewPosition: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
  },
  crewBadges: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  departmentBadge: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  departmentText: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    color: COLORS.white,
  },
  roleBadge: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  roleBadgeHOD: {
    backgroundColor: COLORS.primary,
  },
  roleBadgeMOV: {
    backgroundColor: '#c9a227', // Gold – Master of Vessel
  },
  roleBadgeCrew: {
    backgroundColor: COLORS.textSecondary,
  },
  roleText: {
    fontSize: FONTS.xs,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  contractBadgeTemp: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#ea580c', // Orange
  },
  contractBadgeRotation: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#0d9488', // Teal
  },
  contractBadgeText: {
    fontSize: FONTS.xs,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl * 2,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: FONTS.base,
    textAlign: 'center',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  modalBox: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, minWidth: 260, maxHeight: 400 },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.sm },
  modalItemSelected: { backgroundColor: COLORS.gray200 },
  modalItemText: { fontSize: FONTS.base },
});
