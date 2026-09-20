/**
 * Add / Edit Contractor Screen
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import contractorsService, { ContractorContact } from '../services/contractors';
import { Department } from '../types';
import {
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  DepartmentSelector,
  PreviewActionButtons,
} from '../components';

const emptyContact: ContractorContact = { name: '', mobile: '', email: '' };

export const AddEditContractorScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const contractorId = route?.params?.contractorId as string | undefined;
  const isEdit = !!contractorId;

  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [department, setDepartment] = useState<Department>(user?.department ?? 'INTERIOR');
  const [knownFor, setKnownFor] = useState('');
  const [description, setDescription] = useState('');
  const [contacts, setContacts] = useState<ContractorContact[]>([{ ...emptyContact }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const activeOperationRef = useRef<'save' | 'delete' | null>(null);

  const vesselId = user?.vesselId ?? null;

  const loadContractor = useCallback(async () => {
    if (!contractorId || !vesselId) {
      setLoading(false);
      return;
    }
    try {
      const list = await contractorsService.getByVessel(vesselId);
      const contractor = list.find((c) => c.id === contractorId);
      if (contractor) {
        setCompanyName(contractor.companyName);
        setCompanyAddress(contractor.companyAddress);
        setDepartment(contractor.department ?? 'INTERIOR');
        setKnownFor(contractor.knownFor ?? '');
        setDescription(contractor.description);
        setContacts(contractor.contacts.length > 0 ? contractor.contacts : [{ ...emptyContact }]);
      } else {
        Alert.alert('Error', 'Contractor not found.');
        navigation.goBack();
      }
    } catch (e) {
      console.error('Load contractor error:', e);
      Alert.alert('Error', 'Could not load contractor.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [contractorId, vesselId, navigation]);

  useFocusEffect(
    useCallback(() => {
      loadContractor();
    }, [loadContractor])
  );

  const addContact = () => setContacts((prev) => [...prev, { ...emptyContact }]);
  const removeContact = (index: number) => {
    if (contacts.length <= 1) return;
    setContacts((prev) => prev.filter((_, i) => i !== index));
  };
  const setContactAt = (index: number, field: keyof ContractorContact, value: string) => {
    setContacts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    if (saving || deleting || activeOperationRef.current) return;
    if (!companyName.trim()) {
      Alert.alert('Missing company name', 'Please enter the company name.');
      return;
    }
    if (!vesselId) return;
    const trimmedContacts = contacts
      .map((c) => ({
        name: c.name.trim(),
        mobile: c.mobile.trim(),
        email: c.email.trim(),
      }))
      .filter((c) => c.name || c.mobile || c.email);
    activeOperationRef.current = 'save';
    setSaving(true);
    try {
      if (isEdit) {
        await contractorsService.update(contractorId, {
          companyName: companyName.trim(),
          companyAddress: companyAddress.trim(),
          department,
          knownFor: knownFor.trim(),
          description: description.trim(),
          contacts: trimmedContacts,
        });
        Alert.alert('Saved', 'Contractor updated.');
      } else {
        await contractorsService.create({
          vesselId,
          companyName: companyName.trim(),
          companyAddress: companyAddress.trim(),
          department,
          knownFor: knownFor.trim(),
          description: description.trim(),
          contacts: trimmedContacts,
          createdBy: user?.id,
        });
        Alert.alert('Created', 'Contractor added.');
      }
      navigation.goBack();
    } catch (e) {
      console.error('Save contractor error:', e);
      Alert.alert('Error', 'Could not save contractor.');
    } finally {
      activeOperationRef.current = null;
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!isEdit || !contractorId || saving || deleting || activeOperationRef.current) return;
    Alert.alert('Delete contractor', `Delete "${companyName.trim()}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // The confirmation can remain open while another action begins.
          // Claim the operation synchronously so Save and Delete cannot race.
          if (activeOperationRef.current) return;
          activeOperationRef.current = 'delete';
          setDeleting(true);
          try {
            await contractorsService.delete(contractorId);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete contractor.');
          } finally {
            activeOperationRef.current = null;
            setDeleting(false);
          }
        },
      },
    ]);
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to manage contractors.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title={isEdit ? 'Edit Contractor' : 'Create Contractor'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <DepartmentSelector
          value={department}
          onChange={(value) => value && setDepartment(value)}
        />
        <Input
          label="Company Name"
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="e.g. Marine Services Ltd"
          autoCapitalize="words"
        />
        <Input
          label="Company Address"
          value={companyAddress}
          onChangeText={setCompanyAddress}
          placeholder="Full address"
          autoCapitalize="words"
        />
        <Input
          label="Known For"
          value={knownFor}
          onChangeText={setKnownFor}
          placeholder="e.g. plumbing, electrical, refrigeration (keywords for search)"
          autoCapitalize="none"
        />
        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Services offered, notes…"
          multiline
        />

        <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>
          Contact Person(s)
        </Text>
        {contacts.map((contact, index) => (
          <View
            key={index}
            style={[
              styles.contactBlock,
              {
                backgroundColor: themeColors.surfaceElevated,
                borderColor: themeColors.border,
              },
            ]}
          >
            <Text style={[styles.contactBlockLabel, { color: themeColors.textSecondary }]}>
              Contact {index + 1}
            </Text>
            <Input
              label="Name"
              value={contact.name}
              onChangeText={(v) => setContactAt(index, 'name', v)}
              placeholder="Contact name"
            />
            <Input
              label="Mobile Number"
              value={contact.mobile}
              onChangeText={(v) => setContactAt(index, 'mobile', v)}
              placeholder="e.g. +1 234 567 8900"
              keyboardType="phone-pad"
            />
            <Input
              label="Email"
              value={contact.email}
              onChangeText={(v) => setContactAt(index, 'email', v)}
              placeholder="email@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={() => removeContact(index)}
              style={styles.removeContactBtn}
              disabled={contacts.length <= 1}
            >
              <Text
                style={[
                  styles.removeContactText,
                  { color: contacts.length <= 1 ? themeColors.textSecondary : COLORS.danger },
                ]}
              >
                Remove contact
              </Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={addContact} style={styles.addContactBtn}>
          <Text style={[styles.addContactText, { color: themeColors.accent }]}>
            + Add contact person
          </Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Create Contractor'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving || deleting}
            fullWidth
          />
          {isEdit && (
            <PreviewActionButtons
              onDelete={handleDelete}
              deleteLabel="Delete Contractor"
              deleting={deleting}
              disabled={saving || deleting}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
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
  modalBox: { borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.sm, minWidth: 200 },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  modalItemSelected: {},
  modalItemText: { fontSize: FONTS.base },
  modalItemTextSelected: { color: COLORS.primary, fontWeight: '600' },
  sectionLabel: {
    fontSize: FONTS.sm,
    fontWeight: '700',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  contactBlock: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  contactBlockLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  removeContactBtn: { marginTop: SPACING.xs },
  removeContactText: { fontSize: FONTS.sm, color: COLORS.danger },
  removeContactDisabled: { color: COLORS.textTertiary },
  addContactBtn: { paddingVertical: SPACING.sm, marginBottom: SPACING.lg },
  addContactText: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.primary },
  actions: { marginTop: SPACING.xl },
});
