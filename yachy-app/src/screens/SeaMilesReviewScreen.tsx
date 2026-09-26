import { ScreenLoading } from '../components/ScreenLoading';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  ButtonTagCard,
  ButtonTagRow,
  Input,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import seaMilesService from '../services/seaMiles';
import { getSignatureForUser } from '../services/signatures';
import { useAuthStore } from '../store';
import type { CaptainSeaMileContact, SeaMileEntry } from '../types';
import { formatLocalDateString } from '../utils';
import { isMasterOfVessel } from '../utils/access';

const REVIEW_INFO = {
  title: 'Sign Off Sea Miles',
  description: 'Review sea-service entries submitted by crew on your vessel.',
  features: [
    'Save your contact details once for sea-mile verification',
    'Check and edit submitted details before making a decision',
    'Approval permanently locks the entry with your saved e-signature',
    'Declining requires a comment so the crew member can correct the entry',
  ],
};

function amount(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(value).replace(/0+$/, '').replace(/\.$/, '');
}

export const SeaMilesReviewScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [entries, setEntries] = useScreenState<SeaMileEntry[]>('entries', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [decliningEntry, setDecliningEntry] = useState<SeaMileEntry | null>(null);
  const [declineComment, setDeclineComment] = useState('');
  const [captainContact, setCaptainContact] = useScreenState<CaptainSeaMileContact | null>(
    'captainContact',
    null
  );
  const [editingContact, setEditingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cellNumber, setCellNumber] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  const scrollContactFormToBottom = useCallback(() => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 250);
  }, []);

  const applyContactToForm = useCallback((contact: CaptainSeaMileContact | null) => {
    setFirstName(contact?.firstName ?? '');
    setLastName(contact?.lastName ?? '');
    setCellNumber(contact?.cellNumber ?? '');
    setEmailAddress(contact?.emailAddress ?? '');
  }, []);

  const loadEntries = useCallback(async () => {
    if (!user?.vesselId || !isMasterOfVessel(user)) {
      setLoading(false);
      return;
    }
    try {
      const [pendingEntries, savedContact] = await Promise.all([
        seaMilesService.getPendingForVessel(user.vesselId),
        seaMilesService.getCaptainContact(user.id),
      ]);
      setEntries(pendingEntries);
      setCaptainContact(savedContact);
      applyContactToForm(savedContact);
      if (!savedContact) setEditingContact(true);
    } catch (error) {
      console.error('Load sea-mile review queue error:', error);
      Alert.alert('Error', 'The sea-mile review queue could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyContactToForm, setCaptainContact, setEntries, setLoading, user]);

  useFocusEffect(
    useCallback(() => {
      void loadEntries();
    }, [loadEntries])
  );

  const approve = async (entry: SeaMileEntry) => {
    if (!user?.id) return;
    if (!captainContact) {
      setEditingContact(true);
      Alert.alert(
        'Captain contact details required',
        'Save your contact details before approving sea miles.'
      );
      return;
    }
    let signature;
    try {
      signature = await getSignatureForUser(user.id);
    } catch (error) {
      console.error('Load approval signature error:', error);
      Alert.alert('Could not check signature', 'Please check your connection and try again.');
      return;
    }
    if (!signature) {
      Alert.alert('E-signature required', 'Set up your e-signature before approving sea miles.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set Up Signature', onPress: () => navigation.navigate('SignatureSetup') },
      ]);
      return;
    }

    Alert.alert(
      'Approve sea miles',
      `Approve ${entry.ownerName ?? 'this crew member'}’s ${amount(entry.milesLogged)} NM entry? This permanently locks the record.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setWorkingId(entry.id);
            try {
              await seaMilesService.approve(entry.id);
              await loadEntries();
            } catch (error: any) {
              Alert.alert('Could not approve', error?.message || 'Please try again.');
            } finally {
              setWorkingId(null);
            }
          },
        },
      ]
    );
  };

  const saveCaptainContact = async () => {
    if (!user?.id) return;
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanCellNumber = cellNumber.trim();
    const cleanEmailAddress = emailAddress.trim().toLowerCase();

    if (!cleanFirstName || !cleanLastName) {
      Alert.alert('Name required', 'Enter the captain’s first name and last name.');
      return;
    }
    if (!cleanCellNumber && !cleanEmailAddress) {
      Alert.alert(
        'Contact method required',
        'Enter a cell number with area code, an email address, or both.'
      );
      return;
    }
    if (cleanEmailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmailAddress)) {
      Alert.alert('Check email address', 'Enter a valid email address.');
      return;
    }

    setSavingContact(true);
    try {
      const saved = await seaMilesService.saveCaptainContact(user.id, {
        firstName: cleanFirstName,
        lastName: cleanLastName,
        cellNumber: cleanCellNumber || null,
        emailAddress: cleanEmailAddress || null,
      });
      setCaptainContact(saved);
      applyContactToForm(saved);
      setEditingContact(false);
    } catch (error: any) {
      console.error('Save captain sea-mile contact error:', error);
      Alert.alert('Could not save contact details', error?.message || 'Please try again.');
    } finally {
      setSavingContact(false);
    }
  };

  const cancelContactEdit = () => {
    applyContactToForm(captainContact);
    setEditingContact(false);
  };

  const decline = async () => {
    if (!decliningEntry || !declineComment.trim()) {
      Alert.alert('Comment required', 'Explain what the crew member needs to correct.');
      return;
    }
    setWorkingId(decliningEntry.id);
    try {
      await seaMilesService.decline(decliningEntry.id, declineComment);
      setDecliningEntry(null);
      setDeclineComment('');
      await loadEntries();
    } catch (error: any) {
      Alert.alert('Could not decline', error?.message || 'Please try again.');
    } finally {
      setWorkingId(null);
    }
  };

  if (!isMasterOfVessel(user)) return null;

  if (loading) {
    return <ScreenLoading title="Sign Off Sea Miles" />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader
        title="Sign Off Sea Miles"
        info={REVIEW_INFO}
        infoScreenKey="sign_off_sea_miles"
      />
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadEntries();
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={[styles.contactCard, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.contactTitle, { color: themeColors.textPrimary }]}>
            Captain’s Contact Details
          </Text>
          <Text style={[styles.contactHint, { color: themeColors.textSecondary }]}>
            These details are added to approved sea-mile records for verification. Enter a cell
            number with area code, an email address, or both.
          </Text>

          {editingContact ? (
            <View>
              <Input
                label="First Name"
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Captain’s first name"
                autoCapitalize="words"
                maxLength={80}
              />
              <Input
                label="Last Name"
                value={lastName}
                onChangeText={setLastName}
                placeholder="Captain’s last name"
                autoCapitalize="words"
                maxLength={80}
              />
              <Input
                label="Cell Number with Area Code"
                value={cellNumber}
                onChangeText={setCellNumber}
                placeholder="e.g. +1 954 555 0148"
                keyboardType="phone-pad"
                maxLength={40}
              />
              <Input
                label="Email Address"
                value={emailAddress}
                onChangeText={setEmailAddress}
                placeholder="e.g. captain@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={254}
                onFocus={scrollContactFormToBottom}
              />
              <View style={styles.contactActions}>
                {captainContact ? (
                  <Button
                    title="Cancel"
                    variant="outline"
                    onPress={cancelContactEdit}
                    style={styles.contactAction}
                    disabled={savingContact}
                  />
                ) : null}
                <Button
                  title="Save Changes"
                  onPress={() => void saveCaptainContact()}
                  style={styles.contactAction}
                  loading={savingContact}
                />
              </View>
            </View>
          ) : captainContact ? (
            <View>
              <ButtonTagRow
                label="Captain"
                value={`${captainContact.firstName} ${captainContact.lastName}`}
              />
              {captainContact.cellNumber ? (
                <ButtonTagRow label="Cell Number" value={captainContact.cellNumber} />
              ) : null}
              {captainContact.emailAddress ? (
                <ButtonTagRow label="Email Address" value={captainContact.emailAddress} />
              ) : null}
              <Button
                title="Edit Contact Details"
                variant="outline"
                onPress={() => setEditingContact(true)}
                fullWidth
                style={styles.editContactButton}
              />
            </View>
          ) : null}
        </View>

        {!entries.length ? (
          <View style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
              Nothing awaiting review
            </Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              Submitted crew sea miles will appear here.
            </Text>
          </View>
        ) : (
          entries.map((entry) => (
            <ButtonTagCard
              key={entry.id}
              headerTitle={entry.ownerName ?? 'Crew member'}
              collapsible
              expanded={expandedId === entry.id}
              onToggleExpand={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
              accentColor={COLORS.warning}
              summary={
                <Text style={[styles.summary, { color: themeColors.textSecondary }]}>
                  {formatLocalDateString(entry.voyageDate)} • {entry.vesselName} •{' '}
                  {amount(entry.milesLogged)} NM
                </Text>
              }
            >
              <ButtonTagRow
                label="Vessel Name & Length"
                value={`${entry.vesselName} • ${entry.vesselLength}`}
              />
              <ButtonTagRow
                label="From / To"
                value={`${entry.fromLocation} → ${entry.toLocation}`}
              />
              <ButtonTagRow label="Capacity / Role" value={entry.capacityRole} />
              <ButtonTagRow label="Miles Logged" value={`${amount(entry.milesLogged)} NM`} />
              <ButtonTagRow
                label="Day / Night Hours"
                value={`${amount(entry.dayHours)} / ${amount(entry.nightHours)}`}
              />
              <ButtonTagRow label="Tidal" value={entry.tidal ? 'Yes' : 'No'} />
              <View style={styles.actions}>
                <Button
                  title="Edit"
                  variant="outline"
                  size="small"
                  onPress={() =>
                    navigation.navigate('AddEditSeaMile', { entryId: entry.id, reviewMode: true })
                  }
                  style={styles.action}
                  disabled={workingId === entry.id}
                />
                <Button
                  title="Decline"
                  variant="danger"
                  size="small"
                  onPress={() => {
                    setDecliningEntry(entry);
                    setDeclineComment('');
                  }}
                  style={styles.action}
                  disabled={workingId === entry.id}
                />
                <Button
                  title="Approve"
                  size="small"
                  onPress={() => void approve(entry)}
                  style={styles.action}
                  loading={workingId === entry.id}
                />
              </View>
            </ButtonTagCard>
          ))
        )}
      </ScrollView>

      <Modal visible={!!decliningEntry} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDecliningEntry(null)} />
          <View style={[styles.modalBox, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              Decline Sea Miles
            </Text>
            <Text style={[styles.modalHint, { color: themeColors.textSecondary }]}>
              Tell the crew member what must be corrected.
            </Text>
            <TextInput
              value={declineComment}
              onChangeText={setDeclineComment}
              placeholder="Reason for declining"
              placeholderTextColor={themeColors.textSecondary}
              multiline
              maxLength={1000}
              autoFocus
              style={[
                styles.commentInput,
                { color: themeColors.textPrimary, backgroundColor: themeColors.background },
              ]}
            />
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setDecliningEntry(null)}
                style={styles.action}
              />
              <Button
                title="Send Back"
                variant="danger"
                onPress={() => void decline()}
                loading={!!workingId}
                style={styles.action}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  contactCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  contactTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.xs },
  contactHint: { fontSize: FONTS.sm, lineHeight: 20, marginBottom: SPACING.lg },
  contactActions: { flexDirection: 'row', gap: SPACING.sm },
  contactAction: { flex: 1, paddingHorizontal: SPACING.xs },
  editContactButton: { marginTop: SPACING.sm },
  emptyCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.xl, alignItems: 'center' },
  emptyTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sm, textAlign: 'center' },
  summary: { fontSize: FONTS.sm },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  action: { flex: 1, paddingHorizontal: SPACING.xs },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalBox: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.xs },
  modalHint: { fontSize: FONTS.sm, marginBottom: SPACING.md },
  commentInput: {
    minHeight: 110,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    textAlignVertical: 'top',
    fontSize: FONTS.base,
  },
  modalActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
});
