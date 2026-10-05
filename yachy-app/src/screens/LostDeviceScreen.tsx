import React, { useEffect, useRef, useState } from 'react';
import { Text, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Input, PageHeader } from '../components';
import { useThemeColors } from '../hooks/useThemeColors';
import { createDeviceRecovery, SavedDevice } from '../services/deviceManagement';

export const LostDeviceScreen = ({ navigation }: { navigation?: { navigate: (route: string) => void } }) => {
  const colors = useThemeColors();
  const recovery = useRef<ReturnType<typeof createDeviceRecovery> | null>(null);
  if (!recovery.current) recovery.current = createDeviceRecovery();
  const busyRef = useRef(false);
  const [step, setStep] = useState<'account' | 'code' | 'devices' | 'done'>('account');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => () => { void recovery.current?.dispose().catch(() => {}); }, []);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not complete this step. Please try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const start = () => run(async () => {
    if (!/\S+@\S+\.\S+/.test(email.trim()) || !password) throw new Error('Enter your account email and password.');
    await recovery.current!.start(email, password);
    setPassword(''); setStep('code');
  });
  const verify = () => run(async () => {
    if (!/^\d{6,8}$/.test(code.trim())) throw new Error('Enter the verification code from your email.');
    setDevices(await recovery.current!.verify(code)); setStep('devices'); setCode('');
  });
  return <KeyboardAvoidingView style={[styles.page, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <PageHeader title={step === 'devices' ? 'Manage Devices' : 'Lost Device?'} showBack={!busy && step !== 'done'} onBack={() => navigation?.navigate('Login')} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.heading, { color: colors.textPrimary }]}>{step === 'account' ? 'Recover your access' : step === 'code' ? 'Check your email' : step === 'devices' ? 'Choose a device to replace' : 'This device is ready'}</Text>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{notice}</Text> : null}
      {step === 'account' && <>
        <Text style={[styles.text, { color: colors.textSecondary }]}>Lost or replaced a device? Confirm your account, then verify an emailed code. You can remove a saved device even if you no longer have either device.</Text>
        <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!busy} />
        <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry editable={!busy} onSubmitEditing={start} />
        <Button title="Verify account and send code" loading={busy} onPress={start} fullWidth />
        <Text style={[styles.text, { color: colors.textSecondary }]}>If you do not have a password, return to Sign In and use Forgot Password first. If you cannot access your email, contact support@nautical-ops.com.</Text>
      </>}
      {step === 'code' && <>
        <Text style={[styles.text, { color: colors.textSecondary }]}>Enter the code sent to {email.trim()}. Recovery verification expires after 10 minutes. You will stay in recovery until this device has a saved slot.</Text>
        <Input label="Email verification code" value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={8} editable={!busy} onSubmitEditing={verify} />
        <Button title="Verify code" loading={busy} onPress={verify} fullWidth />
        <Button title="Send a new code" variant="text" disabled={busy} onPress={() => run(async () => { await recovery.current!.resend(); setNotice('A new code has been requested. Please check your inbox.'); })} />
      </>}
      {step === 'devices' && <>
        <Text style={[styles.text, { color: colors.textSecondary }]}>{devices.length ? 'Select at least one saved device to remove. We will remove your selection and register this device together, keeping the maximum at two.' : 'There are no saved devices. You can register this device to continue.'}</Text>
        {devices.map(device => <TouchableOpacity key={device.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(device.id), disabled: busy }} disabled={busy}
          onPress={() => setSelected(ids => ids.includes(device.id) ? ids.filter(id => id !== device.id) : [...ids, device.id])}
          style={[styles.card, { borderColor: selected.includes(device.id) ? colors.textPrimary : colors.border, backgroundColor: colors.surface, borderWidth: selected.includes(device.id) ? 2 : 1 }]}>
          <Text style={[styles.name, { color: colors.textPrimary }]}>{selected.includes(device.id) ? 'Selected · ' : ''}{device.device_name || device.platform}</Text>
          <Text style={[styles.text, { color: colors.textSecondary }]}>Last active {new Date(device.last_seen_at).toLocaleString()}</Text>
        </TouchableOpacity>)}
        <Text style={[styles.text, { color: colors.textSecondary }]}>Your account, My Sea Miles and vessel records are not deleted.</Text>
        <Button title={devices.length ? 'Remove selected and register this device' : 'Register this device'} disabled={busy || (devices.length > 0 && selected.length === 0)} loading={busy}
          onPress={() => run(async () => { await recovery.current!.replace(selected); setStep('done'); })} fullWidth />
        <Button title="Refresh devices" variant="text" disabled={busy} onPress={() => run(async () => { setDevices(await recovery.current!.refresh()); setSelected([]); })} />
      </>}
      {step === 'done' && <>
        <Text style={[styles.text, { color: colors.textSecondary }]}>Your replacement device is registered. Continue to Nautical Ops. Any existing vessel subscription restriction will still apply.</Text>
        <Button title="Continue to Nautical Ops" loading={busy} onPress={() => run(() => recovery.current!.continueToApp())} fullWidth />
      </>}
      {(step === 'code' || step === 'devices') && <Button title="Start recovery again" variant="text" disabled={busy} onPress={() => run(async () => {
        await recovery.current!.dispose();
        recovery.current = createDeviceRecovery();
        setPassword(''); setCode(''); setSelected([]); setDevices([]); setStep('account');
      })} />}
    </ScrollView>
  </KeyboardAvoidingView>;
};
const styles = StyleSheet.create({
  page: { flex: 1 }, content: { padding: 24, gap: 18, width: '100%', maxWidth: 600, alignSelf: 'center', paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: '700' }, text: { fontSize: 16, lineHeight: 24 },
  name: { fontSize: 18, fontWeight: '600' }, card: { borderRadius: 16, padding: 20, gap: 8 },
});
