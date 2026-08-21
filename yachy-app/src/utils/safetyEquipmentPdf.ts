/**
 * PDF export for Safety Equipment
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { SafetyEquipmentData, SafetyItem, normalizeSafetyItem } from '../services/safetyEquipment';

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
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getLabel(key: string, data: SafetyEquipmentData): string {
  if (LABELS[key]) return LABELS[key];
  return data.customLabels?.[key] ?? key.replace(/^custom_/, '').replace(/_/g, ' ');
}

function dateCell(value: string | null, isNA: boolean): string {
  const text = isNA ? 'N/A' : value || 'Not set';
  const cls = isNA || !value ? ' class="muted"' : '';
  return `<td${cls}>${escapeHtml(text)}</td>`;
}

function buildRows(data: SafetyEquipmentData): string[] {
  const rows: string[] = [];
  const categoryKeys = Object.keys(data).filter(
    (k) => k !== 'vesselName' && k !== 'customLabels' && Array.isArray(data[k])
  );
  for (const key of categoryKeys) {
    const rawArr = data[key] as (string | SafetyItem)[];
    if (!Array.isArray(rawArr) || !rawArr.length) continue;
    const label = getLabel(key, data);
    const items = rawArr.map(normalizeSafetyItem).filter((it) => it.location);
    items.forEach((item) => {
      rows.push(
        `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(item.location)}</td>` +
        dateCell(item.lastChecked, item.lastCheckedNA) +
        dateCell(item.expiryDate, item.expiryDateNA) +
        `</tr>`
      );
    });
  }
  return rows;
}

const TABLE_HEAD =
  '<thead><tr><th>Equipment</th><th>Location</th><th>Last checked</th><th>Expiry / replace by</th></tr></thead>';

const PDF_STYLES = `
        @page { size: A4 portrait; margin: 20mm 16mm; }
        body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
        h1 { font-size: 20px; font-weight: 700; color: #1E3A8A; margin-bottom: 4px; }
        h2 { font-size: 15px; font-weight: 700; color: #111; margin: 22px 0 6px; page-break-after: avoid; }
        .subtitle { font-size: 11px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
        thead tr { background: #1E3A8A; color: #fff; }
        tr:nth-child(even) td { background: #f9fafb; }
        .muted { color: #888; font-style: italic; }
`;

async function shareHtmlAsPdf(html: string, filename: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  const newUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(newUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Save ${filename}`,
    });
  }
}

/** One published plan per document. */
export async function generateSafetyEquipmentPdf(
  data: SafetyEquipmentData,
  title: string,
  filename: string
): Promise<void> {
  const rows = buildRows(data);
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${PDF_STYLES}</style>
    </head>
    <body>
      <h1>${escapeHtml(title || 'Safety Equipment')}</h1>
      <p class="subtitle">${escapeHtml(String(data.vesselName || ''))} · Generated ${new Date().toISOString().slice(0, 10)}</p>
      <table>
        ${TABLE_HEAD}
        <tbody>${rows.join('') || '<tr><td colspan="4">No equipment listed</td></tr>'}</tbody>
      </table>
    </body>
    </html>
  `;
  await shareHtmlAsPdf(html, filename);
}

/**
 * Several published plans in one document, each under its own heading.
 * Used by the Export control in the Safety Equipment page header.
 */
export async function generateSafetyEquipmentListPdf(
  plans: { title: string; data: SafetyEquipmentData }[],
  vesselName: string
): Promise<void> {
  if (plans.length === 0) throw new Error('Select at least one plan to export.');

  const sections = plans
    .map((plan) => {
      const rows = buildRows(plan.data);
      return `
      <h2>${escapeHtml(plan.title || 'Untitled plan')}</h2>
      <table>
        ${TABLE_HEAD}
        <tbody>${rows.join('') || '<tr><td colspan="4">No equipment listed</td></tr>'}</tbody>
      </table>`;
    })
    .join('');

  const today = new Date().toISOString().slice(0, 10);
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${PDF_STYLES}</style>
    </head>
    <body>
      <h1>Safety Equipment</h1>
      <p class="subtitle">${escapeHtml(vesselName || '')} &middot; Generated ${today} &middot; ${plans.length} plan${plans.length === 1 ? '' : 's'}</p>
      ${sections}
    </body>
    </html>
  `;
  await shareHtmlAsPdf(html, `Safety_Equipment_${today}.pdf`);
}
