/**
 * CategorySheet
 * Expandable panel that slides up from the footer with category selections
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = Math.min(SCREEN_HEIGHT * 0.55, 420);
const PILL_BG = '#2C2C2E';
const SHEET_MARGIN_H = 20;

export const CATEGORIES = [
  { key: 'maintenance', label: 'Maintenance', icon: '🔧', nav: 'MaintenanceHome' },
  { key: 'watch', label: 'Watch Keeping', icon: '⏱️', nav: 'WatchKeeping' },
  { key: 'logs', label: 'Vessel Logs', icon: '🗒️', nav: 'VesselLogs' },
  { key: 'contractors', label: 'Contractor Database', icon: '👷', nav: 'ContractorDatabase' },
  { key: 'yard', label: 'Yard Period', icon: '🏗️', nav: 'YardPeriodTrips' },
  { key: 'import', label: 'Import / Export', icon: '📥', nav: 'ImportExport' },
];

type CategorySheetProps = {
  visible: boolean;
  onClose: () => void;
  onSelectCategory: (nav: string) => void;
};

export const CategorySheet = ({ visible, onClose, onSelectCategory }: CategorySheetProps) => {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SHEET_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, overlayOpacity]);

  const handleSelect = (nav: string) => {
    onSelectCategory(nav);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container} pointerEvents={visible ? 'auto' : 'none'}>
        <Animated.View
          style={[styles.overlay, { opacity: overlayOpacity }]}
          pointerEvents="auto"
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{ translateY: slideAnim }],
              marginHorizontal: SHEET_MARGIN_H,
            },
          ]}
        >
          {/* Drag handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          <Text style={styles.title}>Quick access</Text>
          <Text style={styles.subtitle}>Choose a category to open</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.grid}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.key}
                  style={styles.categoryItem}
                  onPress={() => handleSelect(cat.nav)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.categoryIcon}>{cat.icon}</Text>
                  <Text style={styles.categoryLabel}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: PILL_BG,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    ...(Platform.OS === 'ios' ? SHADOWS.lg : { elevation: 12 }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: SPACING.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  title: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    color: COLORS.white,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  subtitle: {
    fontSize: FONTS.sm,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING['2xl'],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryItem: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryIcon: {
    fontSize: 32,
    marginBottom: SPACING.xs,
  },
  categoryLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.white,
    textAlign: 'center',
  },
});
