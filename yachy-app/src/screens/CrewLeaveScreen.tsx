/**
 * Crew Leave
 * Vessel-wide leave calendar/list. Everyone onboard may view it; only an HOD
 * or Captain/MOV may create, edit, or delete entries.
 */

import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, ButtonTagCard, ButtonTagRow, LoadingSpinner, PageHeader } from '../components';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { CREW_LEAVE_COLORS, CREW_LEAVE_LABELS } from '../constants/crewLeave';
import { useThemeColors } from '../hooks/useThemeColors';
import crewLeaveService from '../services/crewLeave';
import { useAuthStore } from '../store';
import type { CrewLeave } from '../types';
import { formatLocalDateString, toYYYYMMDD } from '../utils';

const CREW_LEAVE_INFO = {
  title: 'Crew Leave',
  description: 'See scheduled leave for everyone onboard.',
  features: [
    'View annual, sick, rotation and other leave on the vessel calendar',
    'Captain/MOV and HODs can allocate leave to any onboard crew member',
    'The selected crew member is notified when leave is published or updated',
  ],
};

function getLeaveStatus(leave: CrewLeave): string {
  const today = toYYYYMMDD(new Date());
  if (leave.endDate < today) return 'Completed';
  if (leave.startDate > today) return 'Upcoming';
  return 'Currently on leave';
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = formatLocalDateString(startDate);
  const end = formatLocalDateString(endDate);
  return startDate === endDate ? start : `${start} – ${end}`;
}

export const CrewLeaveScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [leave, setLeave] = useState<CrewLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const vesselId = user?.vesselId ?? null;
  const canManage = user?.role === 'CAPTAIN_MOV' || user?.role === 'HOD';

  const loadLeave = useCallback(async () => {
    if (!vesselId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setLeave(await crewLeaveService.getByVessel(vesselId));
    } catch (error) {
      console.error('Load crew leave error:', error);
      Alert.alert('Unable to load crew leave', 'Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      void loadLeave();
    }, [loadLeave])
  );

  const handleDelete = (item: CrewLeave) => {
    Alert.alert(
      'Delete crew leave',
      `Delete ${CREW_LEAVE_LABELS[item.leaveType].toLowerCase()} for ${item.crewMemberName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await crewLeaveService.delete(item.id);
              await loadLeave();
            } catch {
              Alert.alert('Error', 'Crew leave could not be deleted.');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: CrewLeave }) => (
    <ButtonTagCard
      headerTitle={item.crewMemberName}
      accentColor={CREW_LEAVE_COLORS[item.leaveType]}
      collapsible
      expanded={expandedId === item.id}
      onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
      onEdit={
        canManage ? () => navigation.navigate('AddEditCrewLeave', { leaveId: item.id }) : undefined
      }
      onDelete={canManage ? () => handleDelete(item) : undefined}
      summary={<ButtonTagRow label="Dates" value={formatDateRange(item.startDate, item.endDate)} />}
    >
      <ButtonTagRow label="Leave type" value={CREW_LEAVE_LABELS[item.leaveType]} />
      <ButtonTagRow label="Status" value={getLeaveStatus(item)} />
      <ButtonTagRow label="Position" value={item.crewMemberPosition ?? ''} />
      <ButtonTagRow
        label="Department"
        value={
          item.crewMemberDepartment
            ? item.crewMemberDepartment.charAt(0) + item.crewMemberDepartment.slice(1).toLowerCase()
            : ''
        }
      />
      <ButtonTagRow label="Notes" value={item.notes} />
    </ButtonTagCard>
  );

  return (
    <View style={[styles.page, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Crew Leave"
        info={CREW_LEAVE_INFO}
        infoScreenKey="crew-leave"
        actions={
          canManage ? (
            <Button
              title="Create"
              size="small"
              shape="pill"
              onPress={() => navigation.navigate('AddEditCrewLeave')}
            />
          ) : undefined
        }
      />
      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : !vesselId ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Join a vessel to view crew leave.
          </Text>
        </View>
      ) : (
        <FlatList
          data={leave}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, leave.length === 0 && styles.emptyList]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadLeave();
              }}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <Text style={[styles.message, { color: themeColors.textSecondary }]}>
              No crew leave has been published yet.
            </Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  list: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  message: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
});
