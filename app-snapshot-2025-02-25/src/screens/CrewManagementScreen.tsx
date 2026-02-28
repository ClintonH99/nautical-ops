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
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor as getDeptColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import userService from '../services/user';
import { User, Department } from '../types';

export const CrewManagementScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user: currentUser } = useAuthStore();
  const [crew, setCrew] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check if user is HOD
  const isHOD = currentUser?.role === 'HOD';

  useFocusEffect(
    useCallback(() => {
      if (!isHOD) {
        Alert.alert(
          'Access Denied',
          'Only HODs can access crew management',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        return;
      }

      loadData();
    }, [isHOD])
  );

  const loadData = async () => {
    if (!currentUser?.vesselId) return;

    try {
      const crewData = await userService.getVesselCrew(currentUser.vesselId);
      setCrew(crewData);
    } catch (error) {
      console.error('Load data error:', error);
      Alert.alert('Error', 'Failed to load crew members');
    } finally {
      setIsLoading(false);
    }
  };

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
      `${action === 'promote' 
        ? `Promote ${crewMember.name} to Head of Department (HOD)? They will have full management permissions.`
        : `Demote ${crewMember.name} to regular crew? They will lose HOD permissions.`
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'promote' ? 'Promote' : 'Demote',
          onPress: async () => {
            try {
              await userService.updateUserRole(crewMember.id, newRole);
              Alert.alert(
                'Success',
                `${crewMember.name} has been ${action}d to ${newRole}`
              );
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

  const overrides = useDepartmentColorStore((s) => s.overrides);
  const getDepartmentColor = (department: Department) =>
    getDeptColor(department, overrides);

  const renderCrewMember = ({ item }: { item: User }) => {
    const isCurrentUser = item.id === currentUser?.id;

    return (
      <TouchableOpacity
        style={[styles.crewCard, { backgroundColor: themeColors.surface }]}
        onPress={() => {
          Alert.alert(
            item.name,
            `${item.position}\n${item.department}\n\nEmail: ${item.email}\nRole: ${item.role}`,
            [
              { text: 'Close', style: 'cancel' },
              ...(!isCurrentUser
                ? [
                    {
                      text: item.role === 'HOD' ? 'Demote' : 'Promote',
                      onPress: () => handlePromoteToDemote(item),
                    },
                    {
                      text: 'Remove',
                      onPress: () => handleRemoveCrew(item),
                      style: 'destructive' as const,
                    },
                  ]
                : []),
            ]
          );
        }}
        activeOpacity={0.7}
      >
        <View style={styles.crewCardLeft}>
          {item.profilePhoto ? (
            <Image source={{ uri: item.profilePhoto }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.crewInfo}>
            <View style={styles.crewNameRow}>
              <Text style={[styles.crewName, { color: themeColors.textPrimary }]}>{item.name}</Text>
              {isCurrentUser && <Text style={styles.youBadge}>YOU</Text>}
            </View>
            <Text style={[styles.crewPosition, { color: themeColors.textSecondary }]}>{item.position}</Text>
            <View style={styles.crewBadges}>
              <View
                style={[
                  styles.departmentBadge,
                  { backgroundColor: getDepartmentColor(item.department) },
                ]}
              >
                <Text style={styles.departmentText}>{item.department}</Text>
              </View>
              <View
                style={[
                  styles.roleBadge,
                  item.role === 'HOD' ? styles.roleBadgeHOD : styles.roleBadgeCrew,
                ]}
              >
                <Text style={styles.roleText}>{item.role}</Text>
              </View>
            </View>
          </View>
        </View>

        {!isCurrentUser && (
          <TouchableOpacity
            style={styles.optionsButton}
            onPress={() => {
              Alert.alert(
                'Manage ' + item.name,
                'Choose an action',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: item.role === 'HOD' ? 'Demote to Crew' : 'Promote to HOD',
                    onPress: () => handlePromoteToDemote(item),
                  },
                  {
                    text: 'Remove from Vessel',
                    onPress: () => handleRemoveCrew(item),
                    style: 'destructive',
                  },
                ]
              );
            }}
          >
            <Text style={[styles.optionsIcon, { color: themeColors.textSecondary }]}>⋮</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
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

      <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
        <Text style={[styles.infoText, { color: themeColors.textPrimary }]}>
          💡 Tap any crew member to view details and manage their role
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>Crew Members</Text>
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

  if (!isHOD) {
    return null;
  }

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[styles.loadingText, { color: themeColors.textSecondary }]}>Loading crew...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <FlatList
        data={crew}
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
    backgroundColor: '#F59E0B', // Amber
  },
  roleBadgeCrew: {
    backgroundColor: COLORS.textSecondary,
  },
  roleText: {
    fontSize: FONTS.xs,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  optionsButton: {
    padding: SPACING.sm,
  },
  optionsIcon: {
    fontSize: 20,
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
});
