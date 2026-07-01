import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

export interface ScreenInfoContent {
  title: string;
  description: string;
  features: string[];
}

interface InfoModalProps {
  screenKey: string;
  content: ScreenInfoContent;
  autoShow?: boolean;
}

export const InfoModal: React.FC<InfoModalProps> = ({ screenKey, content, autoShow = true }) => {
  const themeColors = useThemeColors();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!autoShow) return;
    const check = async () => {
      try {
        const seen = await AsyncStorage.getItem('info_seen_' + screenKey);
        if (!seen) setVisible(true);
      } catch {}
    };
    check();
  }, [screenKey, autoShow]);

  const handleClose = async () => {
    try {
      await AsyncStorage.setItem('info_seen_' + screenKey, 'true');
    } catch {}
    setVisible(false);
  };

  return (
    <>
      <TouchableOpacity onPress={() => setVisible(true)} style={styles.infoButton}>
        <Text style={styles.infoButtonText}>i</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.title, { color: themeColors.textPrimary }]}>{content.title}</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
              <Text style={[styles.description, { color: themeColors.textSecondary }]}>
                {content.description}
              </Text>
              <View style={styles.featuresContainer}>
                {content.features.map((feature, index) => (
                  <View key={index} style={styles.featureRow}>
                    <Text style={[styles.bullet, { color: COLORS.primary }]}>{'\u2022'}</Text>
                    <Text style={[styles.featureText, { color: themeColors.textPrimary }]}>
                      {feature}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: COLORS.primary }]}
              onPress={handleClose}
            >
              <Text style={styles.buttonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  infoButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#1e3a5f',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  infoButtonText: {
    fontSize: 13,
    color: '#1e3a5f',
    fontWeight: '700',
    fontStyle: 'italic',
    lineHeight: 16,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modal: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    maxHeight: '80%',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  scroll: {
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.md,
  },
  description: {
    fontSize: FONTS.base,
    lineHeight: 22,
    marginBottom: SPACING.md,
  },
  featuresContainer: {
    marginBottom: SPACING.sm,
  },
  featureRow: {
    flexDirection: 'row',
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  bullet: {
    fontSize: FONTS.base,
    fontWeight: 'bold',
    marginTop: 2,
  },
  featureText: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    flex: 1,
  },
  button: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: FONTS.base,
    fontWeight: '600',
  },
});
