/**
 * PDF export utilities for Vessel Logs:
 *   - General Waste Log
 *   - Fuel Log
 *   - Discharge Log
 */

import { sharePdfFile } from './sharePdfFile';
import { printStandardPdf } from './standardPdf';
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
  PUMPOUT_SERVICE: 'Pump-out Service',
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

async function printAndShare(html: string, filename: string, title: string): Promise<void> {
  const { uri } = await printStandardPdf({ html, title });
  await sharePdfFile(uri, filename);
}

// ─── General Waste Log ────────────────────────────────────────────────────────

export async function exportGeneralWasteLogPdf(
  logs: GeneralWasteLog[],
  vesselName: string
): Promise<void> {
  const rows = logs.length
    ? logs
        .map((l) => {
          const weightDisplay = l.weight != null ? `${l.weight} ${l.weightUnit ?? 'kgs'}` : '—';
          return `
        <tr>
          <td>${escapeHtml(l.logDate)}</td>
          <td>${escapeHtml(l.logTime)}</td>
          <td>${escapeHtml(l.positionLocation) || '—'}</td>
          <td>${escapeHtml(l.descriptionOfGarbage) || '—'}</td>
          <td>${weightDisplay}</td>
          <td>${escapeHtml(l.createdByName) || '—'}</td>
        </tr>`;
        })
        .join('')
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
  await printAndShare(html, `${safeName}_${dateStr()}_General_Waste_Log.pdf`, 'General Waste Log');
}

// ─── Fuel Log ─────────────────────────────────────────────────────────────────

function fuelVolumeUnitLabel(log: FuelLog): string {
  if (log.volumeUnit === 'LITRES') return 'L';
  if (log.volumeUnit === 'US_GALLONS') return 'US gal';
  return 'US gal';
}

function fuelPriceUnitLabel(log: FuelLog): string {
  return log.priceVolumeUnit === 'LITRES' ? 'Litre' : 'US gal';
}

function pdfMoney(value: number, currencyCode: string): string {
  const code = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

function pdfVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

function fuelReceiptDate(value: string): string {
  // These are ship-local calendar fields, not UTC instants. Never shift the date.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = match && months[Number(match[2]) - 1];
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

export async function exportFuelLogPdf(logs: FuelLog[], vesselName: string): Promise<void> {
  const receiptCards = logs.length
    ? logs
        .map(
          (l) => `<article class="fuel-receipt">
        <header class="receipt-header">
          <div class="receipt-field"><div class="field-label">Location</div><div class="field-value">${escapeHtml(l.locationOfRefueling) || '—'}</div></div>
          <div class="receipt-field"><div class="field-label">Date</div><div class="field-value">${escapeHtml(fuelReceiptDate(l.logDate)) || '—'}</div></div>
          <div class="receipt-field"><div class="field-label">Time</div><div class="field-value">${escapeHtml(l.logTime) || '—'}</div></div>
        </header>
        <section class="receipt-stats">
          <div class="stat">
            <div class="stat-label">Fuel received</div>
            <div class="stat-value">${escapeHtml(pdfVolume(Number(l.amountOfFuel)))} ${escapeHtml(fuelVolumeUnitLabel(l))}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Price / ${escapeHtml(fuelPriceUnitLabel(l))}</div>
            <div class="stat-value">${escapeHtml(pdfMoney(Number(l.pricePerVolumeUnit), l.currencyCode))}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total purchase</div>
            <div class="stat-value">${escapeHtml(pdfMoney(Number(l.totalPrice), l.currencyCode))}</div>
          </div>
        </section>
        <section class="comment-panel"><div class="field-label">Comment</div><div class="comment-text">${escapeHtml(l.comment) || '—'}</div></section>
      </article>`
        )
        .join('')
    : `<div class="empty">No fuel receipts</div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      @page { size: A4 portrait; margin: 14mm 14mm 18mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        color: #0f172a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 11px;
        line-height: 1.4;
      }
      .field-label,
      .stat-label {
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 6px;
      }
      .fuel-receipt {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        break-inside: avoid;
        margin: 0 0 18px;
        page-break-inside: avoid;
      }
      .receipt-header,
      .receipt-stats {
        display: grid;
        grid-template-columns: 1.12fr 1fr .82fr;
        gap: 18px;
        padding: 18px 20px;
      }
      .receipt-stats { background: #f1f3f5; }
      .receipt-field, .stat { min-width: 0; }
      .field-value,
      .stat-value {
        color: #0f172a;
        font-size: 17px;
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      .comment-panel { padding: 18px 20px; }
      .comment-text { font-size: 15px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .empty {
        background: #f8fafc;
        border: 1px solid #dbe4f0;
        border-radius: 8px;
        color: #64748b;
        padding: 28px;
        text-align: center;
      }
    </style>
    </head><body>
    <h1>Fuel Receipts</h1>
    ${receiptCards}
  </body></html>`;

  const safeName = vesselName.replace(/[^\w]/g, '_') || 'Vessel';
  await printAndShare(html, `${safeName}_${dateStr()}_Fuel_Log.pdf`, 'Fuel Receipts');
}

// ─── Discharge Log ────────────────────────────────────────────────────────────

export async function exportPumpOutLogPdf(logs: PumpOutLog[], vesselName: string): Promise<void> {
  const rows = logs.length
    ? logs
        .map(
          (l) => `
        <tr>
          <td>${escapeHtml(l.logDate)}</td>
          <td>${escapeHtml(l.logTime)}</td>
          <td>${escapeHtml(DISCHARGE_LABELS[l.dischargeType])}</td>
          <td>${
            l.dischargeType === 'PUMPOUT_SERVICE' && l.pumpoutServiceName
              ? escapeHtml(l.pumpoutServiceName)
              : '—'
          }</td>
          <td>${escapeHtml(l.location) || '—'}</td>
          <td style="text-align:right">${escapeHtml(l.amountInGallons)} gal</td>
          <td>${escapeHtml(l.description) || '—'}</td>
          <td>${escapeHtml(l.createdByName) || '—'}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="8" class="empty">No entries</td></tr>`;

  const totalGallons = logs.reduce((s, l) => s + Number(l.amountInGallons), 0);
  const totalsRow = logs.length
    ? `
    <tfoot>
      <tr style="background:#f3f4f6;font-weight:700">
        <td colspan="5">Total (${logs.length} entr${logs.length === 1 ? 'y' : 'ies'})</td>
        <td style="text-align:right">${totalGallons.toFixed(2)} gal</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>${baseStyles('#1E3A8A')} tfoot td { padding: 8px 10px; border-top: 2px solid #1E3A8A; }</style>
    </head><body>
    <h1>Discharge Log</h1>
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
  await printAndShare(html, `${safeName}_${dateStr()}_Discharge_Log.pdf`, 'Discharge Log');
}
