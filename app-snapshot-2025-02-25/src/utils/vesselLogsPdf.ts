/**
 * PDF export utilities for Vessel Logs:
 *   - General Waste Log
 *   - Fuel Log
 *   - Pump Out Log
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { GeneralWasteLog, FuelLog, PumpOutLog, DischargeType } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const DISCHARGE_LABELS: Record<DischargeType, string> = {
  DIRECT_DISCHARGE: 'Direct Discharge',
  TREATMENT_PLANT: 'Treatment Plant Discharge',
  PUMPOUT_SERVICE: 'Pumpout Service',
};

/** Shared A4 page CSS */
function baseStyles(accentColor = '#1E3A8A'): string {
  return `
    @page { size: A4 portrait; margin: 20mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 20px; font-weight: 700; color: ${accentColor}; margin-bottom: 4px; }
    .subtitle { font-size: 11px; color: #666; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    thead tr { background: ${accentColor}; color: #fff; }
    th { padding: 8px 10px; text-align: left; font-weight: 600; font-size: 11px; }
    td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    tr:nth-child(even) td { background: #f9fafb; }
    .empty { padding: 20px; text-align: center; color: #999; }
  `;
}

async function printAndShare(html: string, filename: string): Promise<void> {
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

// ─── General Waste Log ────────────────────────────────────────────────────────

export async function exportGeneralWasteLogPdf(
  logs: GeneralWasteLog[],
  vesselName: string
): Promise<void> {
  const rows = logs.length
    ? logs.map((l) => {
        const weightDisplay = l.weight != null
          ? `${l.weight} ${l.weightUnit ?? 'kgs'}`
          : '—';
        return `
        <tr>
          <td>${escapeHtml(l.logDate)}</td>
          <td>${escapeHtml(l.logTime)}</td>
          <td>${escapeHtml(l.positionLocation) || '—'}</td>
          <td>${escapeHtml(l.descriptionOfGarbage) || '—'}</td>
          <td>${weightDisplay}</td>
          <td>${escapeHtml(l.createdByName) || '—'}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" class="empty">No entries</td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>${baseStyles('#1E3A8A')}</style></head><body>
    <h1>General Waste Log</h1>
    <p class="subtitle">${escapeHtml(vesselName)} &nbsp;·&nbsp; Generated ${dateStr()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Time</th><th>Position / Location</th>
        <th>Description of Garbage</th><th>Weight</th><th>Logged By</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;

  const safeName = vesselName.replace(/[^\w]/g, '_') || 'Vessel';
  await printAndShare(html, `${safeName}_${dateStr()}_General_Waste_Log.pdf`);
}

// ─── Fuel Log ─────────────────────────────────────────────────────────────────

export async function exportFuelLogPdf(
  logs: FuelLog[],
  vesselName: string
): Promise<void> {
  const rows = logs.length
    ? logs.map((l) => `
        <tr>
          <td>${escapeHtml(l.logDate)}</td>
          <td>${escapeHtml(l.logTime)}</td>
          <td>${escapeHtml(l.locationOfRefueling) || '—'}</td>
          <td style="text-align:right">${escapeHtml(l.amountOfFuel)} gal</td>
          <td style="text-align:right">$${Number(l.pricePerGallon).toFixed(4)}</td>
          <td style="text-align:right;font-weight:700">$${Number(l.totalPrice).toFixed(2)}</td>
          <td>${escapeHtml(l.createdByName) || '—'}</td>
        </tr>`).join('')
    : `<tr><td colspan="7" class="empty">No entries</td></tr>`;

  const totalFuel = logs.reduce((s, l) => s + Number(l.amountOfFuel), 0);
  const totalCost = logs.reduce((s, l) => s + Number(l.totalPrice), 0);
  const totalsRow = logs.length ? `
    <tfoot>
      <tr style="background:#f3f4f6;font-weight:700">
        <td colspan="3">Total (${logs.length} entr${logs.length === 1 ? 'y' : 'ies'})</td>
        <td style="text-align:right">${totalFuel.toFixed(2)} gal</td>
        <td></td>
        <td style="text-align:right">$${totalCost.toFixed(2)}</td>
        <td></td>
      </tr>
    </tfoot>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>${baseStyles('#1E3A8A')} tfoot td { padding: 8px 10px; border-top: 2px solid #1E3A8A; }</style>
    </head><body>
    <h1>Fuel Log</h1>
    <p class="subtitle">${escapeHtml(vesselName)} &nbsp;·&nbsp; Generated ${dateStr()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Time</th><th>Location</th>
        <th>Amount</th><th>Per Gallon</th><th>Total</th><th>Logged By</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      ${totalsRow}
    </table>
  </body></html>`;

  const safeName = vesselName.replace(/[^\w]/g, '_') || 'Vessel';
  await printAndShare(html, `${safeName}_${dateStr()}_Fuel_Log.pdf`);
}

// ─── Pump Out Log ─────────────────────────────────────────────────────────────

export async function exportPumpOutLogPdf(
  logs: PumpOutLog[],
  vesselName: string
): Promise<void> {
  const rows = logs.length
    ? logs.map((l) => `
        <tr>
          <td>${escapeHtml(l.logDate)}</td>
          <td>${escapeHtml(l.logTime)}</td>
          <td>${escapeHtml(DISCHARGE_LABELS[l.dischargeType])}</td>
          <td>${l.dischargeType === 'PUMPOUT_SERVICE' && l.pumpoutServiceName
            ? escapeHtml(l.pumpoutServiceName) : '—'}</td>
          <td>${escapeHtml(l.location) || '—'}</td>
          <td style="text-align:right">${escapeHtml(l.amountInGallons)} gal</td>
          <td>${escapeHtml(l.description) || '—'}</td>
          <td>${escapeHtml(l.createdByName) || '—'}</td>
        </tr>`).join('')
    : `<tr><td colspan="8" class="empty">No entries</td></tr>`;

  const totalGallons = logs.reduce((s, l) => s + Number(l.amountInGallons), 0);
  const totalsRow = logs.length ? `
    <tfoot>
      <tr style="background:#f3f4f6;font-weight:700">
        <td colspan="5">Total (${logs.length} entr${logs.length === 1 ? 'y' : 'ies'})</td>
        <td style="text-align:right">${totalGallons.toFixed(2)} gal</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>${baseStyles('#1E3A8A')} tfoot td { padding: 8px 10px; border-top: 2px solid #1E3A8A; }</style>
    </head><body>
    <h1>Pump Out Log</h1>
    <p class="subtitle">${escapeHtml(vesselName)} &nbsp;·&nbsp; Generated ${dateStr()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Time</th><th>Discharge Type</th><th>Service</th>
        <th>Location</th><th>Amount</th><th>Description</th><th>Logged By</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      ${totalsRow}
    </table>
  </body></html>`;

  const safeName = vesselName.replace(/[^\w]/g, '_') || 'Vessel';
  await printAndShare(html, `${safeName}_${dateStr()}_Pump_Out_Log.pdf`);
}
