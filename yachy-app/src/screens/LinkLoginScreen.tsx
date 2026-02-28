/**
 * Link Login Screen (Web)
 * Shows a QR code for the user to scan with the app. Polls for session once claimed.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Image,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { createAuthCode, getAuthLink } from '../services/authLinkService';

const MARITIME = {
  bgDark: '#0f172a',
  textOnDark: '#f8fafc',
  textMuted: '#94a3b8',
  accent: '#0ea5e9',
  gold: '#c9a227',
};

const WEB_ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://www.nautical-ops.com';

export const LinkLoginScreen = ({ navigation }: any) => {
  const [code, setCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const createCode = useCallback(async () => {
    setError(null);
    setCode(null);
    setQrDataUrl(null);
    const result = await createAuthCode();
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setCode(result.code);
    setClaiming(true);
    try {
      const qrContent = `${WEB_ORIGIN}/link?code=${result.code}`;
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrContent)}`;
      setQrDataUrl(qrApiUrl);
    } catch {
      setError('Failed to generate QR code');
    }
  }, []);

  useEffect(() => {
    createCode();
  }, [createCode]);

  useEffect(() => {
    if (!code || !claiming) return;
    const interval = setInterval(async () => {
      const result = await getAuthLink(code);
      if ('action_link' in result) {
        setClaiming(false);
        try {
          if (typeof window !== 'undefined') {
            window.location.href = result.action_link;
            return;
          }
        } catch (e) {
          setError('Failed to sign in');
        }
      }
      // Only show error for explicit API errors, not transient network issues
      if ('error' in result && result.error && result.error !== 'pending') {
        setError(result.error);
        setClaiming(false);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [code, claiming]);

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Sign in with your phone</Text>
        <Text style={styles.subtitle}>
          Use your phone app—no credentials on this device. Open Nautical Ops on your phone, go to Settings → Link website, and scan this code.
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {qrDataUrl ? (
          <View style={styles.qrBox}>
            <Image source={{ uri: qrDataUrl }} style={styles.qrImage} resizeMode="contain" />
            {claiming && (
              <View style={styles.pollingOverlay}>
                <ActivityIndicator size="small" color={MARITIME.accent} />
                <Text style={styles.pollingText}>Waiting for scan…</Text>
              </View>
            )}
          </View>
        ) : !error ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={MARITIME.accent} />
            <Text style={styles.loadingText}>Generating QR code…</Text>
          </View>
        ) : null}

        <TouchableOpacity onPress={createCode} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Generate new code</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate('Login')}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back to sign in with email</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateAccountChoice')}
          style={styles.backButton}
        >
          <Text style={styles.backText}>New? Create account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MARITIME.bgDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 16,
    padding: 32,
    maxWidth: 400,
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: MARITIME.bgDark,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
  },
  qrBox: {
    width: 256,
    height: 256,
    marginBottom: 16,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 256,
    height: 256,
  },
  pollingOverlay: {
    position: 'absolute',
    bottom: -24,
    alignItems: 'center',
  },
  pollingText: {
    fontSize: 12,
    color: MARITIME.textMuted,
    marginTop: 4,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 48,
    marginBottom: 16,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: MARITIME.textMuted,
  },
  refreshButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  refreshText: {
    fontSize: 14,
    color: MARITIME.accent,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 8,
  },
  backText: {
    fontSize: 14,
    color: MARITIME.textMuted,
  },
});
