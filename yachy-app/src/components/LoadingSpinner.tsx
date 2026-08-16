/**
 * LoadingSpinner
 * Lottie-based loading animation used in place of ActivityIndicator.
 */

import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS } from '../constants/theme';

let LottieView: any = null;
try {
  LottieView = require('lottie-react-native').default;
} catch {
  /* lottie-react-native not available in this environment */
}

const spinnerSource = require('../../assets/loading-spinner.json');

type Props = {
  size?: 'small' | 'large';
  color?: string;
  style?: object;
};

export const LoadingSpinner = ({ size = 'large', color = COLORS.primary, style }: Props) => {
  // Deliberately renders nothing: the animation was distracting and screens
  // read better going straight from blank to content. Kept as a component so
  // the ~36 call sites stay untouched and it can be reinstated in one place.
  return null;

  // eslint-disable-next-line no-unreachable
  const dim = size === 'large' ? 80 : 40;

  if (!LottieView) {
    return <ActivityIndicator size={size} color={color} style={style} />;
  }

  return (
    <View style={[styles.container, { width: dim, height: dim }, style]}>
      <LottieView
        source={spinnerSource}
        autoPlay
        loop
        style={{ width: dim, height: dim }}
        colorFilters={[{ keypath: 'Ring', color }]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
