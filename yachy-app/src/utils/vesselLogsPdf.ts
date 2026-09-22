/**
 * PDF export utilities for Vessel Logs:
 *   - General Waste Log
 *   - Fuel Log
 *   - Discharge Log
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  GeneralWasteLog,
  FuelLog,
  FuelLogAllocationSnapshot,
  FuelVolumeUnit,
  PumpOutLog,
  DischargeType,
} from '../types';
import { fromLitres, storedFuelVolumeUnit } from './fuelUnits';

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
  await printAndShare(html, `${safeName}_${dateStr()}_General_Waste_Log.pdf`);
}

// ─── Fuel Log ─────────────────────────────────────────────────────────────────

function fuelVolumeUnitLabel(log: FuelLog): string {
  if (log.volumeUnit === 'LITRES') return 'L';
  if (log.volumeUnit === 'US_GALLONS') return 'US gal';
  return 'US gal';
}

function fuelPriceUnitLabel(log: FuelLog): string {
  return log.priceVolumeUnit === 'LITRES' ? 'L' : 'US gal';
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

function fuelDisplayUnitLabel(unit: FuelVolumeUnit): string {
  return unit === 'LITRES' ? 'L' : 'US gal';
}

function pdfVolume(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

function fuelAllocationDetailHtml(
  log: FuelLog,
  allocationSnapshot: FuelLogAllocationSnapshot
): string {
  const allocations = allocationSnapshot.allocationsByLogId[log.id] ?? [];
  // A receipt and its allocations must reconcile in the same historical unit,
  // even if the vessel later changes its preferred display unit.
  const unit = storedFuelVolumeUnit(log.volumeUnit);
  const detail = allocations.length
    ? allocations
        .map(
          (allocation) => `
            <div class="allocation-row">
              <span class="allocation-name">${escapeHtml(allocation.tankName)}</span>
              <span class="allocation-amount">${escapeHtml(pdfVolume(fromLitres(allocation.amountLitres, unit)))} ${escapeHtml(fuelDisplayUnitLabel(unit))}</span>
            </div>`
        )
        .join('')
    : `<div class="unallocated">${
        log.volumeUnit === null ? 'No tank allocation recorded.' : 'No tank allocation recorded.'
      }</div>`;

  return `
    <section class="allocation-panel">
      <div class="section-label">Tank allocation</div>
      ${detail}
    </section>`;
}

export async function exportFuelLogPdf(
  logs: FuelLog[],
  vesselName: string,
  allocationSnapshot?: FuelLogAllocationSnapshot
): Promise<void> {
  const receiptCards = logs.length
    ? logs
        .map(
          (l) => `<article class="receipt-card">
        <header class="receipt-header">
          <h2>${escapeHtml(l.locationOfRefueling) || 'Location not recorded'}</h2>
          <div class="receipt-date">${escapeHtml(l.logDate) || 'Date not recorded'}${l.logTime ? ` <span class="dot">&bull;</span> ${escapeHtml(l.logTime)}` : ''}</div>
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
          <div class="stat stat-total">
            <div class="stat-label">Total</div>
            <div class="stat-value">${escapeHtml(pdfMoney(Number(l.totalPrice), l.currencyCode))}</div>
          </div>
        </section>
        ${
          allocationSnapshot
            ? fuelAllocationDetailHtml(l, allocationSnapshot)
            : `<section class="allocation-panel"><div class="section-label">Tank allocation</div><div class="unallocated">No tank allocation data included.</div></section>`
        }
        ${
          l.comment
            ? `<section class="comment-panel"><div class="section-label">Comment</div><div>${escapeHtml(l.comment)}</div></section>`
            : ''
        }
        <footer class="receipt-footer">Logged by ${escapeHtml(l.createdByName) || 'Unknown crew member'}</footer>
      </article>`
        )
        .join('')
    : `<div class="empty">No fuel receipts</div>`;

  const volumeTotals = new Map<string, number>();
  const costTotals = new Map<string, number>();
  for (const log of logs) {
    const unit = fuelVolumeUnitLabel(log);
    const currency = /^[A-Z]{3}$/.test(log.currencyCode) ? log.currencyCode : 'USD';
    volumeTotals.set(unit, (volumeTotals.get(unit) ?? 0) + Number(log.amountOfFuel));
    costTotals.set(currency, (costTotals.get(currency) ?? 0) + Number(log.totalPrice));
  }
  const volumeSummary = [...volumeTotals.entries()]
    .map(([unit, value]) => `${pdfVolume(value)} ${escapeHtml(unit)}`)
    .join(' + ');
  const costSummary = [...costTotals.entries()]
    .map(([currency, value]) => escapeHtml(pdfMoney(value, currency)))
    .join(' + ');

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
      h1 {
        color: #1e3a8a;
        font-size: 28px;
        line-height: 1.1;
        margin: 0 0 14px;
      }
      .summary-grid {
        display: flex;
        gap: 10px;
        margin-bottom: 14px;
      }
      .summary-card {
        background: #f8fafc;
        border: 1px solid #dbe4f0;
        border-radius: 8px;
        flex: 1;
        min-width: 0;
        padding: 11px 12px;
      }
      .summary-label,
      .section-label,
      .stat-label {
        color: #64748b;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: .5px;
        text-transform: uppercase;
      }
      .summary-value {
        color: #0f172a;
        font-size: 18px;
        font-weight: 800;
        line-height: 1.2;
        margin-top: 4px;
        overflow-wrap: anywhere;
      }
      .receipt-card {
        border: 1px solid #cbd8e8;
        border-left: 7px solid #1e3a8a;
        border-radius: 8px;
        break-inside: avoid;
        margin: 0 0 12px;
        padding: 12px 12px 9px;
        page-break-inside: avoid;
      }
      .receipt-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 9px;
      }
      .receipt-header h2 {
        color: #1e3a8a;
        flex: 1;
        font-size: 17px;
        line-height: 1.2;
        margin: 0;
      }
      .receipt-date {
        color: #526581;
        font-size: 10px;
        padding-top: 2px;
        text-align: right;
        white-space: nowrap;
      }
      .dot { padding: 0 3px; }
      .receipt-stats {
        background: #f8fafc;
        border-radius: 7px;
        display: flex;
        margin-bottom: 8px;
        padding: 9px 0;
      }
      .stat {
        border-right: 1px solid #d7e0ea;
        flex: 1;
        min-width: 0;
        padding: 0 10px;
      }
      .stat:last-child { border-right: 0; }
      .stat-value {
        color: #0f172a;
        font-size: 15px;
        font-weight: 800;
        line-height: 1.25;
        margin-top: 3px;
        overflow-wrap: anywhere;
      }
      .stat-total .stat-value { color: #1e3a8a; }
      .allocation-panel,
      .comment-panel {
        background: #f8fafc;
        border: 1px solid #edf1f6;
        border-radius: 7px;
        margin-bottom: 8px;
        padding: 8px 10px;
      }
      .section-label { margin-bottom: 4px; }
      .allocation-row {
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 3px 0;
      }
      .allocation-row:last-child { border-bottom: 0; }
      .allocation-name { flex: 1; }
      .allocation-amount { font-weight: 600; white-space: nowrap; }
      .unallocated { color: #64748b; font-style: italic; padding: 2px 0; }
      .comment-panel { color: #334155; }
      .receipt-footer {
        border-top: 1px solid #e2e8f0;
        color: #64748b;
        font-size: 9px;
        padding-top: 7px;
      }
      .empty {
        background: #f8fafc;
        border: 1px solid #dbe4f0;
        border-radius: 8px;
        color: #64748b;
        padding: 28px;
        text-align: center;
      }
      .document-footer {
        border-top: 1px solid #dbe4f0;
        color: #64748b;
        display: flex;
        font-size: 8px;
        justify-content: space-between;
        margin-top: 16px;
        padding-top: 7px;
      }
    </style>
    </head><body>
    <h1>Fuel Receipts</h1>
    <section class="summary-grid">
      <div class="summary-card"><div class="summary-label">Receipts</div><div class="summary-value">${logs.length}</div></div>
      <div class="summary-card"><div class="summary-label">Total fuel</div><div class="summary-value">${volumeSummary || '0'}</div></div>
      <div class="summary-card"><div class="summary-label">Total cost</div><div class="summary-value">${costSummary || '-'}</div></div>
    </section>
    ${receiptCards}
    <footer class="document-footer"><span>Nautical Ops &bull; Fuel Receipts</span><span>${escapeHtml(vesselName)} records</span></footer>
  </body></html>`;

  const safeName = vesselName.replace(/[^\w]/g, '_') || 'Vessel';
  await printAndShare(html, `${safeName}_${dateStr()}_Fuel_Log.pdf`);
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
  await printAndShare(html, `${safeName}_${dateStr()}_Discharge_Log.pdf`);
}
