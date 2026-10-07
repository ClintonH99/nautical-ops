import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { Button } from './Button';
import type { BillingLocation } from '../services/paddlePricing';

// ISO country names are labels only; supported markets and taxes are verified by Paddle.
const codes =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' '
  );
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const billingCountries = codes
  .map((code) => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));
export const billingCountryName = (code: string) => names.of(code) ?? code;

export function BillingCountryPicker({
  visible,
  value,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  value: BillingLocation | null;
  onClose: () => void;
  onConfirm: (value: BillingLocation) => void;
}) {
  const theme = useThemeColors();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [postal, setPostal] = useState('');
  useEffect(() => {
    if (visible) {
      setSearch('');
      setCountry(value?.countryCode ?? '');
      setPostal(value?.postalCode ?? '');
    }
  }, [visible, value]);
  const requiredPostal = ['US', 'CA'].includes(country);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <View style={styles.row}>
              <Text
                accessibilityRole="header"
                style={[styles.heading, { color: theme.textPrimary }]}
              >
                Billing country
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close billing country"
                onPress={onClose}
                style={styles.close}
              >
                <Text style={{ color: theme.textPrimary }}>Close</Text>
              </Pressable>
            </View>
            <Text style={[styles.copy, { color: theme.textSecondary }]}>
              Choose the country of your billing address, not your vessel’s current location.
            </Text>
            <KeyboardAvoidingView>
              <TextInput
                accessibilityLabel="Search countries"
                placeholder="Search countries"
                value={search}
                onChangeText={setSearch}
                style={[
                  styles.input,
                  { backgroundColor: '#fff', color: '#111', borderColor: theme.border },
                ]}
                placeholderTextColor="#555"
              />
            </KeyboardAvoidingView>
            <ScrollView style={styles.countries} keyboardShouldPersistTaps="handled">
              {billingCountries
                .filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(search.toLowerCase()))
                .map((c) => (
                  <Pressable
                    key={c.code}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: country === c.code }}
                    onPress={() => {
                      if (country !== c.code) setPostal('');
                      setCountry(c.code);
                    }}
                    style={[
                      styles.country,
                      { borderColor: country === c.code ? theme.controlSelected : theme.border },
                    ]}
                  >
                    <Text style={{ color: theme.textPrimary, flex: 1 }}>{c.name}</Text>
                    <Text style={{ color: theme.textPrimary }}>
                      {country === c.code ? '●' : '○'}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
            <Text style={{ color: theme.textPrimary }}>
              ZIP / postal code{requiredPostal ? ' (required)' : ' (optional)'}
            </Text>
            <KeyboardAvoidingView>
              <TextInput
                accessibilityLabel="Billing ZIP or postal code"
                value={postal}
                onChangeText={setPostal}
                maxLength={32}
                autoCapitalize="characters"
                placeholder="Billing ZIP / postal code"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  {
                    color: theme.textPrimary,
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              />
            </KeyboardAvoidingView>
            <Text style={[styles.copy, { color: theme.textSecondary }]}>
              The same USD base prices apply worldwide. Applicable tax is calculated by Paddle. Your
              total updates before checkout.
            </Text>
            <Button
              title="Confirm Country"
              disabled={!country || (requiredPostal && !postal.trim())}
              onPress={() => onConfirm({ countryCode: country, postalCode: postal.trim() })}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '95%', borderWidth: 1, borderRadius: 20 },
  body: { padding: 20, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 22, fontWeight: '700', flex: 1 },
  close: { minHeight: 44, padding: 10, justifyContent: 'center' },
  copy: { fontSize: 14, lineHeight: 21 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 },
  countries: { maxHeight: 220 },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 6,
  },
});
