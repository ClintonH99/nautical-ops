/**
 * FAQ Screen
 * Displays FAQs from Supabase and allows users to submit questions
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import { useAuthStore } from '../store';
import { supabase } from '../services/supabase';
import { Linking } from 'react-native';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  display_order: number;
}

export const FAQScreen = () => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadFAQs();
  }, []);

  const loadFAQs = async () => {
    try {
      const { data, error } = await supabase
        .from('faqs')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      setFaqs(data || []);
    } catch (e) {
      console.error('FAQ load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!question.trim()) {
      Alert.alert('Please enter a question');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('user_questions').insert({
        user_id: user?.id ?? null,
        vessel_id: user?.vesselId ?? null,
        user_name: user?.name ?? null,
        user_email: user?.email ?? null,
        question: question.trim(),
        status: 'pending',
      });
      if (error) throw error;
      setQuestion('');
      Alert.alert(
        'Question Submitted',
        'Your question has been received. We will get back to you as soon as possible.'
      );
    } catch {
      Alert.alert('Error', 'Could not submit your question. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="FAQ & Help" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Find answers to common questions about Nautical Ops.
        </Text>

        {loading ? (
          <ActivityIndicator color={themeColors.accent} style={{ marginTop: SPACING.xl }} />
        ) : (
          <View style={styles.faqList}>
            {faqs.map((faq) => {
              const isOpen = expandedId === faq.id;
              return (
                <TouchableOpacity
                  key={faq.id}
                  style={[
                    styles.faqItem,
                    {
                      backgroundColor: themeColors.surface,
                      borderColor: themeColors.border,
                    },
                  ]}
                  onPress={() => setExpandedId(isOpen ? null : faq.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.faqHeader}>
                    <Text style={[styles.faqQuestion, { color: themeColors.textPrimary }]}>
                      {faq.question}
                    </Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={themeColors.textSecondary}
                      style={styles.faqChevron}
                    />
                  </View>
                  {isOpen && (
                    <Text style={[styles.faqAnswer, { color: themeColors.textSecondary }]}>
                      {faq.answer}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View
          style={[
            styles.submitCard,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.submitTitle, { color: themeColors.textPrimary }]}>
            Still have a question?
          </Text>
          <Text style={[styles.submitSubtitle, { color: themeColors.textSecondary }]}>
            Submit your question and we will get back to you.
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: themeColors.control,
                color: themeColors.textPrimary,
                borderColor: themeColors.isDark ? themeColors.borderStrong : COLORS.border,
              },
            ]}
            placeholder="Type your question here..."
            placeholderTextColor={themeColors.textSecondary}
            value={question}
            onChangeText={setQuestion}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: COLORS.primary, opacity: submitting ? 0.7 : 1 },
            ]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Question</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.websiteButton,
              { borderColor: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
            onPress={() => Linking.openURL('https://www.nautical-ops.com/support').catch(() => {})}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.websiteButtonText,
                { color: themeColors.isDark ? COLORS.white : COLORS.primary },
              ]}
            >
              Visit Website
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  subtitle: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
    lineHeight: 20,
  },
  faqList: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  faqItem: {
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...SHADOWS.md,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    minHeight: 62,
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
  },
  faqQuestion: {
    fontSize: FONTS.base,
    fontWeight: '500',
    flex: 1,
    lineHeight: 22,
  },
  faqChevron: {
    marginTop: 2,
    flexShrink: 0,
  },
  faqAnswer: {
    fontSize: FONTS.sm,
    lineHeight: 22,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  submitCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  submitTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  submitSubtitle: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    padding: SPACING.md,
    fontSize: FONTS.base,
    minHeight: 100,
    marginBottom: SPACING.md,
  },
  submitButton: {
    minHeight: 46,
    borderRadius: 14,
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  websiteButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  websiteButtonText: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  submitButtonText: {
    color: 'white',
    fontSize: FONTS.base,
    fontWeight: '600',
  },
});
