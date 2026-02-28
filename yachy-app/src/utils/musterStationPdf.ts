/**
 * PDF export for Muster Station & Duties
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { MusterStationData } from '../services/musterStations';

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loc(arr: string[]): string {
  return (arr || []).length ? (arr || []).map((l) => escapeHtml(l)).join('. ') : '-';
}

export async function generateMusterStationPdf(data: MusterStationData, filename: string): Promise<void> {
  const sig = (data.emergencySignals || {}) as Record<string, string>;
  const crew = data.crewMembers || [];

  const crewRows = crew
    .map(
      (c) =>
        '<tr><td style="font-weight:600;font-size:12px">' +
        escapeHtml(c.roleName) +
        '</td><td>' +
        escapeHtml(c.fire) +
        '</td><td>' +
        escapeHtml(c.manOverboard) +
        '</td><td>' +
        escapeHtml(c.grounding) +
        '</td><td>' +
        escapeHtml(c.abandonShip) +
        '</td><td>' +
        escapeHtml(c.medical) +
        '</td></tr>'
    )
    .join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4 landscape;margin:20mm 16mm}body{font-family:system-ui,sans-serif;font-size:11px;color:#111}' +
    'h1{font-size:18px;font-weight:700;color:#1E3A8A;margin-bottom:8px}.subtitle{font-size:10px;color:#666;margin-bottom:12px}' +
    'table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:6px 8px;border:1px solid #e5e7eb;text-align:left}' +
    'thead tr{background:#1E3A8A;color:#fff;font-weight:600}tr:nth-child(even) td{background:#f9fafb}.loc{margin:4px 0}' +
    '</style></head><body>' +
    '<h1>' +
    escapeHtml(data.vesselName || 'Vessel') +
    ' Muster Station & Duties</h1>' +
    '<p class="subtitle">Generated ' +
    new Date().toISOString().slice(0, 10) +
    '</p>' +
    '<div class="loc"><strong>Muster Station:</strong> ' +
    escapeHtml(data.musterStation || '-') +
    '</div>' +
    '<div class="loc"><strong>Medical Chest:</strong> ' +
    loc(data.medicalChest || []) +
    '</div>' +
    '<div class="loc"><strong>Grab Bag:</strong> ' +
    loc(data.grabBag || []) +
    '</div>' +
    '<div class="loc"><strong>Grab Bag Contents:</strong> ' +
    escapeHtml(data.grabBagContents || '-') +
    '</div>' +
    '<div class="loc"><strong>Life Rings:</strong> ' +
    loc(data.lifeRings || []) +
    '</div>' +
    '<table style="margin-top:16px"><thead><tr><th>Role</th><th>Fire</th><th>Man Overboard</th><th>Grounding</th><th>Abandon Ship</th><th>Medical</th></tr></thead><tbody>' +
    '<tr><td style="font-weight:600">Emergency Signal</td><td>' +
    escapeHtml(sig.fire || '-') +
    '</td><td>' +
    escapeHtml(sig.manOverboard || '-') +
    '</td><td>' +
    escapeHtml(sig.grounding || '-') +
    '</td><td>' +
    escapeHtml(sig.abandonShip || '-') +
    '</td><td>' +
    escapeHtml(sig.medical || '-') +
    '</td></tr>' +
    crewRows +
    '</tbody></table></body></html>';

  const { uri } = await Print.printToFileAsync({ html });
  const newUri = FileSystem.cacheDirectory + filename;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(newUri, { mimeType: 'application/pdf', dialogTitle: 'Save ' + filename });
  }
}
