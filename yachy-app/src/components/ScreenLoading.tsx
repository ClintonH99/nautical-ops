import React from 'react';
import { View } from 'react-native';
import { PageHeader } from './PageHeader';
import { LoadingSpinner } from './LoadingSpinner';
import { useThemeColors } from '../hooks/useThemeColors';

/** First visits keep the title and Back action available while the fields arrive. */
export function ScreenLoading({ title }: { title: string }) {
  const theme = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <PageHeader title={title} />
      <LoadingSpinner style={{ marginTop: 24 }} />
    </View>
  );
}
