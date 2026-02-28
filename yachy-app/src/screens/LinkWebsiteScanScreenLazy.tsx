/**
 * Lazy wrapper for LinkWebsiteScanScreen.
 * Delays loading expo-camera until the screen is opened (avoids Expo Go startup crash).
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

export const LinkWebsiteScanScreenLazy = (props: any) => {
  const [Screen, setScreen] = useState<React.ComponentType<any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    import('./LinkWebsiteScanScreen')
      .then((m) => {
        if (mounted) setScreen(() => m.LinkWebsiteScanScreen);
      })
      .catch((e) => {
        if (mounted) setError(e?.message || 'Failed to load scanner');
      });
    return () => { mounted = false; };
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (!Screen) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return <Screen {...props} />;
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#666',
    padding: 16,
  },
});
