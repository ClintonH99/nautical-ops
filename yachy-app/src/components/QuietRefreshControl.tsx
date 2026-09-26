import React from 'react';
import { RefreshControl, RefreshControlProps } from 'react-native';
import { readTransport } from '../services/supabase';

/** Preserve the pull gesture without a spinning wheel. */
export const QuietRefreshControl = (props: RefreshControlProps) => (
  <RefreshControl
    {...props}
    onRefresh={() => {
      readTransport.invalidate();
      props.onRefresh?.();
    }}
    tintColor="transparent"
    colors={['transparent']}
    progressBackgroundColor="transparent"
  />
);
