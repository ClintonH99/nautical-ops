/**
 * PDF export for Pre-Departure Checklists
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PreDepartureChecklist, Department } from '../types';

const DEPARTMENT_LABELS: Record<Department | string, string> = {
  BRIDGE: 'Bridge',
  ENGINEERING: 'Engineering',
  EXTERIOR: 'Exterior',
  INTERIOR: 'Interior',
  GALLEY: 'Galley',
};

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function deptLabel(d: Department | null): string {
  return d ? (DEPARTMENT_LABELS[d] ?? d) : 'All Departments';
}

export async function generatePreDepartureChecklistPdf(
  checklists: PreDepartureChecklist[],
  vesselName: string,
  filename: string
): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);

  const sections = checklists
    .map(
      (c) =>
        '<div class="section">' +
        '<h2>' +
        escapeHtml(c.title) +
        '</h2>' +
        '<p class="meta">' +
        escapeHtml(deptLabel(c.department)) +
        ' · ' +
        (c.items?.length ?? 0) +
        ' items</p>' +
        '<ol class="items">' +
        (c.items || [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => '<li>' + escapeHtml(item.label) + '</li>')
          .join('') +
        '</ol>' +
        '</div>'
    )
    .join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4;margin:20mm 16mm}body{font-family:system-ui,sans-serif;font-size:11px;color:#111}' +
    'h1{font-size:18px;font-weight:700;color:#1E3A8A;margin-bottom:8px}.subtitle{font-size:10px;color:#666;margin-bottom:16px}' +
    '.section{margin-bottom:24px;break-inside:avoid}h2{font-size:14px;font-weight:600;color:#1E3A8A;margin-bottom:4px}.meta{font-size:10px;color:#666;margin-bottom:8px}' +
    'ol.items{margin:0;padding-left:20px}ol.items li{margin-bottom:4px;line-height:1.4}' +
    '</style></head><body>' +
    '<h1>' +
    escapeHtml(vesselName || 'Vessel') +
    ' Pre-Departure Checklist</h1>' +
    '<p class="subtitle">Generated ' +
    dateStr +
    '</p>' +
    sections +
    '</body></html>';

  const { uri } = await Print.printToFileAsync({ html });
  const newUri = FileSystem.cacheDirectory + filename;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(newUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Save ' + filename,
    });
  }
}
