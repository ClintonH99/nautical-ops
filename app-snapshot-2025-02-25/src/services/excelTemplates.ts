/**
 * Excel Template Service
 * Generate downloadable templates and parse imported files for Tasks, Maintenance Log, Yard Period
 */

import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

/** Encode bytes to base64. Uses base64-js when available; fallback for React Native bundling issues. */
function bytesToBase64(bytes: Uint8Array): string {
  try {
    const base64Js = require('base64-js');
    const fn = base64Js.fromByteArray ?? base64Js.default?.fromByteArray;
    if (typeof fn === 'function') return fn(bytes);
  } catch {
    // ignore
  }
  const key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] ?? 0;
    const b2 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += key[b1 >> 2] + key[((b1 & 3) << 4) | (b2 >> 4)] + key[((b2 & 15) << 2) | (b3 >> 6)] + key[b3 & 63];
  }
  const pad = bytes.length % 3;
  return out + (pad === 1 ? '==' : pad === 2 ? '=' : '');
}

export type TemplateType = 'tasks' | 'maintenance' | 'yard' | 'inventory';

// --- TASKS TEMPLATE ---
const TASKS_HEADERS = [
  'Department (BRIDGE/ENGINEERING/EXTERIOR/INTERIOR/GALLEY)',
  'Category (DAILY/WEEKLY/MONTHLY)',
  'Title',
  'Notes',
  'Done By Date (YYYY-MM-DD)',
  'Recurring (7_DAYS/14_DAYS/30_DAYS or leave blank)',
];

// --- MAINTENANCE LOG TEMPLATE ---
const MAINTENANCE_HEADERS = [
  'Equipment',
  'Location',
  'Serial Number',
  'Hours of Service',
  'Hours at Next Service',
  'What Service Done',
  'Notes',
  'Service Done By',
];

// --- YARD PERIOD TEMPLATE ---
const YARD_HEADERS = [
  'Job Title',
  'Job Description',
  'Department (BRIDGE/ENGINEERING/EXTERIOR/INTERIOR/GALLEY)',
  'Priority (GREEN/YELLOW/RED)',
  'Yard Location',
  'Contractor Company Name',
  'Contact Details',
  'Done By Date (YYYY-MM-DD)',
];

// --- INVENTORY TEMPLATE ---
// One row per inventory entry. Department is inferred from the sheet/tab name.
const INVENTORY_HEADERS = [
  'Title',
  'Location',
  'Description',
  'Amount 1', 'Item 1',
];

const INFO_DUMP_EXPLANATION =
  'This page is for dropping all your information here. You can then copy and paste into the respective category tabs.';

const VALID_RECURRING = ['7_DAYS', '14_DAYS', '30_DAYS'] as const;

/** Convert Excel serial date (e.g. 45706) to YYYY-MM-DD; pass through already-valid date strings. */
function normalizeDateForImport(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const n = parseInt(s, 10);
  if (!Number.isNaN(n) && n >= 1 && s.length >= 5) {
    const date = new Date((n - 25569) * 86400 * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

/** Only allow DB values '7_DAYS' | '14_DAYS' | '30_DAYS' or null (empty/invalid -> null). */
function normalizeRecurringForImport(raw: string | null | undefined): (typeof VALID_RECURRING)[number] | null {
  const s = (raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!s) return null;
  const v = s as (typeof VALID_RECURRING)[number];
  return VALID_RECURRING.includes(v) ? v : null;
}

function createInfoDumpSheet(): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[INFO_DUMP_EXPLANATION]]);
  ws['!cols'] = [{ wch: 80 }];
  return ws;
}

function createSheetWithHeaders(headers: string[], exampleRow?: string[]): XLSX.WorkSheet {
  const data = [headers];
  if (exampleRow) {
    data.push(exampleRow);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  return ws;
}

function createTasksWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, createInfoDumpSheet(), 'Info Dump');
  XLSX.utils.book_append_sheet(wb, createSheetWithHeaders(TASKS_HEADERS, ['GALLEY', 'DAILY', 'Example daily task', 'Optional notes', '2025-12-31', '']), 'Daily');
  XLSX.utils.book_append_sheet(wb, createSheetWithHeaders(TASKS_HEADERS, ['EXTERIOR', 'WEEKLY', 'Example weekly task', 'Optional notes', '2025-12-31', '7_DAYS']), 'Weekly');
  XLSX.utils.book_append_sheet(wb, createSheetWithHeaders(TASKS_HEADERS, ['ENGINEERING', 'MONTHLY', 'Example monthly task', 'Optional notes', '2025-12-31', '30_DAYS']), 'Monthly');
  return wb;
}

function createMaintenanceWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, createInfoDumpSheet(), 'Info Dump');
  XLSX.utils.book_append_sheet(
    wb,
    createSheetWithHeaders(MAINTENANCE_HEADERS, [
      'Generators',
      'Engine Room',
      'SN-12345',
      '1250',
      '1500',
      'Oil change, filter replacement',
      'Optional notes',
      'John Smith (Crew)',
    ]),
    'Maintenance Log'
  );
  return wb;
}

function createYardWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, createInfoDumpSheet(), 'Info Dump');
  XLSX.utils.book_append_sheet(
    wb,
    createSheetWithHeaders(YARD_HEADERS, [
      'Hull Paint',
      'Full hull repaint',
      'EXTERIOR',
      'GREEN',
      'Marina XYZ',
      'ABC Marine',
      'contact@abc.com',
      '2025-12-31',
    ]),
    'Yard Period Jobs'
  );
  return wb;
}

const INVENTORY_DEPARTMENTS: { label: string }[] = [
  { label: 'Bridge'      },
  { label: 'Engineering' },
  { label: 'Exterior'    },
  { label: 'Interior'    },
  { label: 'Galley'      },
];

function createInventoryWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, createInfoDumpSheet(), 'Info Dump');
  for (const dept of INVENTORY_DEPARTMENTS) {
    XLSX.utils.book_append_sheet(
      wb,
      createSheetWithHeaders(INVENTORY_HEADERS),
      dept.label
    );
  }
  return wb;
}

export async function downloadTemplate(type: TemplateType): Promise<void> {
  let wb: XLSX.WorkBook;
  let fileLabel: string;

  switch (type) {
    case 'tasks':
      wb = createTasksWorkbook();
      fileLabel = 'Tasks';
      break;
    case 'maintenance':
      wb = createMaintenanceWorkbook();
      fileLabel = 'Maintenance_Log';
      break;
    case 'yard':
      wb = createYardWorkbook();
      fileLabel = 'Yard_Period_Jobs';
      break;
    case 'inventory':
      wb = createInventoryWorkbook();
      fileLabel = 'Inventory';
      break;
  }

  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const base64 = bytesToBase64(new Uint8Array(arr));
  const filename = `Nautical_Ops_${fileLabel}_Template.xlsx`;
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: 'base64',
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: `Save ${fileLabel.replace(/_/g, ' ')} Template`,
    });
  } else {
    Alert.alert('Template ready', `Template saved to ${uri}. Sharing not available.`);
  }
}

const VALID_DEPARTMENTS = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'] as const;

export interface ParsedTask {
  department: string;
  category: string;
  title: string;
  notes?: string;
  doneByDate?: string | null;
  recurring?: string | null;
}

export interface ParsedMaintenance {
  equipment: string;
  location?: string;
  serialNumber?: string;
  hoursOfService?: string;
  hoursAtNextService?: string;
  whatServiceDone?: string;
  notes?: string;
  serviceDoneBy: string;
}

export interface ParsedYardJob {
  jobTitle: string;
  jobDescription?: string;
  department?: string;
  priority?: string;
  yardLocation?: string;
  contractorCompanyName?: string;
  contactDetails?: string;
  doneByDate?: string | null;
}

export interface ParseResult<T> {
  success: T[];
  errors: { row: number; message: string }[];
}

export function parseTasksFile(uri: string): Promise<ParseResult<ParsedTask>> {
  return parseFile(uri, 'tasks', (row, rowNum, headerMap) => {
    const deptRaw = (headerMap['Department (BRIDGE/ENGINEERING/EXTERIOR/INTERIOR/GALLEY)'] ?? headerMap['Department'] ?? '').trim().toUpperCase();
    const category = (headerMap['Category (DAILY/WEEKLY/MONTHLY)'] ?? headerMap['Category'] ?? '').trim().toUpperCase();
    const title = (headerMap['Title'] ?? '').trim();
    if (!title) return null;
    const validCategories = ['DAILY', 'WEEKLY', 'MONTHLY'];
    if (category && !validCategories.includes(category)) {
      throw new Error(`Invalid category "${category}". Use DAILY, WEEKLY, or MONTHLY.`);
    }
    const department = deptRaw && VALID_DEPARTMENTS.includes(deptRaw as (typeof VALID_DEPARTMENTS)[number])
      ? deptRaw
      : 'INTERIOR';
    const doneByDateRaw = (headerMap['Done By Date (YYYY-MM-DD)'] ?? headerMap['Done By Date'] ?? '').trim() || null;
    const recurringRaw = (headerMap['Recurring (7_DAYS/14_DAYS/30_DAYS or leave blank)'] ?? headerMap['Recurring'] ?? '').trim() || null;
    return {
      department,
      category: category || 'DAILY',
      title,
      notes: (headerMap['Notes'] ?? '').trim() || undefined,
      doneByDate: normalizeDateForImport(doneByDateRaw),
      recurring: normalizeRecurringForImport(recurringRaw),
    };
  });
}

export function parseMaintenanceFile(uri: string): Promise<ParseResult<ParsedMaintenance>> {
  return parseFile(uri, 'maintenance', (row, rowNum, headerMap) => {
    const equipment = (headerMap['Equipment'] ?? '').trim();
    const serviceDoneBy = (headerMap['Service Done By'] ?? '').trim();
    if (!equipment) throw new Error('Equipment is required.');
    if (!serviceDoneBy) throw new Error('Service Done By is required.');
    return {
      equipment,
      location: (headerMap['Location'] ?? '').trim() || undefined,
      serialNumber: (headerMap['Serial Number'] ?? '').trim() || undefined,
      hoursOfService: (headerMap['Hours of Service'] ?? '').trim() || undefined,
      hoursAtNextService: (headerMap['Hours at Next Service'] ?? '').trim() || undefined,
      whatServiceDone: (headerMap['What Service Done'] ?? '').trim() || undefined,
      notes: (headerMap['Notes'] ?? '').trim() || undefined,
      serviceDoneBy,
    };
  });
}

export function parseYardFile(uri: string): Promise<ParseResult<ParsedYardJob>> {
  return parseFile(uri, 'yard', (row, rowNum, headerMap) => {
    const jobTitle = (headerMap['Job Title'] ?? '').trim();
    if (!jobTitle) throw new Error('Job Title is required.');
    const deptRaw = (headerMap['Department (BRIDGE/ENGINEERING/EXTERIOR/INTERIOR/GALLEY)'] ?? headerMap['Department'] ?? '').trim().toUpperCase();
    const priorityRaw = (headerMap['Priority (GREEN/YELLOW/RED)'] ?? headerMap['Priority'] ?? '').trim().toUpperCase();
    const department = deptRaw && VALID_DEPARTMENTS.includes(deptRaw as (typeof VALID_DEPARTMENTS)[number]) ? deptRaw : undefined;
    const priority = ['GREEN', 'YELLOW', 'RED'].includes(priorityRaw) ? priorityRaw : undefined;
    return {
      jobTitle,
      jobDescription: (headerMap['Job Description'] ?? '').trim() || undefined,
      department,
      priority,
      yardLocation: (headerMap['Yard Location'] ?? '').trim() || undefined,
      contractorCompanyName: (headerMap['Contractor Company Name'] ?? '').trim() || undefined,
      contactDetails: (headerMap['Contact Details'] ?? '').trim() || undefined,
      doneByDate: normalizeDateForImport(headerMap['Done By Date (YYYY-MM-DD)'] ?? headerMap['Done By Date'] ?? ''),
    };
  });
}

export interface ParsedInventoryItem {
  department: string;
  title: string;
  location?: string;
  description?: string;
  items: { amount: string; item: string }[];
}

export function parseInventoryFile(uri: string): Promise<ParseResult<ParsedInventoryItem>> {
  return parseFile(uri, 'inventory', (_row, _rowNum, headerMap, sheetName) => {
    const title = (headerMap['Title'] ?? '').trim();
    if (!title) return null;
    // Department is derived from the tab name (e.g. "Interior" → "INTERIOR")
    const deptRaw = sheetName.trim().toUpperCase();
    const department = VALID_DEPARTMENTS.includes(deptRaw as (typeof VALID_DEPARTMENTS)[number])
      ? deptRaw
      : 'INTERIOR';
    const itemPairs: { amount: string; item: string }[] = [];
    for (let n = 1; n <= 10; n++) {
      const amount = (headerMap[`Amount ${n}`] ?? '').trim();
      const item = (headerMap[`Item ${n}`] ?? '').trim();
      if (amount || item) itemPairs.push({ amount, item });
    }
    return {
      department,
      title,
      location: (headerMap['Location'] ?? '').trim() || undefined,
      description: (headerMap['Description'] ?? '').trim() || undefined,
      items: itemPairs,
    };
  });
}

/** Which sheet names to read for each template type (skips "Info Dump"). */
function getDataSheetNames(type: TemplateType): string[] {
  switch (type) {
    case 'tasks':
      return ['Daily', 'Weekly', 'Monthly'];
    case 'maintenance':
      return ['Maintenance Log'];
    case 'yard':
      return ['Yard Period Jobs'];
    case 'inventory':
      return ['Bridge', 'Engineering', 'Exterior', 'Interior', 'Galley'];
  }
}

async function parseFile<T>(
  uri: string,
  type: TemplateType,
  mapRow: (row: string[], rowNum: number, headerMap: Record<string, string>, sheetName: string) => T | null
): Promise<ParseResult<T>> {
  const success: T[] = [];
  const errors: { row: number; message: string }[] = [];

  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
    });
    const workbook = XLSX.read(base64, { type: 'base64' });
    const allSheetNames = workbook.SheetNames;
    const wantedNames = getDataSheetNames(type);

    const sheetsToRead: string[] = [];
    for (const name of wantedNames) {
      if (allSheetNames.includes(name)) sheetsToRead.push(name);
    }
    if (sheetsToRead.length === 0) {
      const fallback = allSheetNames.find((n) => n !== 'Info Dump') ?? allSheetNames[0];
      if (fallback) sheetsToRead.push(fallback);
    }
    if (sheetsToRead.length === 0) {
      return { success: [], errors: [{ row: 0, message: 'No data sheets found.' }] };
    }

    let globalRow = 0;
    for (const sheetName of sheetsToRead) {
      const sheet = workbook.Sheets[sheetName];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (rows.length < 2) continue;

      const headerRow = rows[0] as string[];
      const dataRows = rows.slice(1);

      for (let i = 0; i < dataRows.length; i++) {
        globalRow++;
        const row = dataRows[i] as (string | number)[];
        const strRow = row.map((c) => String(c ?? '').trim());
        const headerMap: Record<string, string> = {};
        headerRow.forEach((h, idx) => {
          const key = String(h ?? '').trim();
          if (key) headerMap[key] = strRow[idx] ?? '';
        });

        const isBlank = strRow.every((c) => !c);
        if (isBlank) continue;

        try {
          const parsed = mapRow(strRow, globalRow + 1, headerMap, sheetName);
          if (parsed) success.push(parsed);
        } catch (e) {
          errors.push({ row: globalRow + 1, message: (e as Error).message });
        }
      }
    }

    if (success.length === 0 && errors.length === 0) {
      return { success: [], errors: [{ row: 0, message: 'File is empty or has no data rows.' }] };
    }
    return { success, errors };
  } catch (e) {
    return {
      success: [],
      errors: [{ row: 0, message: `Could not read file: ${(e as Error).message}` }],
    };
  }
}
