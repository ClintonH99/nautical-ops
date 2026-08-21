/**
 * Shared page header.
 *
 * The native navigation bar is switched off for screens using this
 * (headerShown: false) because iOS 26 draws its own Liquid Glass circle behind
 * anything placed in that bar, which cannot be turned off. Owning the header
 * ourselves means the back button, title and info button look exactly as
 * designed on every platform.
 *
 * Every screen gets its design from here - change it once, and all screens
 * follow.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../hooks/useThemeColors';
import { InfoModal, ScreenInfoContent } from './InfoModal';
import { SPACING } from '../constants/theme';

interface PageHeaderProps {
  /** Page title, shown centred. */
  title: string;
  /** Info modal content. Omit to hide the info button. */
  info?: ScreenInfoContent;
  /** Storage key for "already seen". Required when `info` is given. */
  infoScreenKey?: string;
  /** Show the info modal automatically on first visit. */
  infoAutoShow?: boolean;
  /** Hide the back chevron on root screens that have nowhere to go back to. */
  showBack?: boolean;
  /** Override the back action. Defaults to navigation.goBack(). */
  onBack?: () => void;
  /** Optional controls rendered centred on their own row beneath the title. */
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  info,
  infoScreenKey,
  infoAutoShow = false,
  showBack = true,
  onBack,
  actions,
}) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <View style={styles.titleBar}>
        {showBack && (
          <TouchableOpacity
            onPress={onBack ?? (() => navigation.goBack())}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={[styles.backChevron, { color: themeColors.textPrimary }]}>‹‹</Text>
          </TouchableOpacity>
        )}
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, { color: themeColors.textPrimary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {info && infoScreenKey ? (
            <InfoModal screenKey={infoScreenKey} autoShow={infoAutoShow} content={info} />
          ) : null}
        </View>
      </View>
      {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.lg,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
  },
  backBtn: {
    position: 'absolute',
    left: 0,
    justifyContent: 'center',
  },
  backChevron: {
    fontSize: 26,
    fontWeight: '400',
    letterSpacing: -3,
    lineHeight: 30,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    // Leave room for the back chevron so a long title stays centred
    // without running underneath it.
    maxWidth: '78%',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    flexShrink: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
});
