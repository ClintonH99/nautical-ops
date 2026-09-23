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
import { Ionicons } from '@expo/vector-icons';
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
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
          >
            Contractor Details
          </Text>
          <Input
            label="Company Name"
            value={companyName}
            onChangeText={setCompanyName}
            placeholder="e.g. Marine Services Ltd"
            autoCapitalize="words"
          />
          <DepartmentSelector
            value={department}
            onChange={(value) => value && setDepartment(value)}
          />
          <Input
            label="Known For"
            value={knownFor}
            onChangeText={setKnownFor}
            placeholder="e.g. refrigeration and air conditioning"
            autoCapitalize="sentences"
          />
          <Input
            label="Company Address"
            value={companyAddress}
            onChangeText={setCompanyAddress}
            placeholder="Full address"
            autoCapitalize="words"
          />
          <Input
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Services offered and additional information..."
            multiline
            containerStyle={styles.lastField}
          />
        </View>

        {contacts.map((contact, index) => (
          <View
            key={index}
            style={[
              styles.sectionCard,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
              },
            ]}
          >
            <View style={styles.contactHeader}>
              <Text
                style={[
                  styles.sectionTitle,
                  styles.contactTitle,
                  { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                ]}
              >
                {index === 0 ? 'First Contact' : `Additional Contact ${index}`}
              </Text>
              <Text style={[styles.contactCount, { color: themeColors.textSecondary }]}>
                Contact {index + 1}
              </Text>
            </View>
            <Input
              label="Name"
              value={contact.name}
              onChangeText={(v) => setContactAt(index, 'name', v)}
              placeholder="Contact name"
            />
            <Input
              label="Contact Number"
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
            {index > 0 ? (
              <TouchableOpacity
                onPress={() => removeContact(index)}
                style={styles.removeContactBtn}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel={`Delete additional contact ${index}`}
              >
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                <Text style={styles.removeContactText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}

        <TouchableOpacity
          onPress={addContact}
          style={[
            styles.addContactBtn,
            { borderColor: themeColors.isDark ? COLORS.white : COLORS.primary },
          ]}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Add another contact"
        >
          <Ionicons
            name="add"
            size={20}
            color={themeColors.isDark ? COLORS.white : COLORS.primary}
          />
          <Text
            style={[
              styles.addContactText,
              { color: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
          >
            Add Another Contact
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
  sectionCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  lastField: { marginBottom: 0 },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  contactTitle: { flex: 1, marginBottom: 0 },
  contactCount: { fontSize: FONTS.xs, fontWeight: '600' },
  removeContactBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
  },
  removeContactText: { fontSize: FONTS.sm, fontWeight: '600', color: COLORS.danger },
  addContactBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  addContactText: { fontSize: FONTS.sm, fontWeight: '600' },
  actions: { marginTop: SPACING.sm },
});
