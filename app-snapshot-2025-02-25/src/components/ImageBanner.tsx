/**
 * ImageBanner
 * Reusable full-width image banner with optional overlay
 */

import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { COLORS } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ImageBannerProps = {
  source: string;
  fallback?: string;
  height?: number;
  aspectRatio?: number;
  overlay?: boolean;
  overlayOpacity?: number;
};

export const ImageBanner = ({
  source,
  fallback,
  height,
  aspectRatio = 16 / 9,
  overlay = true,
  overlayOpacity = 0.12,
}: ImageBannerProps) => {
  const [imageError, setImageError] = React.useState(false);
  const bannerHeight = height ?? Math.round(SCREEN_WIDTH / aspectRatio);
  const uri = imageError && fallback ? fallback : source;

  return (
    <View style={[styles.container, { width: SCREEN_WIDTH, height: bannerHeight }]}>
      <Image
        source={{ uri }}
        style={[styles.image, { width: SCREEN_WIDTH, height: bannerHeight }]}
        contentFit="cover"
        onError={() => setImageError(true)}
      />
      {overlay && (
        <View
          style={[
            styles.overlay,
            {
              width: SCREEN_WIDTH,
              height: bannerHeight,
              backgroundColor: `rgba(0,0,0,${overlayOpacity})`,
            },
          ]}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: COLORS.gray200,
    overflow: 'hidden',
  },
  image: {},
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
