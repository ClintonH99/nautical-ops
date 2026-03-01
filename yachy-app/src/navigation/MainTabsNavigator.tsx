/**
 * Main Tabs Navigator
 * Pill-shaped button bar on mobile; sidebar on web/desktop
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { COLORS, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

const Tab = createBottomTabNavigator();
const DESKTOP_BREAKPOINT = 768;

const PILL_HEIGHT = 64;
const PILL_MARGIN_H = 20;

/** Assign each button to a screen. Change these to reassign. */
const BUTTON_CONFIG = [
  { route: 'Home', label: 'Home', icon: 'home-outline' as const },
  { route: 'Categories', label: 'Categories', icon: 'grid-outline' as const },
  { route: 'Profile', label: 'Settings', icon: 'settings-outline' as const },
];

function CustomPillBar(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { state, navigation } = props;
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
  const themeColors = useThemeColors();
  const selectedBg = themeColors.isDark ? 'rgba(255, 255, 255, 0.1)' : themeColors.surfaceAlt;
  const pillBg = themeColors.isDark ? '#1E293B' : themeColors.surface;
  const barBg = themeColors.isDark ? '#0F172A' : themeColors.background;

  if (isDesktop) return null;

  return (
    <View
      style={[
        styles.tabBarContainer,
        {
          backgroundColor: barBg,
          paddingBottom: insets.bottom,
        },
      ]}
      pointerEvents="box-none"
    >
    <View
      style={[
        styles.pill,
        {
          marginHorizontal: PILL_MARGIN_H,
          backgroundColor: pillBg,
        },
      ]}
    >
      {state.routes.map((route: { key: string; name: string }, index: number) => {
        const config = BUTTON_CONFIG[index];
        const focused = state.index === index;

        return (
          <Pressable
            key={route.key}
            onPress={() => navigation.navigate(route.name)}
            style={[styles.button, focused && styles.buttonSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
          >
            <View
              style={[
                styles.buttonInner,
                focused && { backgroundColor: selectedBg, borderRadius: 9999 },
              ]}
            >
              <Ionicons
                name={config.icon}
                size={24}
                color={themeColors.textPrimary}
                style={{ opacity: focused ? 1 : 0.65 }}
              />
              <Text style={[styles.label, { color: themeColors.textPrimary }, !focused && styles.labelUnselected]}>
                {config.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

/** Desktop sidebar: use parent nav to switch tabs via MainTabs */
function DesktopSidebar() {
  const navigation = useNavigation<any>();
  const themeColors = useThemeColors();
  const index = useNavigationState((state) => {
    const main = state?.routes?.find((r: any) => r.name === 'MainTabs');
    return main?.state?.index ?? 0;
  });

  return (
    <View
      style={[
        styles.sidebar,
        {
          backgroundColor: themeColors.surface,
          borderRightColor: themeColors.surfaceAlt,
        },
      ]}
    >
      <View
        style={[
          styles.sidebarHeader,
          { borderBottomColor: themeColors.surfaceAlt },
        ]}
      >
        <Ionicons name="boat-outline" size={28} color={COLORS.primary} />
        <Text style={[styles.sidebarTitle, { color: themeColors.textPrimary }]}>
          Nautical Ops
        </Text>
      </View>
      {BUTTON_CONFIG.map((config, i) => {
        const focused = index === i;
        return (
          <Pressable
            key={config.route}
            onPress={() => navigation.navigate('MainTabs', { screen: config.route })}
            style={[styles.sidebarItem, focused && styles.sidebarItemActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
          >
            <Ionicons
              name={config.icon}
              size={22}
              color={focused ? COLORS.primary : themeColors.textSecondary}
            />
            <Text
              style={[
                styles.sidebarLabel,
                { color: focused ? COLORS.primary : themeColors.textSecondary },
              ]}
            >
              {config.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const MainTabsNavigator = () => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
  const themeColors = useThemeColors();
  const bottomPadding = isDesktop ? 0 : PILL_HEIGHT + insets.bottom + 24;
  const tabBarBg = themeColors.isDark ? '#0F172A' : themeColors.background;

  if (isDesktop) {
    return (
      <View style={styles.desktopLayout}>
        <DesktopSidebar />
        <View style={styles.desktopContent}>
          <Tab.Navigator
            tabBar={() => null}
            screenOptions={{
              headerShown: false,
              sceneStyle: { paddingBottom: 0 },
            }}
          >
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Categories" component={CategoriesScreen} />
            <Tab.Screen name="Profile" component={SettingsScreen} />
          </Tab.Navigator>
        </View>
      </View>
    );
  }

  return (
    <Tab.Navigator
      tabBar={(props) => <CustomPillBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { paddingBottom: bottomPadding },
        tabBarStyle: { backgroundColor: tabBarBg },
        tabBarShowLabel: true,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Categories" component={CategoriesScreen} />
      <Tab.Screen name="Profile" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingHorizontal: 0,
  },
  pill: {
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 9999,
    ...(Platform.OS === 'ios' ? SHADOWS.lg : { elevation: 12 }),
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  buttonSelected: {},
  buttonInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  labelUnselected: {
    opacity: 0.65,
  },
  desktopLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopContent: {
    flex: 1,
  },
  sidebar: {
    width: 240,
    backgroundColor: COLORS.surface ?? '#fff',
    borderRightWidth: 1,
    borderRightColor: COLORS.border ?? '#e5e7eb',
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 32,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border ?? '#e5e7eb',
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  sidebarItemActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.12)',
  },
  sidebarLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  sidebarLabelActive: {
    color: COLORS.primary,
  },
});
