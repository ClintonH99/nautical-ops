/**
 * Add / Edit Maintenance Log Screen
 * Equipment, Serial number, Hours of service, Hours at next service,
 * What service done, Notes, Service done by (Crew/Contractor)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Modal,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import maintenanceLogsService from '../services/maintenanceLogs';
import { Input, Button } from '../components';

const DEFAULT_EQUIPMENT_OPTIONS = [
  'Mains',
  'Generators',
  'Stabilizer',
  'Water Maker',
  'Treatment System',
  'Air-Conditioning',
  'Windless',
  'Winches',
  'Ice Machine',
  'Air Handlers',
  'Jet Systems',
  'Running Gear',
  'Hot Tub/Pool',
  'Tender',
  'Jet Ski',
  'Seabobs',
  'E-Foils/Flight Board',
  'Scuba Diving Gear',
  'Hydraulic Doors',
  'Passerelle',
  'Crane',
];

const CUSTOM_EQUIPMENT_STORAGE_KEY = 'maintenance_equipment_custom';

const SERIAL_NUMBERS_STORAGE_KEY = 'maintenance_serial_numbers';

const MAX_STORED_SERIAL_NUMBERS = 100;

function getSerialNumberKey(equipment: string, location: string): string {
  return `${equipment || ''}\x00${location || ''}`;
}

const DEFAULT_LOCATION_OPTIONS = [
  'Bow',
  'Cockpit',
  'Saloon',
  'Flybridge',
  'Sky Deck',
  'Aft Deck',
  'Engine Room',
  'Guest Cabins',
  'Crew Cabins',
  'Galley',
  'Garage',
];

const CUSTOM_LOCATION_STORAGE_KEY = 'maintenance_location_custom';

const HIDDEN_EQUIPMENT_STORAGE_KEY = 'maintenance_equipment_hidden';

const HIDDEN_LOCATION_STORAGE_KEY = 'maintenance_location_hidden';

export const AddEditMaintenanceLogScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const logId = route.params?.logId as string | undefined;

  const [equipment, setEquipment] = useState('');
  const [equipmentOptions, setEquipmentOptions] = useState<string[]>(DEFAULT_EQUIPMENT_OPTIONS);
  const [equipmentDropdownVisible, setEquipmentDropdownVisible] = useState(false);
  const [createNewVisible, setCreateNewVisible] = useState(false);
  const [newEquipmentName, setNewEquipmentName] = useState('');
  const [location, setLocation] = useState('');
  const [locationOptions, setLocationOptions] = useState<string[]>(DEFAULT_LOCATION_OPTIONS);
  const [locationDropdownVisible, setLocationDropdownVisible] = useState(false);
  const [addNewLocationVisible, setAddNewLocationVisible] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [hiddenEquipment, setHiddenEquipment] = useState<string[]>([]);
  const [hiddenLocations, setHiddenLocations] = useState<string[]>([]);
  const [serialNumber, setSerialNumber] = useState('');
  const [serialNumbersByKey, setSerialNumbersByKey] = useState<Record<string, string[]>>({});
  const [serialNumberDropdownVisible, setSerialNumberDropdownVisible] = useState(false);

  const previousSerialNumbers = (serialNumbersByKey[getSerialNumberKey(equipment, location)] || []).slice(0, MAX_STORED_SERIAL_NUMBERS);
  const [hoursOfService, setHoursOfService] = useState('');
  const [hoursAtNextService, setHoursAtNextService] = useState('');
  const [whatServiceDone, setWhatServiceDone] = useState('');
  const [notes, setNotes] = useState('');
  const [serviceDoneBy, setServiceDoneBy] = useState('');
  const [loading, setLoading] = useState(!!logId);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isEdit = !!logId;

  useEffect(() => {
    navigation.setOptions({
      title: logId ? 'Edit Log' : 'New Maintenance Log',
    });
  }, [navigation, logId]);

  const loadCustomEquipment = useCallback(async () => {
    try {
      const [customRaw, hiddenRaw] = await Promise.all([
        AsyncStorage.getItem(CUSTOM_EQUIPMENT_STORAGE_KEY),
        AsyncStorage.getItem(HIDDEN_EQUIPMENT_STORAGE_KEY),
      ]);
      const custom: string[] = customRaw ? JSON.parse(customRaw) : [];
      const hidden: string[] = hiddenRaw ? JSON.parse(hiddenRaw) : [];
      setHiddenEquipment(hidden);
      const combined = [...DEFAULT_EQUIPMENT_OPTIONS];
      custom.forEach((c) => {
        if (!combined.includes(c)) combined.push(c);
      });
      setEquipmentOptions(combined.filter((x) => !hidden.includes(x)));
    } catch (e) {
      console.error('Load custom equipment error:', e);
    }
  }, []);

  useEffect(() => {
    loadCustomEquipment();
  }, [loadCustomEquipment]);

  const loadCustomLocations = useCallback(async () => {
    try {
      const [customRaw, hiddenRaw] = await Promise.all([
        AsyncStorage.getItem(CUSTOM_LOCATION_STORAGE_KEY),
        AsyncStorage.getItem(HIDDEN_LOCATION_STORAGE_KEY),
      ]);
      const custom: string[] = customRaw ? JSON.parse(customRaw) : [];
      const hidden: string[] = hiddenRaw ? JSON.parse(hiddenRaw) : [];
      setHiddenLocations(hidden);
      const combined = [...DEFAULT_LOCATION_OPTIONS];
      custom.forEach((c) => {
        if (!combined.includes(c)) combined.push(c);
      });
      setLocationOptions(combined.filter((x) => !hidden.includes(x)));
    } catch (e) {
      console.error('Load custom locations error:', e);
    }
  }, []);

  useEffect(() => {
    loadCustomLocations();
  }, [loadCustomLocations]);

  const loadSerialNumbersByKey = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(SERIAL_NUMBERS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const byKey = Array.isArray(parsed) ? {} : parsed;
      setSerialNumbersByKey(byKey);
    } catch (e) {
      console.error('Load serial numbers error:', e);
    }
  }, []);

  useEffect(() => {
    loadSerialNumbersByKey();
  }, [loadSerialNumbersByKey]);

  useEffect(() => {
    if (!logId) return;
    (async () => {
      try {
        const log = await maintenanceLogsService.getById(logId);
        if (log) {
          const eq = log.equipment;
          setEquipment(eq);
          setEquipmentOptions((prev) => {
            if (eq && !prev.includes(eq)) return [...prev, eq];
            return prev;
          });
          setLocation(log.portStarboardNa ?? '');
          setLocationOptions((prev) => {
            const loc = log.portStarboardNa?.trim();
            if (loc && !prev.includes(loc)) return [...prev, loc];
            return prev;
          });
          setSerialNumber(log.serialNumber ?? '');
          setHoursOfService(log.hoursOfService ?? '');
          setHoursAtNextService(log.hoursAtNextService ?? '');
          setWhatServiceDone(log.whatServiceDone ?? '');
          setNotes(log.notes ?? '');
          setServiceDoneBy(log.serviceDoneBy ?? '');
        }
      } catch (e) {
        console.error('Load log error:', e);
        Alert.alert('Error', 'Could not load log');
      } finally {
        setLoading(false);
      }
    })();
  }, [logId]);

  const removeEquipment = (opt: string) => {
    Alert.alert(
      'Remove from list',
      `Remove "${opt}" from your equipment list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const nextHidden = [...hiddenEquipment, opt];
            setHiddenEquipment(nextHidden);
            setEquipmentOptions((prev) => prev.filter((x) => x !== opt));
            if (equipment === opt) setEquipment('');
            try {
              await AsyncStorage.setItem(HIDDEN_EQUIPMENT_STORAGE_KEY, JSON.stringify(nextHidden));
            } catch (e) {
              console.error('Save hidden equipment error:', e);
            }
          },
        },
      ]
    );
  };

  const removeLocation = (opt: string) => {
    Alert.alert(
      'Remove from list',
      `Remove "${opt}" from your location list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const nextHidden = [...hiddenLocations, opt];
            setHiddenLocations(nextHidden);
            setLocationOptions((prev) => prev.filter((x) => x !== opt));
            if (location === opt) setLocation('');
            try {
              await AsyncStorage.setItem(HIDDEN_LOCATION_STORAGE_KEY, JSON.stringify(nextHidden));
            } catch (e) {
              console.error('Save hidden location error:', e);
            }
          },
        },
      ]
    );
  };

  const handleSaveNewLocation = async () => {
    const name = newLocationName.trim();
    if (!name) {
      Alert.alert('Required', 'Please enter location name.');
      return;
    }
    const nextOptions = locationOptions.includes(name) ? locationOptions : [...locationOptions, name];
    setLocationOptions(nextOptions);
    setLocation(name);
    setNewLocationName('');
    setAddNewLocationVisible(false);
    setLocationDropdownVisible(false);
    try {
      const custom = nextOptions.filter((o) => !DEFAULT_LOCATION_OPTIONS.includes(o));
      await AsyncStorage.setItem(CUSTOM_LOCATION_STORAGE_KEY, JSON.stringify(custom));
    } catch (e) {
      console.error('Save custom location error:', e);
    }
  };

  const handleSaveNewEquipment = async () => {
    const name = newEquipmentName.trim();
    if (!name) {
      Alert.alert('Required', 'Please enter equipment name.');
      return;
    }
    const nextOptions = equipmentOptions.includes(name) ? equipmentOptions : [...equipmentOptions, name];
    setEquipmentOptions(nextOptions);
    setEquipment(name);
    setNewEquipmentName('');
    setCreateNewVisible(false);
    setEquipmentDropdownVisible(false);
    try {
      const custom = nextOptions.filter((o) => !DEFAULT_EQUIPMENT_OPTIONS.includes(o));
      await AsyncStorage.setItem(CUSTOM_EQUIPMENT_STORAGE_KEY, JSON.stringify(custom));
    } catch (e) {
      console.error('Save custom equipment error:', e);
    }
  };

  const handleSave = async () => {
    const trimmedEquipment = equipment.trim();
    if (!trimmedEquipment) {
      Alert.alert('Required', 'Please enter equipment.');
      return;
    }
    const trimmedServiceDoneBy = serviceDoneBy.trim();
    if (!trimmedServiceDoneBy) {
      Alert.alert('Required', 'Please enter who did the service (Crew or Contractor name).');
      return;
    }
    if (!vesselId) {
      Alert.alert('Error', 'You must be in a vessel to add logs.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await maintenanceLogsService.update(logId, {
          equipment: trimmedEquipment,
          portStarboardNa: location.trim() || undefined,
          serialNumber: serialNumber.trim() || undefined,
          hoursOfService: hoursOfService.trim() || undefined,
          hoursAtNextService: hoursAtNextService.trim() || undefined,
          whatServiceDone: whatServiceDone.trim() || undefined,
          notes: notes.trim() || undefined,
          serviceDoneBy: trimmedServiceDoneBy,
        });
        const sn = serialNumber.trim();
        if (sn) {
          const key = getSerialNumberKey(equipment, location);
          setSerialNumbersByKey((prev) => {
            const list = prev[key] || [];
            const nextList = [sn, ...list.filter((p) => p !== sn)].slice(0, MAX_STORED_SERIAL_NUMBERS);
            const next = { ...prev, [key]: nextList };
            AsyncStorage.setItem(SERIAL_NUMBERS_STORAGE_KEY, JSON.stringify(next)).catch((e) =>
              console.error('Save serial numbers error:', e)
            );
            return next;
          });
        }
        Alert.alert('Updated', 'Log updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await maintenanceLogsService.create({
          vesselId,
          equipment: trimmedEquipment,
          portStarboardNa: location.trim() || undefined,
          serialNumber: serialNumber.trim() || undefined,
          hoursOfService: hoursOfService.trim() || undefined,
          hoursAtNextService: hoursAtNextService.trim() || undefined,
          whatServiceDone: whatServiceDone.trim() || undefined,
          notes: notes.trim() || undefined,
          serviceDoneBy: trimmedServiceDoneBy,
        });
        const sn = serialNumber.trim();
        if (sn) {
          const key = getSerialNumberKey(equipment, location);
          setSerialNumbersByKey((prev) => {
            const list = prev[key] || [];
            const nextList = [sn, ...list.filter((p) => p !== sn)].slice(0, MAX_STORED_SERIAL_NUMBERS);
            const next = { ...prev, [key]: nextList };
            AsyncStorage.setItem(SERIAL_NUMBERS_STORAGE_KEY, JSON.stringify(next)).catch((e) =>
              console.error('Save serial numbers error:', e)
            );
            return next;
          });
        }
        Alert.alert('Saved', 'Log added.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e) {
      console.error('Save log error:', e);
      Alert.alert('Error', 'Could not save log.');
    } finally {
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to add maintenance logs.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Equipment</Text>
          <TouchableOpacity
            style={[styles.dropdownTrigger, { backgroundColor: themeColors.surface }]}
            onPress={() => setEquipmentDropdownVisible(true)}
          >
            <Text style={[styles.dropdownText, !equipment && styles.placeholder]}>
              {equipment || 'Select equipment...'}
            </Text>
            <Text style={styles.dropdownChevron}>▼</Text>
          </TouchableOpacity>
        </View>

        <Modal
          visible={equipmentDropdownVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setEquipmentDropdownVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setEquipmentDropdownVisible(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <ScrollView style={styles.dropdownList} keyboardShouldPersistTaps="handled">
                {equipmentOptions.map((opt) => (
                  <View key={opt} style={[styles.dropdownOptionRow, equipment === opt && styles.dropdownOptionSelected]}>
                    <TouchableOpacity
                      style={styles.dropdownOptionTouch}
                      onPress={() => {
                        setEquipment(opt);
                        setEquipmentDropdownVisible(false);
                      }}
                    >
                      <Text style={[styles.dropdownOptionText, { color: equipment === opt ? undefined : themeColors.textPrimary }, equipment === opt && styles.dropdownOptionTextSelected]}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteOptionBtn}
                      onPress={() => removeEquipment(opt)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.deleteOptionText, equipment === opt && styles.deleteOptionTextSelected]}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.createNewBtn}
                onPress={() => {
                  setEquipmentDropdownVisible(false);
                  setCreateNewVisible(true);
                }}
              >
                <Text style={styles.createNewBtnText}>Create New</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal
          visible={createNewVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCreateNewVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setCreateNewVisible(false)}
          >
            <View style={[styles.createNewModal, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.createNewTitle, { color: themeColors.textPrimary }]}>New Equipment</Text>
              <TextInput
                style={[styles.createNewInput, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                value={newEquipmentName}
                onChangeText={setNewEquipmentName}
                placeholder="Enter equipment name"
                placeholderTextColor={COLORS.gray400}
                autoCapitalize="words"
                autoFocus
              />
              <View style={styles.createNewActions}>
                <Button title="Add" onPress={handleSaveNewEquipment} variant="primary" style={styles.createNewAddBtn} />
                <TouchableOpacity onPress={() => { setCreateNewVisible(false); setNewEquipmentName(''); }}>
                  <Text style={[styles.cancelText, { color: themeColors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Location</Text>
          <TouchableOpacity
            style={[styles.dropdownTrigger, { backgroundColor: themeColors.surface }]}
            onPress={() => setLocationDropdownVisible(true)}
          >
            <Text style={[styles.dropdownText, !location && styles.placeholder]}>
              {location || 'Select location...'}
            </Text>
            <Text style={styles.dropdownChevron}>▼</Text>
          </TouchableOpacity>
        </View>

        <Modal
          visible={locationDropdownVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setLocationDropdownVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setLocationDropdownVisible(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <ScrollView style={styles.dropdownList} keyboardShouldPersistTaps="handled">
                {locationOptions.map((opt) => (
                  <View key={opt} style={[styles.dropdownOptionRow, location === opt && styles.dropdownOptionSelected]}>
                    <TouchableOpacity
                      style={styles.dropdownOptionTouch}
                      onPress={() => {
                        setLocation(opt);
                        setLocationDropdownVisible(false);
                      }}
                    >
                      <Text style={[styles.dropdownOptionText, { color: location === opt ? undefined : themeColors.textPrimary }, location === opt && styles.dropdownOptionTextSelected]}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteOptionBtn}
                      onPress={() => removeLocation(opt)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.deleteOptionText, location === opt && styles.deleteOptionTextSelected]}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.createNewBtn}
                onPress={() => {
                  setLocationDropdownVisible(false);
                  setAddNewLocationVisible(true);
                }}
              >
                <Text style={styles.createNewBtnText}>Add New Location</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal
          visible={addNewLocationVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAddNewLocationVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setAddNewLocationVisible(false)}
          >
            <View style={[styles.createNewModal, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.createNewTitle, { color: themeColors.textPrimary }]}>New Location</Text>
              <TextInput
                style={[styles.createNewInput, { backgroundColor: themeColors.background, color: themeColors.textPrimary }]}
                value={newLocationName}
                onChangeText={setNewLocationName}
                placeholder="Enter location name"
                placeholderTextColor={COLORS.gray400}
                autoCapitalize="words"
                autoFocus
              />
              <View style={styles.createNewActions}>
                <Button title="Add" onPress={handleSaveNewLocation} variant="primary" style={styles.createNewAddBtn} />
                <TouchableOpacity onPress={() => { setAddNewLocationVisible(false); setNewLocationName(''); }}>
                  <Text style={[styles.cancelText, { color: themeColors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Serial number</Text>
          <View style={styles.serialNumberRow}>
            <TextInput
              style={[styles.serialNumberInput, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={serialNumber}
              onChangeText={setSerialNumber}
              placeholder="Optional - tap Recent for this equipment + location"
              placeholderTextColor={COLORS.gray400}
            />
            <TouchableOpacity
              style={styles.recentBtn}
              onPress={() => setSerialNumberDropdownVisible(true)}
            >
              <Text style={styles.recentBtnText}>Recent</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Modal
          visible={serialNumberDropdownVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSerialNumberDropdownVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setSerialNumberDropdownVisible(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.previousTitle, { color: themeColors.textPrimary }]}>
                {equipment || location
                  ? `Previous serial numbers${equipment && location ? ` for ${equipment} / ${location}` : ''}`
                  : 'Select equipment and location first'}
              </Text>
              {!equipment && !location ? (
                <Text style={[styles.previousEmpty, { color: themeColors.textSecondary }]}>Choose equipment and location to see serial numbers for that combination.</Text>
              ) : previousSerialNumbers.length === 0 ? (
                <Text style={[styles.previousEmpty, { color: themeColors.textSecondary }]}>No previous entries for this combination yet. Save a log to add one.</Text>
              ) : (
                <ScrollView style={styles.dropdownList} keyboardShouldPersistTaps="handled">
                  {previousSerialNumbers.map((sn) => (
                    <TouchableOpacity
                      key={sn}
                      style={[styles.dropdownOption, serialNumber === sn && styles.dropdownOptionSelected]}
                      onPress={() => {
                        setSerialNumber(sn);
                        setSerialNumberDropdownVisible(false);
                      }}
                    >
                      <Text
                        style={[styles.dropdownOptionText, { color: serialNumber === sn ? undefined : themeColors.textPrimary }, serialNumber === sn && styles.dropdownOptionTextSelected]}
                        numberOfLines={2}
                      >
                        {sn}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </TouchableOpacity>
        </Modal>
        <Input
          label="Hours of service"
          value={hoursOfService}
          onChangeText={setHoursOfService}
          placeholder="e.g. 1250"
          keyboardType="numeric"
        />
        <Input
          label="Hours at next service"
          value={hoursAtNextService}
          onChangeText={setHoursAtNextService}
          placeholder="e.g. 1500"
          keyboardType="numeric"
        />
        <Input
          label="What service done"
          value={whatServiceDone}
          onChangeText={setWhatServiceDone}
          placeholder="Describe the service performed..."
          multiline
          numberOfLines={3}
        />
        <Input
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional notes"
          multiline
          numberOfLines={2}
        />
        <Input
          label="Service done by (Crew / Contractor)"
          value={serviceDoneBy}
          onChangeText={setServiceDoneBy}
          placeholder="e.g. John Smith (Crew) or ABC Marine (Contractor)"
        />
        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Update log' : 'Save log'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => navigation.goBack()}
            disabled={saving}
          >
            <Text style={[styles.cancelText, { color: themeColors.textSecondary }]}>Cancel</Text>
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
  actions: {
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  cancelBtn: {
    alignSelf: 'center',
    padding: SPACING.sm,
  },
  cancelText: {
    fontSize: FONTS.base,
  },
  fieldContainer: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  dropdownText: {
    fontSize: FONTS.base,
    flex: 1,
  },
  placeholder: {
    color: COLORS.gray400,
  },
  dropdownChevron: {
    fontSize: 10,
    color: COLORS.gray500,
    marginLeft: SPACING.sm,
  },
  serialNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  serialNumberInput: {
    flex: 1,
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.base,
  },
  recentBtn: {
    paddingHorizontal: SPACING.md,
    height: SIZES.inputHeight,
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
  },
  recentBtnText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.white,
  },
  previousTitle: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    padding: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  previousEmpty: {
    fontSize: FONTS.base,
    padding: SPACING.lg,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    borderRadius: BORDER_RADIUS.lg,
    maxHeight: 400,
  },
  dropdownList: {
    maxHeight: 300,
  },
  dropdownOption: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  dropdownOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  dropdownOptionTouch: {
    flex: 1,
    padding: SPACING.md,
    justifyContent: 'center',
  },
  deleteOptionBtn: {
    padding: SPACING.md,
    paddingLeft: SPACING.sm,
  },
  deleteOptionText: {
    fontSize: 20,
    color: COLORS.gray500,
    fontWeight: '300',
  },
  deleteOptionTextSelected: {
    color: COLORS.white,
  },
  dropdownOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  dropdownOptionText: {
    fontSize: FONTS.base,
  },
  dropdownOptionTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  createNewBtn: {
    padding: SPACING.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
  },
  createNewBtnText: {
    fontSize: FONTS.base,
    color: COLORS.primary,
    fontWeight: '600',
  },
  createNewModal: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  createNewTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  createNewInput: {
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONTS.base,
    marginBottom: SPACING.md,
  },
  createNewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  createNewAddBtn: {
    minWidth: 100,
  },
});
