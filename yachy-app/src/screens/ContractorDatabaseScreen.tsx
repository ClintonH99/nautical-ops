import { optimisticDelete } from '../utils/optimisticDelete';
import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Contractor Database Screen
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
  Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import contractorsService, { Contractor } from '../services/contractors';
import { Department } from '../types';
import {
  Button,
  DepartmentMultiSelector,
  Input,
  PageHeader,
  PreviewActionButtons,
} from '../components';
import { DEPARTMENT_OPTIONS as DEPARTMENTS } from '../utils/departmentSelection';
import { formatContractorContactCard } from '../utils/contractorContactCard';

const allDeptsVisible: Record<Department, boolean> = {
  BRIDGE: true,
  ENGINEERING: true,
  EXTERIOR: true,
  INTERIOR: true,
  GALLEY: true,
};

type SearchFilter =
  | 'all'
  | 'company_name'
  | 'company_address'
  | 'known_for'
  | 'description'
  | 'contact_name'
  | 'mobile'
  | 'email';

const SEARCH_FILTER_OPTIONS: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'company_name', label: 'Company Name' },
  { value: 'company_address', label: 'Company Address' },
  { value: 'known_for', label: 'Known For' },
  { value: 'description', label: 'Description' },
  { value: 'contact_name', label: 'Contact Name' },
  { value: 'mobile', label: 'Mobile Number' },
  { value: 'email', label: 'Email' },
];

const CONTRACTOR_DATABASE_INFO = {
  title: 'Contractor Database',
  description: 'Keep contractor and supplier contacts on file.',
  features: [
    'Store contractor contact details',
    'Reference trusted suppliers quickly',
    'Keep records for recurring services',
    'Update entries as contacts change',
  ],
};

export const ContractorDatabaseScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [contractors, setContractors] = useScreenState<Contractor[]>('contractors', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] =
    useState<Record<Department, boolean>>(allDeptsVisible);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all');
  const [searchFilterOpen, setSearchFilterOpen] = useState(false);
  const [expandedContractorId, setExpandedContractorId] = useState<string | null>(null);
  const loadedVesselIdRef = useRef<string | null>(user?.vesselId ?? null);

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
  const loadContractors = useCallback(async () => {
    if (!vesselId) return;
    if (loadedVesselIdRef.current !== vesselId) {
      loadedVesselIdRef.current = vesselId;
      setContractors([]);
      setLoading(true);
    }
    try {
      const data = await contractorsService.getByVessel(vesselId);
      setContractors(data);
    } catch (e) {
      console.error('Load contractors error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setContractors, setLoading, vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadContractors();
    }, [loadContractors])
  );

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
            await optimisticDelete(contractor, setContractors, () =>
              contractorsService.delete(contractor.id)
            );
          } catch {
            Alert.alert('Error', 'Could not delete contractor.');
          }
        },
      },
    ]);
  };

  const onShare = async (contractor: Contractor) => {
    try {
      await Share.share({
        title: contractor.companyName
          ? `${contractor.companyName} Contact Card`
          : 'Contractor Contact Card',
        message: formatContractorContactCard(contractor),
      });
    } catch (error) {
      console.error('Share contractor contact error:', error);
      Alert.alert('Could not share contact card', 'Please try again.');
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Contractor Database.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader
        title="Contractor Database"
        info={CONTRACTOR_DATABASE_INFO}
        infoScreenKey="contractor_database"
      />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        <View style={styles.actionRow}>
          <Button
            title="Create Contact"
            onPress={() => navigation.navigate('AddEditContractor', {})}
            variant="primary"
            fullWidth
          />
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchFilterRow}>
            <TouchableOpacity
              style={[
                styles.searchFilterDropdown,
                {
                  backgroundColor: themeColors.control,
                  borderColor: themeColors.border,
                },
              ]}
              onPress={() => setSearchFilterOpen(!searchFilterOpen)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.searchFilterText,
                  { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                ]}
                numberOfLines={1}
              >
                {SEARCH_FILTER_OPTIONS.find((o) => o.value === searchFilter)?.label ?? 'All'}
              </Text>
              <Ionicons
                name={searchFilterOpen ? 'chevron-up' : 'chevron-down'}
                size={17}
                color={themeColors.isDark ? COLORS.white : COLORS.primary}
              />
            </TouchableOpacity>
            {searchFilterOpen && (
              <Modal visible transparent animationType="fade">
                <View style={styles.modalBackdrop}>
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => setSearchFilterOpen(false)}
                  />
                  <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]}>
                    <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                      Search by
                    </Text>
                    <ScrollView style={styles.searchFilterList} showsVerticalScrollIndicator>
                      {SEARCH_FILTER_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt.value}
                          style={[
                            styles.modalItem,
                            searchFilter === opt.value && styles.modalItemSelected,
                          ]}
                          onPress={() => {
                            setSearchFilter(opt.value);
                            setSearchFilterOpen(false);
                          }}
                        >
                          <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            )}
            <Input
              value={searchKeyword}
              onChangeText={setSearchKeyword}
              placeholder="Search contractors..."
              leftIcon={<Ionicons name="search" size={18} color={themeColors.textMuted} />}
              containerStyle={styles.searchInputContainer}
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
        </View>

        {contractors.length > 0 && !loading && (
          <>
            <DepartmentMultiSelector
              value={DEPARTMENTS.filter((department) => visibleDepartments[department])}
              onChange={(departments) =>
                setVisibleDepartments(
                  DEPARTMENTS.reduce(
                    (next, department) => ({
                      ...next,
                      [department]: departments.includes(department),
                    }),
                    {} as Record<Department, boolean>
                  )
                )
              }
              includeAll
              minSelections={1}
            />
          </>
        )}

        {loading ? (
          <ActivityIndicator size="small" color={COLORS.primary} style={styles.loader} />
        ) : filteredContractors.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.emptyIcon}>👷</Text>
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
              No contractors yet
            </Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              {contractors.length === 0
                ? 'Tap "Create Contact" to add your first contractor contact.'
                : 'No contractors match your search or department filter.'}
            </Text>
          </View>
        ) : (
          filteredContractors.map((contractor) => {
            const isExpanded = expandedContractorId === contractor.id;
            const firstContact = contractor.contacts[0];
            const additionalContacts = contractor.contacts.slice(1);
            const department = contractor.department ?? 'INTERIOR';
            const departmentLabel = department.charAt(0) + department.slice(1).toLowerCase();

            return (
              <View
                key={contractor.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: themeColors.surface,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.cardSummaryButton}
                  onPress={() =>
                    setExpandedContractorId((current) =>
                      current === contractor.id ? null : contractor.id
                    )
                  }
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityLabel={`${contractor.knownFor || 'Contractor'}, ${isExpanded ? 'collapse details' : 'expand details'}`}
                >
                  <View style={styles.cardSummary}>
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                        Known For
                      </Text>
                      <Text
                        style={[
                          styles.knownForValue,
                          { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                        ]}
                      >
                        {contractor.knownFor || 'Not provided'}
                      </Text>
                    </View>
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                        First Contact
                      </Text>
                      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>
                        {firstContact?.name || 'Not provided'}
                      </Text>
                    </View>
                    <View style={styles.cardRow}>
                      <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                        Contact Number
                      </Text>
                      <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>
                        {firstContact?.mobile || 'Not provided'}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={themeColors.textSecondary}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={[styles.expandedDetails, { borderTopColor: themeColors.border }]}>
                    <View style={styles.companyRow}>
                      <Text
                        style={[
                          styles.companyName,
                          { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                        ]}
                      >
                        {contractor.companyName}
                      </Text>
                      <View style={[styles.deptBadge, { backgroundColor: themeColors.accentSoft }]}>
                        <Text
                          style={[
                            styles.deptBadgeText,
                            { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                          ]}
                        >
                          {departmentLabel}
                        </Text>
                      </View>
                    </View>

                    {contractor.description ? (
                      <View style={styles.detailBlock}>
                        <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                          Description
                        </Text>
                        <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>
                          {contractor.description}
                        </Text>
                      </View>
                    ) : null}

                    {contractor.companyAddress ? (
                      <View style={styles.detailBlock}>
                        <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                          Company Address
                        </Text>
                        <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>
                          {contractor.companyAddress}
                        </Text>
                      </View>
                    ) : null}

                    {firstContact?.email ? (
                      <View style={styles.detailBlock}>
                        <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                          Email
                        </Text>
                        <Text style={[styles.cardValue, { color: themeColors.textPrimary }]}>
                          {firstContact.email}
                        </Text>
                      </View>
                    ) : null}

                    {additionalContacts.length > 0 ? (
                      <View style={styles.detailBlock}>
                        <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>
                          Additional Contacts
                        </Text>
                        {additionalContacts.map((contact, index) => (
                          <Text
                            key={`${contact.name}-${contact.mobile}-${index}`}
                            style={[styles.cardValue, { color: themeColors.textPrimary }]}
                          >
                            {[contact.name, contact.mobile, contact.email]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={[styles.shareButton, { backgroundColor: themeColors.controlSelected }]}
                      onPress={() => onShare(contractor)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Share Contact Card"
                    >
                      <Ionicons name="share-social-outline" size={18} color={COLORS.white} />
                      <Text style={styles.shareButtonText}>Share Contact Card</Text>
                    </TouchableOpacity>

                    <PreviewActionButtons
                      onEdit={() =>
                        navigation.navigate('AddEditContractor', { contractorId: contractor.id })
                      }
                      onDelete={() => onDelete(contractor)}
                    />
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  searchSection: { marginBottom: SPACING.sm },
  searchFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  searchFilterDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 116,
    minHeight: SIZES.inputHeight,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  searchFilterText: { fontSize: FONTS.sm, fontWeight: '600', flexShrink: 1 },
  searchInputContainer: { flex: 1, marginBottom: 0 },
  searchInput: {},
  actionRow: { marginBottom: SPACING.md },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, minWidth: 260, maxHeight: 400 },
  searchFilterList: { maxHeight: 300 },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '600', marginBottom: SPACING.md },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.sm,
  },
  modalItemSelected: { backgroundColor: COLORS.gray200 },
  modalItemText: { fontSize: FONTS.base },
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
    borderWidth: 1,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardSummaryButton: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  cardSummary: {
    flex: 1,
    gap: SPACING.md,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  companyName: { flex: 1, fontSize: FONTS.base, fontWeight: '700' },
  deptBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm },
  deptBadgeText: { fontSize: FONTS.xs, fontWeight: '600' },
  cardRow: {},
  cardLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  knownForValue: { fontSize: FONTS.lg, fontWeight: '700', lineHeight: 23 },
  cardValue: { fontSize: FONTS.base, lineHeight: 22 },
  expandedDetails: {
    gap: SPACING.md,
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
  },
  detailBlock: { gap: 2 },
  shareButton: {
    minHeight: SIZES.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  shareButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
});
