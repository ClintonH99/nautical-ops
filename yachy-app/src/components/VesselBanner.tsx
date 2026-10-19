import React from 'react';
import { ImageBackground, StyleSheet, Text, type ImageSourcePropType } from 'react-native';

export interface VesselBannerProps {
  source: ImageSourcePropType;
  name: string;
  onError: () => void;
}

// Native fallback; the web implementation owns responsive browser framing.
export function VesselBanner({ source, name, onError }: VesselBannerProps) {
  return (
    <ImageBackground
      testID="home-vessel-banner"
      source={source}
      resizeMode="cover"
      onError={onError}
      style={styles.frame}
    >
      <Text style={styles.name}>{name}</Text>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 4 / 3, justifyContent: 'flex-end', padding: 18 },
  name: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    textShadowColor: '#000',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
});
