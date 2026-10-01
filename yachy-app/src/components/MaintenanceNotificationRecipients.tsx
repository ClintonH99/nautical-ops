import React, { useEffect, useRef, useState } from 'react';
import {
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
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { SPACING, BORDER_RADIUS } from '../constants/theme';
import {
  getMaintenanceRecipients,
  MaintenanceRecipients,
  setMaintenanceRecipients,
} from '../services/maintenanceNotifications';

/** Mounted only for Captain MOV/HOD; RPCs independently enforce the same rule. */
export function MaintenanceNotificationRecipients({ vesselId }: { vesselId: string }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<MaintenanceRecipients | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const request = useRef(0);
  const savingRef = useRef(false);
  useEffect(
    () => () => {
      request.current++;
    },
    []
  );

  const load = async () => {
    const current = ++request.current;
    setOpen(true);
    setLoading(true);
    setSnapshot(null);
    setError('');
    setSaved(false);
    setSearch('');
    try {
      const data = await getMaintenanceRecipients(vesselId);
      if (request.current !== current) return;
      setSnapshot(data);
      // A removed crew member must never survive as an invisible selection.
      setSelected(data.recipientIds.filter((id) => data.crew.some((person) => person.id === id)));
    } catch {
      if (request.current === current) setError('Could not load the crew list. Please try again.');
    } finally {
      if (request.current === current) setLoading(false);
    }
  };
  const close = () => {
    if (savingRef.current) return;
    request.current++;
    setOpen(false);
  };
  const save = async () => {
    if (!snapshot || savingRef.current) return;
    const current = request.current;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await setMaintenanceRecipients(vesselId, selected, snapshot.revision);
      if (request.current === current) {
        setOpen(false);
        setSaved(true);
      }
    } catch (e: unknown) {
      if (request.current === current) {
        const message = String((e as { message?: string })?.message || '');
        setError(
          message.includes('Reload the crew list')
            ? 'The crew or recipient list has changed. Reload the crew list before saving.'
            : 'Could not save recipients. Check your connection and permissions, then try again.'
        );
      }
    } finally {
      savingRef.current = false;
      if (request.current === current) setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Maintenance Notifications"
        onPress={load}
        style={[styles.trigger, { borderColor: colors.border }]}
      >
        <Ionicons name="notifications-outline" size={20} color={colors.accent} />
        <Text style={[styles.triggerText, { color: colors.accent }]}>
          Maintenance Notifications
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>
      {saved && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>
          Notification recipients saved.
        </Text>
      )}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={styles.backdrop}
            onPress={close}
            accessibilityLabel="Close notification recipients"
            accessibilityRole="button"
          />
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityViewIsModal
          >
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              Maintenance Notifications
            </Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              Select the crew members who should receive new and updated Maintenance Log
              notifications.
            </Text>
            {loading && (
              <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>
                Loading crew…
              </Text>
            )}
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={[styles.detail, { color: colors.textPrimary }]}
              >
                {error}
              </Text>
            )}
            {!!error && (
              <Button title="Reload crew list" variant="text" onPress={load} disabled={saving} />
            )}
            {snapshot && (
              <>
                <TextInput
                  accessibilityLabel="Search crew by name"
                  placeholder="Search crew by name"
                  placeholderTextColor={colors.textSecondary}
                  value={search}
                  onChangeText={setSearch}
                  editable={!saving}
                  style={[styles.search, { color: colors.textPrimary, borderColor: colors.border }]}
                  autoCorrect={false}
                />
                <ScrollView
                  style={styles.list}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {snapshot.crew
                    .filter((person) =>
                      person.name.toLowerCase().includes(search.trim().toLowerCase())
                    )
                    .map((person) => {
                      const checked = selected.includes(person.id);
                      return (
                        <Pressable
                          key={person.id}
                          accessibilityRole="checkbox"
                          accessibilityLabel={person.name}
                          accessibilityState={{ checked, disabled: saving }}
                          disabled={saving}
                          onPress={() =>
                            setSelected((previous) =>
                              previous.includes(person.id)
                                ? previous.filter((id) => id !== person.id)
                                : [...previous, person.id]
                            )
                          }
                          style={[styles.person, { borderBottomColor: colors.border }]}
                        >
                          <Text style={[styles.name, { color: colors.textPrimary }]}>
                            {person.name}
                          </Text>
                          <Ionicons
                            name={checked ? 'checkbox' : 'square-outline'}
                            size={25}
                            color={colors.accent}
                          />
                        </Pressable>
                      );
                    })}
                  {!snapshot.crew.some((person) =>
                    person.name.toLowerCase().includes(search.trim().toLowerCase())
                  ) && (
                    <Text style={[styles.detail, { color: colors.textSecondary }]}>
                      No crew members found.
                    </Text>
                  )}
                </ScrollView>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {selected.length
                    ? `${selected.length} crew member${selected.length === 1 ? '' : 's'} selected. Their personal notification settings still apply.`
                    : 'No recipients selected. No Maintenance Log notifications will be sent.'}
                </Text>
              </>
            )}
            <View style={styles.buttons}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={close}
                disabled={saving}
                style={styles.button}
              />
              <Button
                title="Save Recipients"
                onPress={save}
                loading={saving}
                disabled={
                  !snapshot || loading || error.startsWith('The crew or recipient list has changed')
                }
                style={styles.button}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  triggerText: { flex: 1, fontSize: 15, fontWeight: '600' },
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  detail: { fontSize: 14, lineHeight: 20, marginVertical: 10 },
  search: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, marginVertical: 8 },
  list: { flexShrink: 1 },
  person: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    gap: 12,
  },
  name: { flex: 1, fontSize: 16 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  button: { flex: 1 },
});
