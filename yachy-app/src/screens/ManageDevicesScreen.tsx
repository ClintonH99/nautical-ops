import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Button, PageHeader } from '../components';
import { useThemeColors } from '../hooks/useThemeColors';
import { listAccountDevices, removeAccountDevice, SavedDevice } from '../services/deviceManagement';

export const ManageDevicesScreen = () => {
  const colors = useThemeColors();
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = async () => {
    setError('');
    setLoading(true);
    try { setDevices(await listAccountDevices()); }
    catch { setError('Could not load your devices. Please try again from an approved device.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const remove = async () => {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      await removeAccountDevice(selected);
      setDevices(current => current.filter(device => device.id !== selected));
      setSelected(null);
    } catch { setError('Could not remove this device. Refresh the list and try again.'); }
    finally { setBusy(false); }
  };
  return <View style={[styles.page, { backgroundColor: colors.background }]}>
    <PageHeader title="Manage Devices" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Your saved devices</Text>
      <Text style={[styles.text, { color: colors.textSecondary }]}>Your account supports two saved devices. Remove an old device to make room for a replacement. Use Sign Out to remove the device you are using now.</Text>
      <Text style={[styles.text, { color: colors.textSecondary }]}>Browsers are saved separately. Private browsing or clearing browser storage may require recovery.</Text>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{error}</Text> : null}
      {loading ? <Text style={{ color: colors.textSecondary }}>Checking saved devices…</Text> : <Text style={{ color: colors.textSecondary }}>{devices.length} of 2 device slots used</Text>}
      {devices.map(device => <View key={device.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.name, { color: colors.textPrimary }]}>{device.device_name || device.platform}{device.is_current ? ' · This device' : ''}</Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>Last active {new Date(device.last_seen_at).toLocaleString()}</Text>
        {!device.is_current && <Button title="Remove device" variant="outline" disabled={busy || loading} onPress={() => setSelected(device.id)} />}
      </View>)}
      {selected && <View style={[styles.card, { borderColor: colors.border }]}>
        <Text style={[styles.name, { color: colors.textPrimary }]}>Remove this saved device?</Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>This frees one slot. Your account and vessel records will not be deleted.</Text>
        <Button title="Confirm removal" variant="danger" loading={busy} onPress={remove} />
        <Button title="Cancel" variant="text" disabled={busy} onPress={() => setSelected(null)} />
      </View>}
      <Button title="Refresh devices" variant="text" disabled={loading || busy} onPress={refresh} />
    </ScrollView>
  </View>;
};
const styles = StyleSheet.create({
  page: { flex: 1 }, content: { padding: 24, gap: 18, width: '100%', maxWidth: 680, alignSelf: 'center', paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: '700' }, text: { fontSize: 16, lineHeight: 24 },
  name: { fontSize: 18, fontWeight: '600' }, card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 14 },
});
