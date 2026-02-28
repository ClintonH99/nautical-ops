/**
 * Link Website Scan Screen (Native only)
 * Scan QR code from web to link the app session to the website.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { claimAuthLink } from '../services/authLinkService';
import authService from '../services/auth';

function parseCodeFromQrData(data: string): { code: string; redirectTo?: string } | null {
  try {
    let code: string | null = null;
    let redirectTo: string | undefined;
    if (data.includes('code=')) {
      const match = data.match(/[?&]code=([A-Za-z0-9]+)/);
      code = match ? match[1] : null;
      try {
        const url = data.startsWith('http') ? data : `https://${data}`;
        const u = new URL(url);
        redirectTo = `${u.origin}`;
      } catch {
        // ignore
      }
    } else if (data.length <= 20) {
      code = data;
    }
    return code ? { code, redirectTo } : null;
  } catch {
    return null;
  }
}

export const LinkWebsiteScanScreen = ({ navigation }: any) => {
  const [scanned, setScanned] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.webMessage}>
          Open the Nautical Ops app on your phone to link the website.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Requesting camera access…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Camera access is required to scan the QR code.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleBarCodeScanned = async ({ data }: { type: string; data: string }) => {
    if (scanned || claiming) return;
    const parsed = parseCodeFromQrData(data);
    if (!parsed) return;
    setScanned(true);
    setClaiming(true);
    try {
      const session = await authService.getSession();
      if (!session?.access_token) {
        Alert.alert('Error', 'Please sign in first.');
        setScanned(false);
        setClaiming(false);
        return;
      }
      const result = await claimAuthLink(parsed.code, session.access_token, parsed.redirectTo);
      if ('success' in result) {
        Alert.alert('Success', 'Website linked. You can now sign in on the website.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('Error', result.error || 'Failed to link');
        setScanned(false);
      }
    } catch {
      Alert.alert('Error', 'Something went wrong');
      setScanned(false);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'org.iso.QRCode'],
        }}
      />
      <View style={styles.overlay}>
        <View style={styles.scanArea} />
        <Text style={styles.hint}>
          {claiming ? 'Linking…' : scanned ? 'Done!' : 'Point your camera at the QR code on the website'}
        </Text>
        {scanned && (
          <TouchableOpacity
            style={styles.rescanButton}
            onPress={() => setScanned(false)}
          >
            <Text style={styles.rescanText}>Scan again</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  webMessage: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    textAlign: 'center',
    padding: SPACING.xl,
  },
  message: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 8,
  },
  buttonText: {
    color: COLORS.white,
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanArea: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  hint: {
    marginTop: SPACING.xl,
    fontSize: FONTS.sm,
    color: COLORS.white,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  rescanButton: {
    marginTop: SPACING.lg,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  rescanText: {
    color: COLORS.white,
    fontWeight: '600',
  },
});
