/**
 * Create Muster Station Screen
 * Fill-in form for muster station plan, Export to PDF, Publish
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import musterStationsService from '../services/musterStations';
import vesselService from '../services/vessel';
import { Button } from '../components';
import { generateMusterStationPdf } from '../utils/musterStationPdf';
import type { MusterStationData } from '../services/musterStations';

const DEFAULT_SIGNALS = {
  fire: 'Fire alarm and continuous horn (10+ sec)',
  manOverboard: '3 prolonged blasts + general alarm (Oscar)',
  grounding: '7 short + 1 long blast, water ingress alarm',
  abandonShip: '1 prolonged + 1 short repeated, Captain announcement',
  medical: 'PA announcement – medical assistance required',
};

const EMPTY_CREW = {
  roleName: '',
  fire: '',
  manOverboard: '',
  grounding: '',
  abandonShip: '',
  medical: '',
};

export const CreateMusterStationScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const musterStationId = route.params?.musterStationId as string | undefined;
  const isHOD = user?.role === 'HOD';
  const isEdit = !!musterStationId;

  const [vesselName, setVesselName] = useState('');
  const [musterStation, setMusterStation] = useState('');
  const [loading, setLoading] = useState(isEdit);

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
      if (vessel?.name) setVesselName(vessel.name);
    });
  }, [vesselId]);

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
          setVesselName(d.vesselName ?? '');
          setMusterStation(d.musterStation ?? '');
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
  const [crewMembers, setCrewMembers] = useState<typeof EMPTY_CREW[]>([
    { ...EMPTY_CREW, roleName: 'Captain' },
  ]);

  const addLocation = (setter: React.Dispatch<React.SetStateAction<string[]>>, arr: string[]) => {
    setter([...arr, '']);
  };
  const removeLocation = (setter: React.Dispatch<React.SetStateAction<string[]>>, arr: string[], i: number) => {
    if (arr.length <= 1) return;
    setter(arr.filter((_, idx) => idx !== i));
  };
  const setLoc = (setter: React.Dispatch<React.SetStateAction<string[]>>, arr: string[], i: number, v: string) => {
    const next = [...arr];
    next[i] = v;
    setter(next);
  };

  const addCrew = () => setCrewMembers([...crewMembers, { ...EMPTY_CREW, roleName: 'New crew' }]);
  const removeCrew = (i: number) => {
    if (crewMembers.length <= 1) return;
    setCrewMembers(crewMembers.filter((_, idx) => idx !== i));
  };
  const setCrew = (i: number, field: keyof typeof EMPTY_CREW, v: string) => {
    const next = [...crewMembers];
    next[i] = { ...next[i], [field]: v };
    setCrewMembers(next);
  };

  const buildData = (): MusterStationData => ({
    vesselName,
    musterStation,
    medicalChest: medicalChest.filter(Boolean),
    grabBag: grabBag.filter(Boolean),
    grabBagContents,
    lifeRings: lifeRings.filter(Boolean),
    emergencySignals,
    crewMembers: crewMembers.filter((c) => c.roleName.trim()),
  });

  const onExport = async () => {
    const data = buildData();
    const fn = (vesselName || 'Muster').replace(/[^a-z0-9]/gi, '_') + '_Muster_Station_and_Duties.pdf';
    await generateMusterStationPdf(data, fn);
  };

  const onPublish = async () => {
    if (!vesselId || !isHOD) return;
    const data = buildData();
    const title = `${vesselName || 'Vessel'} Muster Station and Duties`;
    try {
      if (isEdit && musterStationId) {
        await musterStationsService.update(musterStationId, title, data);
      } else {
        await musterStationsService.create(vesselId, title, data, user?.id);
      }
      navigation.goBack();
    } catch (e) {
      console.error('Publish error:', e);
      Alert.alert('Error', 'Could not publish');
    }
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to create a muster station.</Text>
      </View>
    );
  }

  if (!isHOD) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Only HODs can create or edit muster stations.</Text>
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
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: themeColors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Muster station location</Text>
        <TextInput
          style={[styles.input, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
          value={musterStation}
          onChangeText={setMusterStation}
          placeholder="e.g. Sundeck"
          placeholderTextColor={COLORS.textTertiary}
        />
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Medical chest locations</Text>
        {medicalChest.map((loc, i) => (
          <View key={i} style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={loc}
              onChangeText={(v) => setLoc(setMedicalChest, medicalChest, i, v)}
              placeholder="Location"
              placeholderTextColor={COLORS.textTertiary}
            />
            <TouchableOpacity onPress={() => removeLocation(setMedicalChest, medicalChest, i)}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={() => addLocation(setMedicalChest, medicalChest)}>
          <Text style={styles.add}>+ Add location</Text>
        </TouchableOpacity>

        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Grab bag locations</Text>
        {grabBag.map((loc, i) => (
          <View key={i} style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={loc}
              onChangeText={(v) => setLoc(setGrabBag, grabBag, i, v)}
              placeholder="Location"
              placeholderTextColor={COLORS.textTertiary}
            />
            <TouchableOpacity onPress={() => removeLocation(setGrabBag, grabBag, i)}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={() => addLocation(setGrabBag, grabBag)}>
          <Text style={styles.add}>+ Add location</Text>
        </TouchableOpacity>

        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Grab bag contents</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
          value={grabBagContents}
          onChangeText={setGrabBagContents}
          placeholder="e.g. Flares, EPIRB, SART, VHF batteries, medical kit, water"
          placeholderTextColor={COLORS.textTertiary}
          multiline
        />

        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Life rings</Text>
        {lifeRings.map((loc, i) => (
          <View key={i} style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={loc}
              onChangeText={(v) => setLoc(setLifeRings, lifeRings, i, v)}
              placeholder="Location"
              placeholderTextColor={COLORS.textTertiary}
            />
            <TouchableOpacity onPress={() => removeLocation(setLifeRings, lifeRings, i)}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={() => addLocation(setLifeRings, lifeRings)}>
          <Text style={styles.add}>+ Add location</Text>
        </TouchableOpacity>

        <Text style={[styles.section, { color: themeColors.textPrimary }]}>Emergency signals</Text>
        {(Object.keys(emergencySignals) as (keyof typeof DEFAULT_SIGNALS)[]).map((k) => (
          <View key={k}>
            <Text style={[styles.smlabel, { color: themeColors.textSecondary }]}>{k}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
              value={emergencySignals[k]}
              onChangeText={(v) => setEmergencySignals({ ...emergencySignals, [k]: v })}
              placeholderTextColor={COLORS.textTertiary}
            />
          </View>
        ))}

        <Text style={[styles.section, { color: themeColors.textPrimary }]}>Crew duties</Text>
        {crewMembers.map((c, i) => (
          <View key={i} style={[styles.crewCard, { backgroundColor: themeColors.surface }]}>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
                value={c.roleName}
                onChangeText={(v) => setCrew(i, 'roleName', v)}
                placeholder="Role name"
                placeholderTextColor={COLORS.textTertiary}
              />
              <TouchableOpacity onPress={() => removeCrew(i)}>
                <Text style={styles.remove}>✕ Remove</Text>
              </TouchableOpacity>
            </View>
            {(['fire', 'manOverboard', 'grounding', 'abandonShip', 'medical'] as const).map((f) => (
              <TextInput
                key={f}
                style={[styles.input, styles.sm, { backgroundColor: themeColors.surface, color: themeColors.textPrimary }]}
                value={c[f]}
                onChangeText={(v) => setCrew(i, f, v)}
                placeholder={f}
                placeholderTextColor={COLORS.textTertiary}
              />
            ))}
          </View>
        ))}
        <TouchableOpacity onPress={addCrew}>
          <Text style={styles.add}>+ Add crew member</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <Button title="Export to PDF" onPress={onExport} variant="outline" fullWidth style={styles.btn} />
          <Button title={isEdit ? 'Save' : 'Publish'} onPress={onPublish} variant="primary" fullWidth style={styles.btn} />
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
  label: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: 4, marginTop: SPACING.md },
  smlabel: { fontSize: FONTS.xs, marginBottom: 2 },
  section: { fontSize: FONTS.lg, fontWeight: '700', marginTop: SPACING.xl, marginBottom: SPACING.sm },
  input: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  sm: { marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  flex: { flex: 1 },
  remove: { fontSize: FONTS.sm, color: COLORS.primary },
  add: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600', marginBottom: SPACING.sm },
  crewCard: { padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  actions: { marginTop: SPACING.xl, gap: SPACING.md },
  btn: { marginBottom: SPACING.sm },
});
