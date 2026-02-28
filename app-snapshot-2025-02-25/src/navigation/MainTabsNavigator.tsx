/**
 * Main Tabs Navigator
 * Custom pill-shaped button bar with 3 assignable buttons (no default footer)
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { COLORS, SHADOWS } from '../constants/theme';

const Tab = createBottomTabNavigator();

const PILL_HEIGHT = 64;
const PILL_MARGIN_H = 20;
/** Translucent dark gray (iOS-style) */
const PILL_BG = 'rgba(44, 44, 46, 0.92)';
/** Selected tab: light gray pill */
const SELECTED_PILL_BG = 'rgba(255, 255, 255, 0.2)';

/** Assign each button to a screen. Change these to reassign. */
const BUTTON_CONFIG = [
  { route: 'Home', label: 'Home', icon: 'home-outline' as const },
  { route: 'Categories', label: 'Categories', icon: 'grid-outline' as const },
  { route: 'Profile', label: 'Settings', icon: 'settings-outline' as const },
];

function CustomPillBar(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { state, navigation } = props;

  return (
    <View
      style={[
        styles.pill,
        {
          bottom: insets.bottom + 12,
          marginHorizontal: PILL_MARGIN_H,
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
            <View style={[styles.buttonInner, focused && styles.buttonInnerSelected]}>
              <Ionicons
                name={config.icon}
                size={24}
                color={COLORS.white}
                style={{ opacity: focused ? 1 : 0.65 }}
              />
              <Text style={[styles.label, !focused && styles.labelUnselected]}>
                {config.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const MainTabsNavigator = () => {
  const insets = useSafeAreaInsets();
  const bottomPadding = PILL_HEIGHT + insets.bottom + 24;

  return (
    <Tab.Navigator
      tabBar={(props) => <CustomPillBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { paddingBottom: bottomPadding },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Categories" component={CategoriesScreen} />
      <Tab.Screen name="Profile" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: PILL_BG,
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
  buttonInnerSelected: {
    backgroundColor: SELECTED_PILL_BG,
    borderRadius: 9999,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: 2,
  },
  labelUnselected: {
    opacity: 0.65,
  },
});
