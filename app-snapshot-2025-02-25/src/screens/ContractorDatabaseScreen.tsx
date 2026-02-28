/**
 * Contractor Database Screen
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import contractorsService, { Contractor } from '../services/contractors';
import { Department } from '../types';
import { Button, Input } from '../components';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

const allDeptsVisible: Record<Department, boolean> = {
  BRIDGE: true,
  ENGINEERING: true,
  EXTERIOR: true,
  INTERIOR: true,
  GALLEY: true,
};

type SearchFilter = 'all' | 'company_name' | 'company_address' | 'known_for' | 'description' | 'contact_name' | 'mobile' | 'email';

const SEARCH_FILTER_OPTIONS: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'company_name', label: 'Company Name' },
  { value: 'company_address', label: 'Company Address' },
  { value: 'known_for', label: 'Know For' },
  { value: 'description', label: 'Description' },
  { value: 'contact_name', label: 'Contact Name' },
  { value: 'mobile', label: 'Mobile Number' },
  { value: 'email', label: 'Email' },
];

export const ContractorDatabaseScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>(allDeptsVisible);
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all');
  const [searchFilterOpen, setSearchFilterOpen] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const matchesKeyword = (c: Contractor) => {
    if (!searchKeyword.trim()) return true;
    const q = searchKeyword.toLowerCase().trim();
    const matchField = (value: string) => (value ?? '').toLowerCase().includes(q);
    switch (searchFilter) {
      case 'company_name':
        return matchField(c.companyName);
      case 'company_address':
        return matchField(c.companyAddress);
      case 'known_for':
        return matchField(c.knownFor);
      case 'description':
        return matchField(c.description);
      case 'contact_name':
        return (c.contacts ?? []).some((contact) => matchField(contact.name));
      case 'mobile':
        return (c.contacts ?? []).some((contact) => matchField(contact.mobile));
      case 'email':
        return (c.contacts ?? []).some((contact) => matchField(contact.email));
      default:
        return (
          matchField(c.knownFor) ||
          matchField(c.companyName) ||
          matchField(c.companyAddress) ||
          matchField(c.description) ||
          (c.contacts ?? []).some(
            (contact) =>
              matchField(contact.name) || matchField(contact.mobile) || matchField(contact.email)
          )
        );
    }
  };

  const filteredContractors = contractors
    .filter((c) => visibleDepartments[c.department ?? 'INTERIOR'])
    .filter(matchesKeyword);
  const departmentDisplayText =
    DEPARTMENTS.every((d) => visibleDepartments[d])
      ? 'All departments'
      : DEPARTMENTS.filter((d) => visibleDepartments[d])
          .map((d) => d.charAt(0) + d.slice(1).toLowerCase())
          .join(', ');

  const loadContractors = useCallback(async () => {
    if (!vesselId) return;
    setLoading(true);
    try {
      const data = await contractorsService.getByVessel(vesselId);
      setContractors(data);
    } catch (e) {
      console.error('Load contractors error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(useCallback(() => {
    loadContractors();
  }, [loadContractors]));

  const onRefresh = () => {
    setRefreshing(true);
    loadContractors();
  };

  const onDelete = (contractor: Contractor) => {
    Alert.alert('Delete contractor', `Delete "${contractor.companyName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await contractorsService.delete(contractor.id);
            loadContractors();
          } catch {
            Alert.alert('Error', 'Could not delete contractor.');
          }
        },
      },
    ]);
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Contractor Database.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
      }
    >
      <View style={styles.searchSection}>
        <View style={styles.searchFilterRow}>
          <Text style={[styles.searchFilterLabel, { color: themeColors.textPrimary }]}>Search by</Text>
          <TouchableOpacity
            style={[styles.searchFilterDropdown, { backgroundColor: themeColors.surface }]}
            onPress={() => setSearchFilterOpen(!searchFilterOpen)}
            activeOpacity={0.7}
          >
            <Text style={[styles.searchFilterText, { color: themeColors.textPrimary }]}>
              {SEARCH_FILTER_OPTIONS.find((o) => o.value === searchFilter)?.label ?? 'All'}
            </Text>
            <Text style={[styles.searchFilterChevron, { color: themeColors.textSecondary }]}>{searchFilterOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {searchFilterOpen && (
            <Modal visible transparent animationType="fade">
              <Pressable style={styles.modalBackdrop} onPress={() => setSearchFilterOpen(false)}>
                <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
                  {SEARCH_FILTER_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.modalItem, { backgroundColor: themeColors.surface }, searchFilter === opt.value && styles.modalItemSelected]}
                      onPress={() => {
                        setSearchFilter(opt.value);
                        setSearchFilterOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalItemText,
                          { color: themeColors.textPrimary },
                          searchFilter === opt.value && styles.modalItemTextSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Pressable>
            </Modal>
          )}
        </View>
        <Input
          value={searchKeyword}
          onChangeText={setSearchKeyword}
          placeholder={
            searchFilter === 'all'
              ? 'Search for Contractor by name or job type'
              : `Search by ${SEARCH_FILTER_OPTIONS.find((o) => o.value === searchFilter)?.label.toLowerCase()}…`
          }
          style={[styles.searchInput, { backgroundColor: themeColors.surface }]}
          returnKeyType="search"
        />
      </View>
      <View style={styles.actionRow}>
        <Button
          title="Create Contractor"
          onPress={() => navigation.navigate('AddEditContractor', {})}
          variant="primary"
          fullWidth
        />
      </View>

      {contractors.length > 0 && !loading && (
        <>
          <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
          <TouchableOpacity
            style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
            onPress={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
            activeOpacity={0.7}
          >
            <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>{departmentDisplayText}</Text>
            <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>{departmentDropdownOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {departmentDropdownOpen && (
            <Modal visible transparent animationType="fade">
              <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentDropdownOpen(false)}>
                <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
                  <TouchableOpacity
                    style={[
                      styles.modalItem,
                      { backgroundColor: themeColors.surface },
                      DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemSelected,
                    ]}
                    onPress={() => {
                      setVisibleDepartments(allDeptsVisible);
                      setDepartmentDropdownOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalItemText,
                        { color: themeColors.textPrimary },
                        DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemTextSelected,
                      ]}
                    >
                      All
                    </Text>
                  </TouchableOpacity>
                  {DEPARTMENTS.map((dept) => (
                    <TouchableOpacity
                      key={dept}
                    style={[styles.modalItem, { backgroundColor: themeColors.surface }, visibleDepartments[dept] && styles.modalItemSelected]}
                    onPress={() => {
                        setVisibleDepartments({
                          BRIDGE: dept === 'BRIDGE',
                          ENGINEERING: dept === 'ENGINEERING',
                          EXTERIOR: dept === 'EXTERIOR',
                          INTERIOR: dept === 'INTERIOR',
                          GALLEY: dept === 'GALLEY',
                        });
                        setDepartmentDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.modalItemText,
                          { color: themeColors.textPrimary },
                          visibleDepartments[dept] && styles.modalItemTextSelected,
                        ]}
                      >
                        {dept.charAt(0) + dept.slice(1).toLowerCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Pressable>
            </Modal>
          )}
        </>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={COLORS.primary} style={styles.loader} />
      ) : filteredContractors.length === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: themeColors.surface }]}>
          <Text style={styles.emptyIcon}>👷</Text>
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>No contractors yet</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            {contractors.length === 0
              ? 'Tap "Create Contractor" to add your first contractor.'
              : 'No contractors match your search or department filter.'}
          </Text>
        </View>
      ) : (
        filteredContractors.map((contractor) => (
          <View key={contractor.id} style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => navigation.navigate('AddEditContractor', { contractorId: contractor.id })}
              activeOpacity={0.8}
            >
              <View style={styles.cardTitleRow}>
                <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
                  {contractor.companyName}
                </Text>
                <View
                  style={[
                    styles.deptBadge,
                    { backgroundColor: getDepartmentColor(contractor.department ?? 'INTERIOR', overrides) },
                  ]}
                >
                  <Text style={styles.deptBadgeText}>
                    {(contractor.department ?? 'INTERIOR').charAt(0) +
                      (contractor.department ?? 'INTERIOR').slice(1).toLowerCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => onDelete(contractor)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('AddEditContractor', { contractorId: contractor.id })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.editBtn}>Edit</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
            {contractor.knownFor ? (
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Know For</Text>
                <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>{contractor.knownFor}</Text>
              </View>
            ) : null}
            {contractor.companyAddress ? (
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Address</Text>
                <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>{contractor.companyAddress}</Text>
              </View>
            ) : null}
            {contractor.description ? (
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Description</Text>
                <Text style={[styles.cardValue, { color: themeColors.textPrimary }]} numberOfLines={2}>{contractor.description}</Text>
              </View>
            ) : null}
            {contractor.contacts.length > 0 && (
              <View style={styles.cardRow}>
                <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Contact(s)</Text>
                {contractor.contacts.map((c, i) => (
                  <Text key={i} style={[styles.cardValue, { color: themeColors.textPrimary }]}>
                    {[c.name, c.mobile, c.email].filter(Boolean).join(' · ')}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  searchSection: { marginBottom: SPACING.sm },
  searchFilterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xs },
  searchFilterLabel: { fontSize: FONTS.sm, fontWeight: '600', marginRight: SPACING.sm },
  searchFilterDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchFilterText: { fontSize: FONTS.base, fontWeight: '500', flex: 1 },
  searchFilterChevron: { fontSize: 10 },
  searchInput: {},
  actionRow: { marginBottom: SPACING.lg },
  filterLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  modalBox: { borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.sm, minWidth: 200 },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  modalItemSelected: {},
  modalItemText: { fontSize: FONTS.base },
  modalItemTextSelected: { color: COLORS.primary, fontWeight: '600' },
  loader: { marginVertical: SPACING.xl },
  emptyState: {
    borderRadius: 12,
    padding: SPACING.xl,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: SPACING.sm },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  deptBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  cardActions: { flexDirection: 'row', gap: SPACING.md },
  editBtn: { fontSize: FONTS.sm, color: COLORS.primary, fontWeight: '600' },
  deleteBtn: { fontSize: FONTS.sm, color: COLORS.danger, fontWeight: '600' },
  cardRow: { marginBottom: SPACING.sm },
  cardLabel: { fontSize: FONTS.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  cardValue: { fontSize: FONTS.base, lineHeight: 20 },
});
