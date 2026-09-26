import { ScreenLoading } from '../components/ScreenLoading';
/**
 * Add / Edit Discharge Log Screen
 * Fields: Discharge Type (Direct Discharge / Treatment Plant / Pump-out Service),
 *         Pump-out Service Name (if applicable), Location, Amount in Gallons, Date, Time
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import pumpOutLogsService from '../services/pumpOutLogs';
import { DischargeType } from '../types';
import {
  DateOnlyPicker,
  Input,
  Button,
  LoadingSpinner,
  PageHeader,
  TimePickerField,
} from '../components';
import { parseLocalDate } from '../utils';

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

const DISCHARGE_OPTIONS: { value: DischargeType; label: string }[] = [
  { value: 'DIRECT_DISCHARGE', label: 'Direct Discharge' },
  { value: 'TREATMENT_PLANT', label: 'Treatment Plant Discharge' },
  { value: 'PUMPOUT_SERVICE', label: 'Pump-out Service' },
];

export const AddEditPumpOutLogScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const logId = route.params?.logId as string | undefined;
  const isEdit = !!logId;

  const now = new Date();
  const [dischargeType, setDischargeType] = useState<DischargeType>('DIRECT_DISCHARGE');
  const [pumpoutServiceName, setPumpoutServiceName] = useState('');
  const [location, setLocation] = useState('');
  const [amountInGallons, setAmountInGallons] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date>(now);
  const [time, setTime] = useState<Date>(now);
  const [loading, setLoading] = useState(!!logId);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const vesselId = user?.vesselId ?? null;

  useEffect(() => {
    navigation.setOptions({
      title: isEdit ? 'Edit Discharge Entry' : 'Create Discharge Entry',
    });
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!logId) return;
    (async () => {
      try {
        const log = await pumpOutLogsService.getById(logId);
        if (log) {
          setDischargeType(log.dischargeType);
          setPumpoutServiceName(log.pumpoutServiceName);
          setLocation(log.location);
          setAmountInGallons(String(log.amountInGallons));
          setDescription(log.description);
          setDate(parseLocalDate(log.logDate));
          const [hh, mm] = log.logTime.split(':').map(Number);
          const t = new Date();
          t.setHours(hh, mm, 0, 0);
          setTime(t);
        }
      } catch {
        Alert.alert('Error', 'Could not load entry.');
      } finally {
        setLoading(false);
      }
    })();
  }, [logId]);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!vesselId) {
      Alert.alert('Error', 'You must be in a vessel to add log entries.');
      return;
    }
    if (!location.trim()) {
      Alert.alert('Required', 'Please enter a location.');
      return;
    }
    const parsedAmount = parseFloat(amountInGallons);
    if (!amountInGallons || isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid amount in gallons.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      if (isEdit) {
        await pumpOutLogsService.update(logId!, {
          dischargeType,
          pumpoutServiceName: dischargeType === 'PUMPOUT_SERVICE' ? pumpoutServiceName : '',
          location: location.trim(),
          amountInGallons: parsedAmount,
          description: description.trim(),
          logDate: formatDate(date),
          logTime: formatTime(time),
        });
        Alert.alert('Updated', 'Entry updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await pumpOutLogsService.create({
          vesselId,
          dischargeType,
          pumpoutServiceName: dischargeType === 'PUMPOUT_SERVICE' ? pumpoutServiceName : '',
          location: location.trim(),
          amountInGallons: parsedAmount,
          description: description.trim(),
          logDate: formatDate(date),
          logTime: formatTime(time),
          createdByName: user?.name ?? '',
        });
        Alert.alert('Saved', 'Entry added.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch {
      Alert.alert('Error', 'Could not save entry.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to add discharge log entries.
        </Text>
      </View>
    );
  }

  if (loading) {
    return <ScreenLoading title={isEdit ? 'Edit Discharge Entry' : 'Create Discharge Entry'} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <PageHeader title={isEdit ? 'Edit Discharge Entry' : 'Create Discharge Entry'} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.section,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
          >
            Entry details
          </Text>

          <Input
            label="Location"
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Port Miami, Dock B"
          />

          <View style={styles.dateTimeRow}>
            <View style={styles.dateTimeColumn}>
              <DateOnlyPicker
                label="Date"
                value={formatDate(date)}
                onChange={(nextDate) => setDate(parseLocalDate(nextDate))}
                title="Select discharge date"
              />
            </View>

            <TimePickerField
              label="Time"
              title="Select Discharge Time"
              value={time}
              onChange={setTime}
              containerStyle={styles.dateTimeColumn}
            />
          </View>
        </View>

        <View
          style={[
            styles.section,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
          >
            Discharge details
          </Text>

          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: themeColors.textPrimary }]}>Discharge Type</Text>
            <View style={styles.optionsCol}>
              {DISCHARGE_OPTIONS.map((opt) => {
                const selected = dischargeType === opt.value;
                const selectedTint = themeColors.isDark ? COLORS.white : COLORS.primary;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: selected ? themeColors.accentSoft : themeColors.control,
                        borderColor: selected ? selectedTint : themeColors.border,
                      },
                    ]}
                    onPress={() => setDischargeType(opt.value)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.radio,
                        { borderColor: selected ? selectedTint : themeColors.borderStrong },
                      ]}
                    >
                      {selected && (
                        <View style={[styles.radioDot, { backgroundColor: selectedTint }]} />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.optionLabel,
                        {
                          color: selected ? selectedTint : themeColors.textPrimary,
                          fontWeight: selected ? '700' : '500',
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {dischargeType === 'PUMPOUT_SERVICE' && (
            <Input
              label="Pump-out Service"
              value={pumpoutServiceName}
              onChangeText={setPumpoutServiceName}
              placeholder="Pump-out truck or marina pump-out"
              autoCapitalize="words"
            />
          )}

          <Input
            label="Amount (gallons)"
            value={amountInGallons}
            onChangeText={setAmountInGallons}
            placeholder="e.g. 150"
            keyboardType="decimal-pad"
          />

          <Input
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Tipped the dockhand $20"
            multiline
            numberOfLines={3}
            containerStyle={styles.lastInput}
          />
        </View>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Create Discharge Entry'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          <TouchableOpacity
            style={[
              styles.cancelBtn,
              { borderColor: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
            onPress={() => navigation.goBack()}
            disabled={saving}
          >
            <Text
              style={[
                styles.cancelText,
                { color: themeColors.isDark ? COLORS.white : COLORS.primary },
              ]}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    textAlign: 'center',
  },
  fieldContainer: {
    marginBottom: SPACING.md,
  },
  section: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  optionsCol: {
    gap: SPACING.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionLabel: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  pickerValue: {
    fontSize: FONTS.base,
  },
  iosPickerTrigger: {
    justifyContent: 'center',
  },
  actions: {
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  cancelBtn: {
    minHeight: SIZES.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  cancelText: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  dateTimeColumn: {
    flex: 1,
  },
  lastInput: {
    marginBottom: 0,
  },
});
