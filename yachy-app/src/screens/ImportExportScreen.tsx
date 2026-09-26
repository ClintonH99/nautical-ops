import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
/**
 * Import/Export Screen
 * Download Excel templates and import data for Tasks, Maintenance Log, Yard Period
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselTasksService from '../services/vesselTasks';
import maintenanceLogsService from '../services/maintenanceLogs';
import yardJobsService from '../services/yardJobs';
import {
  downloadTemplate,
  MAX_IMPORT_FILE_BYTES,
  parseTasksFile,
  parseMaintenanceFile,
  parseYardFile,
  parseInventoryFile,
  TemplateType,
} from '../services/excelTemplates';
import { PageHeader } from '../components';
import inventoryService from '../services/inventory';

const IMPORT_EXPORT_INFO = {
  title: 'Import / Export',
  description: 'Move vessel data in and out of the app.',
  features: [
    'Export vessel data for backup or sharing',
    'Import data into the app',
    'Keep records portable between devices',
    'Transfer information when handing over',
  ],
};

export const ImportExportScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [downloading, setDownloading] = useState<TemplateType | null>(null);
  const [importing, setImporting] = useState<TemplateType | null>(null);

  const vesselId = user?.vesselId ?? null;

  const handleDownload = async (type: TemplateType) => {
    setDownloading(type);
    try {
      await downloadTemplate(type);
    } catch (e) {
      console.error('Download template error:', e);
      Alert.alert('Error', 'Could not create template.');
    } finally {
      setDownloading(null);
    }
  };

  const handleImport = async (type: TemplateType) => {
    if (!vesselId) {
      Alert.alert('No vessel', 'Join a vessel to import data.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const selectedFile = result.assets[0];
      if (selectedFile.size && selectedFile.size > MAX_IMPORT_FILE_BYTES) {
        Alert.alert('File too large', 'Choose an Excel spreadsheet smaller than 10 MB.');
        return;
      }

      const uri = selectedFile.uri;
      setImporting(type);

      if (type === 'tasks') {
        const { success, errors } = await parseTasksFile(uri);
        if (success.length === 0 && errors.length > 0) {
          Alert.alert('Import failed', errors.map((e) => `Row ${e.row}: ${e.message}`).join('\n'));
          return;
        }
        let imported = 0;
        for (const row of success) {
          try {
            await vesselTasksService.create({
              vesselId,
              category: row.category as 'DAILY' | 'WEEKLY' | 'MONTHLY',
              department: (row.department || user?.department || 'INTERIOR') as
                | 'BRIDGE'
                | 'ENGINEERING'
                | 'EXTERIOR'
                | 'INTERIOR'
                | 'GALLEY',
              title: row.title,
              notes: row.notes,
              doneByDate: row.doneByDate || undefined,
              recurring: (row.recurring as '7_DAYS' | '14_DAYS' | '30_DAYS') || undefined,
            });
            imported++;
          } catch (e) {
            console.error('Import task error:', e);
            errors.push({ row: imported + 1, message: (e as Error).message });
          }
        }
        const errMsg = errors.length > 0 ? `\n\n${errors.length} row(s) had errors.` : '';
        Alert.alert('Import complete', `Imported ${imported} task(s).${errMsg}`);
      } else if (type === 'maintenance') {
        const { success, errors } = await parseMaintenanceFile(uri);
        if (success.length === 0 && errors.length > 0) {
          Alert.alert('Import failed', errors.map((e) => `Row ${e.row}: ${e.message}`).join('\n'));
          return;
        }
        let imported = 0;
        for (const row of success) {
          try {
            await maintenanceLogsService.create({
              vesselId,
              equipment: row.equipment,
              portStarboardNa: row.location,
              serialNumber: row.serialNumber,
              hoursOfService: row.hoursOfService,
              hoursAtNextService: row.hoursAtNextService,
              whatServiceDone: row.whatServiceDone,
              notes: row.notes,
              serviceDoneBy: row.serviceDoneBy,
            });
            imported++;
          } catch (e) {
            console.error('Import maintenance log error:', e);
            errors.push({ row: imported + 1, message: (e as Error).message });
          }
        }
        const errMsg = errors.length > 0 ? `\n\n${errors.length} row(s) had errors.` : '';
        Alert.alert('Import complete', `Imported ${imported} maintenance log(s).${errMsg}`);
      } else if (type === 'yard') {
        const { success, errors } = await parseYardFile(uri);
        if (success.length === 0 && errors.length > 0) {
          Alert.alert('Import failed', errors.map((e) => `Row ${e.row}: ${e.message}`).join('\n'));
          return;
        }
        let imported = 0;
        for (const row of success) {
          try {
            if (!vesselId) throw new Error('No vessel selected.');
            await yardJobsService.create({
              vesselId,
              jobTitle: row.jobTitle,
              jobDescription: row.jobDescription,
              defectDetails: row.defectDetails,
              defectLocation: row.defectLocation,
              equipmentSerial: row.equipmentSerial,
              priority: row.priority ?? 'GREEN',
              startDate: row.startDate,
              endDate: row.endDate,
              department: (row.department || user?.department || 'INTERIOR') as
                | 'BRIDGE'
                | 'ENGINEERING'
                | 'EXTERIOR'
                | 'INTERIOR'
                | 'GALLEY',
              yardLocation: row.yardLocation,
              contractorCompanyName: row.contractorCompanyName,
              contactDetails: row.contactDetails,
            });
            imported++;
          } catch (e) {
            console.error('Import yard period error:', e);
            errors.push({ row: imported + 1, message: (e as Error).message });
          }
        }
        const errMsg = errors.length > 0 ? `\n\n${errors.length} row(s) had errors.` : '';
        Alert.alert('Import complete', `Imported ${imported} shipyard job(s).${errMsg}`);
      } else if (type === 'inventory') {
        const { success, errors } = await parseInventoryFile(uri);
        if (success.length === 0 && errors.length > 0) {
          Alert.alert('Import failed', errors.map((e) => `Row ${e.row}: ${e.message}`).join('\n'));
          return;
        }
        const VALID_DEPTS = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
        let imported = 0;
        for (const row of success) {
          const safeDept = VALID_DEPTS.includes((row.department ?? '').toUpperCase())
            ? row.department.toUpperCase()
            : 'INTERIOR';
          try {
            await inventoryService.create({
              vesselId,
              department: safeDept as any,
              title: row.title,
              location: row.location ?? '',
              description: row.description ?? '',
              items: row.items,
              lastEditedByName: user?.name ?? 'Unknown',
            });
            imported++;
          } catch (e: any) {
            console.error(
              'Import inventory error — row data:',
              { dept: safeDept, title: row.title },
              e
            );
            const isConstraintError =
              e?.code === '23514' || e?.message?.includes('department_check');
            const msg = isConstraintError
              ? `Department "${safeDept}" rejected by database. Run FIX_INVENTORY_DEPARTMENT_CONSTRAINT.sql in Supabase.`
              : (e as Error).message;
            errors.push({ row: imported + 1, message: msg });
          }
        }
        const errMsg = errors.length > 0 ? `\n\n${errors.length} row(s) had errors.` : '';
        Alert.alert(
          'Import complete',
          `${imported} inventory item(s) imported successfully.${errMsg}`,
          [
            {
              text: 'Go to Inventory',
              onPress: () => navigation.navigate('Inventory'),
            },
            { text: 'OK', style: 'cancel' },
          ]
        );
      }
    } catch (e) {
      console.error('Import error:', e);
      Alert.alert('Error', 'Could not import file.');
    } finally {
      setImporting(null);
    }
  };

  const TemplateSection = ({
    type,
    title,
    icon,
    description,
  }: {
    type: TemplateType;
    title: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    description: string;
  }) => {
    const downloadActive = downloading === type;
    const importActive = importing === type;
    const downloadDisabled = !!downloading;
    const importDisabled = !!importing || !vesselId;
    const outlineColor = themeColors.isDark ? COLORS.white : COLORS.primary;

    return (
      <View
        style={[
          styles.section,
          {
            backgroundColor: themeColors.surface,
            borderColor: themeColors.border,
          },
        ]}
      >
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIcon, { backgroundColor: themeColors.accentSoft }]}>
            <Ionicons name={icon} size={19} color={outlineColor} />
          </View>
          <Text style={[styles.sectionTitle, { color: outlineColor }]}>{title}</Text>
        </View>
        <Text style={[styles.sectionDesc, { color: themeColors.textSecondary }]}>
          {description}
        </Text>
        {!vesselId && (
          <Text style={[styles.vesselNote, { color: themeColors.textSecondary }]}>
            Join a vessel to import data.
          </Text>
        )}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.downloadButton,
              { borderColor: outlineColor },
              downloadDisabled && styles.disabledButton,
            ]}
            onPress={() => handleDownload(type)}
            disabled={downloadDisabled}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Download ${title} template`}
          >
            {downloadActive ? (
              <ActivityIndicator size="small" color={outlineColor} />
            ) : (
              <Ionicons name="download-outline" size={17} color={outlineColor} />
            )}
            <Text style={[styles.actionButtonText, { color: outlineColor }]}>
              {downloadActive ? 'Creating…' : 'Download Template'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.importButton,
              importDisabled && styles.disabledButton,
            ]}
            onPress={() => handleImport(type)}
            disabled={importDisabled}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Import ${title} from file`}
          >
            {importActive ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={17} color={COLORS.white} />
            )}
            <Text style={[styles.actionButtonText, styles.importButtonText]}>
              {importActive ? 'Importing…' : 'Import from File'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Import / Export" info={IMPORT_EXPORT_INFO} infoScreenKey="import_export" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
        <View style={styles.content}>
          <Text style={[styles.intro, { color: themeColors.textSecondary }]}>
            Download a template, complete it in Excel or Google Sheets, then import the file here.
          </Text>

          <TemplateSection
            type="tasks"
            title="Tasks"
            icon="checkbox-outline"
            description="Daily, Weekly and Monthly tasks, including department, dates, notes and recurring schedules."
          />
          <TemplateSection
            type="maintenance"
            title="Maintenance Log"
            icon="build-outline"
            description="Equipment, location, serial numbers, service hours, work completed and service notes."
          />
          <TemplateSection
            type="yard"
            title="Shipyard List"
            icon="boat-outline"
            description="Shipyard jobs, departments, priority, dates, yard location and contractor details."
          />
          <TemplateSection
            type="inventory"
            title="Inventory"
            icon="cube-outline"
            description="Inventory items, quantities, departments, storage locations and descriptions."
          />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: {
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
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  intro: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.lg,
    lineHeight: 21,
    textAlign: 'center',
  },
  vesselNote: {
    fontSize: FONTS.sm,
    color: COLORS.warning,
    marginBottom: SPACING.sm,
  },
  section: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sectionIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    flex: 1,
  },
  sectionDesc: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  downloadButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  importButton: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  actionButtonText: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  importButtonText: {
    color: COLORS.white,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
