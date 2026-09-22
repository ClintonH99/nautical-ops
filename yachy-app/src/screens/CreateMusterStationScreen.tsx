/**
 * Create Muster Station Screen
 * Fill-in form for muster station plan, Export to PDF, Publish
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import musterStationsService, { getMusterStationLocations } from '../services/musterStations';
import vesselService from '../services/vessel';
import { Button, LoadingSpinner, PageHeader, ExportButton } from '../components';
import { generateMusterStationPdf } from '../utils/musterStationPdf';
import type { MusterStationData } from '../services/musterStations';

const DEFAULT_SIGNALS = {
  fire: 'Fire alarm and continuous horn (10+ sec)',
  manOverboard: '3 prolonged blasts + general alarm (Oscar)',
  grounding: '7 short + 1 long blast, water ingress alarm',
  abandonShip: '1 prolonged + 1 short repeated, Captain announcement',
  medical: 'PA announcement – medical assistance required',
};

const EMERGENCY_SIGNAL_LABELS: Record<keyof typeof DEFAULT_SIGNALS, string> = {
  fire: 'Fire',
  manOverboard: 'Man Overboard',
  grounding: 'Grounding',
  abandonShip: 'Abandon Ship',
  medical: 'Medical',
};

const EMPTY_CREW = {
  roleName: '',
  fire: '',
  manOverboard: '',
  grounding: '',
  abandonShip: '',
  medical: '',
};

const CREW_DUTY_LABELS: Record<keyof typeof EMPTY_CREW, string> = {
  roleName: 'Role name',
  fire: 'Fire',
  manOverboard: 'Man Overboard',
  grounding: 'Grounding',
  abandonShip: 'Abandon Ship',
  medical: 'Medical',
};

const CREW_DUTY_FIELDS = [
  'roleName',
  'fire',
  'manOverboard',
  'grounding',
  'abandonShip',
  'medical',
] as const;

export const CreateMusterStationScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const musterStationId = route.params?.musterStationId as string | undefined;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const isEdit = !!musterStationId;
  const actionColor = themeColors.isDark ? themeColors.textPrimary : COLORS.primary;

  const [title, setTitle] = useState('');
  const [vesselName, setVesselName] = useState('');
  const [musterStationLocations, setMusterStationLocations] = useState<string[]>(['']);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: 'Edit Muster Station' });
    } else {
      navigation.setOptions({ title: 'Create Muster Station' });
    }
  }, [navigation, isEdit]);

  useEffect(() => {
    if (!vesselId) return;
    vesselService.getVessel(vesselId).then((vessel) => {
      if (vessel?.name) {
        setVesselName(vessel.name);
        if (!isEdit) {
          setTitle((current) => current || `${vessel.name} Muster Station and Duties`);
        }
      }
    });
  }, [isEdit, vesselId]);

  useEffect(() => {
    if (!musterStationId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const item = await musterStationsService.getById(musterStationId);
        if (item?.data) {
          const d = item.data;
          setTitle(item.title?.trim() || `${d.vesselName || 'Vessel'} Muster Station and Duties`);
          setVesselName(d.vesselName ?? '');
          const savedMusterLocations = getMusterStationLocations(d);
          setMusterStationLocations(savedMusterLocations.length ? savedMusterLocations : ['']);
          setMedicalChest(d.medicalChest?.length ? d.medicalChest : ['']);
          setGrabBag(d.grabBag?.length ? d.grabBag : ['']);
          setGrabBagContents(d.grabBagContents ?? '');
          setLifeRings(d.lifeRings?.length ? d.lifeRings : ['']);
          setEmergencySignals(d.emergencySignals ?? DEFAULT_SIGNALS);
          setCrewMembers(
            d.crewMembers?.length
              ? d.crewMembers.map((c) => ({
                  roleName: c.roleName ?? '',
                  fire: c.fire ?? '',
                  manOverboard: c.manOverboard ?? '',
                  grounding: c.grounding ?? '',
                  abandonShip: c.abandonShip ?? '',
                  medical: c.medical ?? '',
                }))
              : [{ ...EMPTY_CREW, roleName: 'Captain' }]
          );
        }
      } catch (e) {
        console.error('Load muster station error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [musterStationId]);
  const [medicalChest, setMedicalChest] = useState<string[]>(['']);
  const [grabBag, setGrabBag] = useState<string[]>(['']);
  const [grabBagContents, setGrabBagContents] = useState('');
  const [lifeRings, setLifeRings] = useState<string[]>(['']);
  const [emergencySignals, setEmergencySignals] = useState(DEFAULT_SIGNALS);
  const [crewMembers, setCrewMembers] = useState<(typeof EMPTY_CREW)[]>([
    { ...EMPTY_CREW, roleName: 'Captain' },
  ]);

  const musterStationLocationRefs = useRef<Array<TextInput | null>>([]);
  const medicalChestRefs = useRef<Array<TextInput | null>>([]);
  const grabBagRefs = useRef<Array<TextInput | null>>([]);
  const lifeRingRefs = useRef<Array<TextInput | null>>([]);
  const pendingLocationFocusRef = useRef<{
    refs: React.MutableRefObject<Array<TextInput | null>>;
    index: number;
  } | null>(null);
  const crewDutyRefs = useRef<Record<string, TextInput | null>>({});
  const crewFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  useEffect(
    () => () => {
      if (crewFocusTimerRef.current) clearTimeout(crewFocusTimerRef.current);
    },
    []
  );

  const shouldAutoFocusLocation = (
    refs: React.MutableRefObject<Array<TextInput | null>>,
    index: number
  ) => {
    const pending = pendingLocationFocusRef.current;
    return pending?.refs === refs && pending.index === index;
  };

  const registerLocationRef = (
    refs: React.MutableRefObject<Array<TextInput | null>>,
    index: number,
    input: TextInput | null
  ) => {
    refs.current[index] = input;
    const pending = pendingLocationFocusRef.current;
    if (input && pending?.refs === refs && pending.index === index) {
      pendingLocationFocusRef.current = null;
      setTimeout(() => {
        if (refs.current[index] === input) input.focus();
      }, 50);
    }
  };

  const addLocation = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<Array<TextInput | null>>,
    newIndex: number
  ) => {
    pendingLocationFocusRef.current = { refs, index: newIndex };
    setter((previous) => [...previous, '']);
  };
  const removeLocation = (setter: React.Dispatch<React.SetStateAction<string[]>>, i: number) => {
    setter((previous) =>
      previous.length <= 1 ? previous : previous.filter((_, idx) => idx !== i)
    );
  };
  const setLoc = (setter: React.Dispatch<React.SetStateAction<string[]>>, i: number, v: string) => {
    setter((previous) => {
      const next = [...previous];
      next[i] = v;
      return next;
    });
  };

  const addCrew = () =>
    setCrewMembers((previous) => [...previous, { ...EMPTY_CREW, roleName: 'New crew' }]);
  const removeCrew = (i: number) => {
    setCrewMembers((previous) =>
      previous.length <= 1 ? previous : previous.filter((_, idx) => idx !== i)
    );
  };
  const setCrew = (i: number, field: keyof typeof EMPTY_CREW, v: string) => {
    setCrewMembers((previous) => {
      const next = [...previous];
      next[i] = { ...next[i], [field]: v };
      return next;
    });
  };

  const focusNextCrewDuty = (crewIndex: number, field: keyof typeof EMPTY_CREW) => {
    const fieldIndex = CREW_DUTY_FIELDS.indexOf(field);
    const nextField = CREW_DUTY_FIELDS[fieldIndex + 1];
    const nextInputKey = nextField
      ? `${crewIndex}-${nextField}`
      : crewMembers[crewIndex + 1]
        ? `${crewIndex + 1}-roleName`
        : null;
    if (crewFocusTimerRef.current) clearTimeout(crewFocusTimerRef.current);
    if (!nextInputKey) {
      crewFocusTimerRef.current = setTimeout(() => {
        Keyboard.dismiss();
        crewFocusTimerRef.current = null;
      }, 75);
      return;
    }
    crewFocusTimerRef.current = setTimeout(() => {
      crewDutyRefs.current[nextInputKey]?.focus();
      crewFocusTimerRef.current = null;
    }, 75);
  };

  const buildData = (): MusterStationData => {
    const savedMusterLocations = musterStationLocations
      .map((location) => location.trim())
      .filter(Boolean);

    return {
      vesselName,
      musterStation: savedMusterLocations[0] ?? '',
      musterStationLocations: savedMusterLocations,
      medicalChest: medicalChest.filter(Boolean),
      grabBag: grabBag.filter(Boolean),
      grabBagContents,
      lifeRings: lifeRings.filter(Boolean),
      emergencySignals,
      crewMembers: crewMembers.filter((c) => c.roleName.trim()),
    };
  };

  const onExport = async () => {
    const data = buildData();
    const exportTitle = title.trim() || `${vesselName || 'Vessel'} Muster Station and Duties`;
    const fn = exportTitle.replace(/[^a-z0-9]/gi, '_') + '.pdf';
    await generateMusterStationPdf(data, fn, exportTitle);
  };

  const onPublish = async () => {
    if (!vesselId || !isHOD || savingRef.current) return;
    const publishedTitle = title.trim();
    if (!publishedTitle) {
      Alert.alert('Title Required', 'Enter a title for this muster station.');
      return;
    }
    const data = buildData();
    if (getMusterStationLocations(data).length === 0) {
      Alert.alert('Location Required', 'Enter at least one muster station location.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (isEdit && musterStationId) {
        await musterStationsService.update(musterStationId, publishedTitle, data);
      } else {
        await musterStationsService.create(vesselId, publishedTitle, data, user?.id);
      }
      navigation.goBack();
    } catch (e) {
      console.error('Publish error:', e);
      Alert.alert('Error', 'Could not publish');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text
          style={[
            styles.message,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Join a vessel to create a muster station.
        </Text>
      </View>
    );
  }

  if (!isHOD) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text
          style={[
            styles.message,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Only HODs and Captain have access.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader
        title={isEdit ? 'Edit Muster Station' : 'Create Muster Station'}
        actions={<ExportButton active={false} onPress={onExport} />}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: actionColor }]}>Muster Station Details</Text>
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Title</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: themeColors.control,
                borderColor: themeColors.border,
                color: themeColors.textPrimary,
              },
            ]}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Main Muster Station Plan"
            placeholderTextColor={themeColors.textMuted}
          />
          <Text style={[styles.label, { color: themeColors.textPrimary }]}>
            Muster Station Locations
          </Text>
          {musterStationLocations.map((location, index) => {
            const deleteDisabled = musterStationLocations.length <= 1;
            const deleteColor = deleteDisabled ? themeColors.textMuted : COLORS.danger;
            return (
              <View key={index} style={styles.row}>
                <TextInput
                  ref={(input) => {
                    registerLocationRef(musterStationLocationRefs, index, input);
                  }}
                  style={[
                    styles.input,
                    styles.flex,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={location}
                  onChangeText={(value) => setLoc(setMusterStationLocations, index, value)}
                  autoFocus={shouldAutoFocusLocation(musterStationLocationRefs, index)}
                  placeholder="e.g. Sundeck"
                  placeholderTextColor={themeColors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.deleteButton, { borderColor: deleteColor }]}
                  onPress={() => removeLocation(setMusterStationLocations, index)}
                  disabled={deleteDisabled}
                >
                  <Ionicons name="trash-outline" size={16} color={deleteColor} />
                  <Text style={[styles.deleteText, { color: deleteColor }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.addButton, { borderColor: actionColor }]}
            onPress={() =>
              addLocation(
                setMusterStationLocations,
                musterStationLocationRefs,
                musterStationLocations.length
              )
            }
          >
            <Ionicons name="add" size={18} color={actionColor} />
            <Text style={[styles.addText, { color: actionColor }]}>Add Location</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: actionColor }]}>
            Emergency Equipment Locations
          </Text>

          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Medical Bags</Text>
          {medicalChest.map((loc, i) => {
            const deleteDisabled = medicalChest.length <= 1;
            const deleteColor = deleteDisabled ? themeColors.textMuted : COLORS.danger;
            return (
              <View key={i} style={styles.row}>
                <TextInput
                  ref={(el) => registerLocationRef(medicalChestRefs, i, el)}
                  style={[
                    styles.input,
                    styles.flex,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={loc}
                  onChangeText={(v) => setLoc(setMedicalChest, i, v)}
                  autoFocus={shouldAutoFocusLocation(medicalChestRefs, i)}
                  placeholder="Location"
                  placeholderTextColor={themeColors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.deleteButton, { borderColor: deleteColor }]}
                  onPress={() => removeLocation(setMedicalChest, i)}
                  disabled={deleteDisabled}
                >
                  <Ionicons name="trash-outline" size={16} color={deleteColor} />
                  <Text style={[styles.deleteText, { color: deleteColor }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.addButton, styles.equipmentAddButton, { borderColor: actionColor }]}
            onPress={() => addLocation(setMedicalChest, medicalChestRefs, medicalChest.length)}
          >
            <Ionicons name="add" size={18} color={actionColor} />
            <Text style={[styles.addText, { color: actionColor }]}>Add Location</Text>
          </TouchableOpacity>

          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Grab Bags</Text>
          {grabBag.map((loc, i) => {
            const deleteDisabled = grabBag.length <= 1;
            const deleteColor = deleteDisabled ? themeColors.textMuted : COLORS.danger;
            return (
              <View key={i} style={styles.row}>
                <TextInput
                  ref={(el) => registerLocationRef(grabBagRefs, i, el)}
                  style={[
                    styles.input,
                    styles.flex,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={loc}
                  onChangeText={(v) => setLoc(setGrabBag, i, v)}
                  autoFocus={shouldAutoFocusLocation(grabBagRefs, i)}
                  placeholder="Location"
                  placeholderTextColor={themeColors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.deleteButton, { borderColor: deleteColor }]}
                  onPress={() => removeLocation(setGrabBag, i)}
                  disabled={deleteDisabled}
                >
                  <Ionicons name="trash-outline" size={16} color={deleteColor} />
                  <Text style={[styles.deleteText, { color: deleteColor }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.addButton, styles.equipmentAddButton, { borderColor: actionColor }]}
            onPress={() => addLocation(setGrabBag, grabBagRefs, grabBag.length)}
          >
            <Ionicons name="add" size={18} color={actionColor} />
            <Text style={[styles.addText, { color: actionColor }]}>Add Location</Text>
          </TouchableOpacity>

          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Grab Bag Contents</Text>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: themeColors.control,
                borderColor: themeColors.border,
                color: themeColors.textPrimary,
              },
            ]}
            value={grabBagContents}
            onChangeText={setGrabBagContents}
            placeholder="e.g. Flares, EPIRB, SART, VHF batteries, medical kit, water"
            placeholderTextColor={themeColors.textMuted}
            multiline
          />

          <Text style={[styles.label, { color: themeColors.textPrimary }]}>Life Rings</Text>
          {lifeRings.map((loc, i) => {
            const deleteDisabled = lifeRings.length <= 1;
            const deleteColor = deleteDisabled ? themeColors.textMuted : COLORS.danger;
            return (
              <View key={i} style={styles.row}>
                <TextInput
                  ref={(el) => registerLocationRef(lifeRingRefs, i, el)}
                  style={[
                    styles.input,
                    styles.flex,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={loc}
                  onChangeText={(v) => setLoc(setLifeRings, i, v)}
                  autoFocus={shouldAutoFocusLocation(lifeRingRefs, i)}
                  placeholder="Location"
                  placeholderTextColor={themeColors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.deleteButton, { borderColor: deleteColor }]}
                  onPress={() => removeLocation(setLifeRings, i)}
                  disabled={deleteDisabled}
                >
                  <Ionicons name="trash-outline" size={16} color={deleteColor} />
                  <Text style={[styles.deleteText, { color: deleteColor }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.addButton, { borderColor: actionColor }]}
            onPress={() => addLocation(setLifeRings, lifeRingRefs, lifeRings.length)}
          >
            <Ionicons name="add" size={18} color={actionColor} />
            <Text style={[styles.addText, { color: actionColor }]}>Add Location</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: actionColor }]}>Emergency Signals</Text>
          {(Object.keys(emergencySignals) as (keyof typeof DEFAULT_SIGNALS)[]).map((k) => (
            <View key={k} style={styles.fieldGroup}>
              <Text style={[styles.label, { color: themeColors.textPrimary }]}>
                {EMERGENCY_SIGNAL_LABELS[k]}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: themeColors.control,
                    borderColor: themeColors.border,
                    color: themeColors.textPrimary,
                  },
                ]}
                value={emergencySignals[k]}
                onChangeText={(v) => setEmergencySignals({ ...emergencySignals, [k]: v })}
                placeholderTextColor={themeColors.textMuted}
              />
            </View>
          ))}
        </View>

        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: actionColor }]}>Crew Duties</Text>
          {crewMembers.map((c, i) => {
            const deleteDisabled = crewMembers.length <= 1;
            const deleteColor = deleteDisabled ? themeColors.textMuted : COLORS.danger;
            return (
              <View
                key={i}
                style={[
                  styles.crewCard,
                  { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border },
                ]}
              >
                <View style={styles.crewHeader}>
                  <Text style={[styles.crewTitle, { color: actionColor }]}>
                    Crew Member {i + 1}
                  </Text>
                  <TouchableOpacity
                    style={[styles.deleteButton, { borderColor: deleteColor }]}
                    onPress={() => removeCrew(i)}
                    disabled={deleteDisabled}
                  >
                    <Ionicons name="trash-outline" size={16} color={deleteColor} />
                    <Text style={[styles.deleteText, { color: deleteColor }]}>Delete</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { color: themeColors.textPrimary }]}>Role Name</Text>
                <TextInput
                  ref={(el) => {
                    crewDutyRefs.current[`${i}-roleName`] = el;
                  }}
                  style={[
                    styles.input,
                    {
                      backgroundColor: themeColors.control,
                      borderColor: themeColors.border,
                      color: themeColors.textPrimary,
                    },
                  ]}
                  value={c.roleName}
                  onChangeText={(v) => setCrew(i, 'roleName', v)}
                  placeholder="Role name"
                  placeholderTextColor={themeColors.textMuted}
                  returnKeyType="next"
                  submitBehavior="blurAndSubmit"
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Enter') focusNextCrewDuty(i, 'roleName');
                  }}
                  onSubmitEditing={() => focusNextCrewDuty(i, 'roleName')}
                />

                {(['fire', 'manOverboard', 'grounding', 'abandonShip', 'medical'] as const).map(
                  (f) => (
                    <View key={f} style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: themeColors.textPrimary }]}>
                        {CREW_DUTY_LABELS[f]} Duty
                      </Text>
                      <TextInput
                        ref={(el) => {
                          crewDutyRefs.current[`${i}-${f}`] = el;
                        }}
                        style={[
                          styles.input,
                          {
                            backgroundColor: themeColors.control,
                            borderColor: themeColors.border,
                            color: themeColors.textPrimary,
                          },
                        ]}
                        value={c[f]}
                        onChangeText={(v) => setCrew(i, f, v)}
                        placeholder={CREW_DUTY_LABELS[f]}
                        placeholderTextColor={themeColors.textMuted}
                        returnKeyType={
                          f === 'medical' && i === crewMembers.length - 1 ? 'done' : 'next'
                        }
                        submitBehavior="blurAndSubmit"
                        onKeyPress={({ nativeEvent }) => {
                          if (nativeEvent.key === 'Enter') focusNextCrewDuty(i, f);
                        }}
                        onSubmitEditing={() => focusNextCrewDuty(i, f)}
                      />
                    </View>
                  )
                )}
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.addButton, { borderColor: actionColor }]}
            onPress={addCrew}
          >
            <Ionicons name="add" size={18} color={actionColor} />
            <Text style={[styles.addText, { color: actionColor }]}>Add Crew Member</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Publish Muster Station'}
            onPress={onPublish}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
            style={styles.btn}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding + 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  input: {
    minHeight: 48,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  flex: { flex: 1 },
  deleteButton: {
    minHeight: 42,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: SPACING.sm,
  },
  deleteText: { fontSize: FONTS.xs, fontWeight: '700' },
  addButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  addText: { fontSize: FONTS.sm, fontWeight: '700' },
  equipmentAddButton: { marginBottom: SPACING.md },
  fieldGroup: { marginTop: SPACING.sm },
  crewCard: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
  },
  crewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  crewTitle: { fontSize: FONTS.sm, fontWeight: '700' },
  actions: { marginTop: SPACING.sm, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
