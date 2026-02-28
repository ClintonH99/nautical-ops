/**
 * PDF export for Safety Equipment
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { SafetyEquipmentData } from '../services/safetyEquipment';

const LABELS: Record<string, string> = {
  fireExtinguishers: 'Fire extinguishers',
  firstAidKits: 'First aid kits',
  medicalBags: 'Medical bags',
  fireFightingEquipment: 'Fire fighting equipment',
  lifeRings: 'Life rings',
  lifeRafts: 'Life rafts',
  bilgePumps: 'Bilge pumps',
  fireHoses: 'Fire hoses',
  emergencyOff: 'Emergency OFF switches/buttons',
  fireAlarmPanel: 'Fire alarm panel',
  fireAlarmSwitches: 'Fire alarm switches',
  flares: 'Flares',
  epirbs: 'EPIRBs',
};

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function generateSafetyEquipmentPdf(data: SafetyEquipmentData, title: string, filename: string): Promise<void> {
  const rows: string[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const arr = data[key];
    if (Array.isArray(arr) && arr.length) {
      const locs = arr.filter(Boolean).map((l) => escapeHtml(String(l))).join(', ');
      rows.push(`<tr><td><strong>${escapeHtml(label)}</strong></td><td>${locs}</td></tr>`);
    }
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @page { size: A4 portrait; margin: 20mm 16mm; }
        body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
        h1 { font-size: 20px; font-weight: 700; color: #1E3A8A; margin-bottom: 4px; }
        .subtitle { font-size: 11px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
        thead tr { background: #1E3A8A; color: #fff; }
        tr:nth-child(even) td { background: #f9fafb; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title || 'Safety Equipment')}</h1>
      <p class="subtitle">${escapeHtml(String(data.vesselName || ''))} · Generated ${new Date().toISOString().slice(0, 10)}</p>
      <table>
        <thead><tr><th>Equipment</th><th>Locations</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="2">No equipment listed</td></tr>'}</tbody>
      </table>
    </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const newUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(newUri, { mimeType: 'application/pdf', dialogTitle: `Save ${filename}` });
  }
}
