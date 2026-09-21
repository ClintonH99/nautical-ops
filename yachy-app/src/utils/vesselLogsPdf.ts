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
  return 'gal (legacy)';
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
            <div class="allocation-item">
              <strong>${escapeHtml(allocation.tankName)}</strong>
              <span>${escapeHtml(pdfVolume(fromLitres(allocation.amountLitres, unit)))} ${escapeHtml(fuelDisplayUnitLabel(unit))}</span>
            </div>`
        )
        .join('')
    : `<div class="unallocated">${
        log.volumeUnit === null
          ? 'Legacy entry — no tank allocation recorded.'
          : 'No tank allocation recorded.'
      }</div>`;

  return `
    <tr class="allocation-row">
      <td colspan="8">
        <div class="allocation-title">Tank allocation</div>
        ${detail}
      </td>
    </tr>`;
}

export async function exportFuelLogPdf(
  logs: FuelLog[],
  vesselName: string,
  allocationSnapshot?: FuelLogAllocationSnapshot
): Promise<void> {
  const rows = logs.length
    ? logs
        .map(
          (l) => `<tbody class="fuel-entry">
        <tr class="fuel-main-row">
          <td>${escapeHtml(l.logDate)}</td>
          <td>${escapeHtml(l.logTime)}</td>
          <td>${escapeHtml(l.locationOfRefueling) || '—'}</td>
          <td style="text-align:right">${escapeHtml(l.amountOfFuel)} ${escapeHtml(fuelVolumeUnitLabel(l))}</td>
          <td style="text-align:right">${escapeHtml(l.currencyCode)} ${Number(l.pricePerVolumeUnit).toFixed(4)} / ${escapeHtml(fuelPriceUnitLabel(l))}</td>
          <td style="text-align:right;font-weight:700">${escapeHtml(pdfMoney(Number(l.totalPrice), l.currencyCode))}</td>
          <td>${escapeHtml(l.comment) || '—'}</td>
          <td>${escapeHtml(l.createdByName) || '—'}</td>
        </tr>
        ${allocationSnapshot ? fuelAllocationDetailHtml(l, allocationSnapshot) : ''}
        </tbody>`
        )
        .join('')
    : `<tbody><tr><td colspan="8" class="empty">No entries</td></tr></tbody>`;

  const volumeTotals = new Map<string, number>();
  const costTotals = new Map<string, number>();
  for (const log of logs) {
    const unit = fuelVolumeUnitLabel(log);
    const currency = /^[A-Z]{3}$/.test(log.currencyCode) ? log.currencyCode : 'USD';
    volumeTotals.set(unit, (volumeTotals.get(unit) ?? 0) + Number(log.amountOfFuel));
    costTotals.set(currency, (costTotals.get(currency) ?? 0) + Number(log.totalPrice));
  }
  const volumeSummary = [...volumeTotals.entries()]
    .map(([unit, value]) => `${value.toFixed(2)} ${escapeHtml(unit)}`)
    .join(' + ');
  const costSummary = [...costTotals.entries()]
    .map(([currency, value]) => escapeHtml(pdfMoney(value, currency)))
    .join(' + ');
  const totalsRow = logs.length
    ? `
    <tfoot>
      <tr style="background:#f3f4f6;font-weight:700">
        <td colspan="3">Total (${logs.length} entr${logs.length === 1 ? 'y' : 'ies'})</td>
        <td style="text-align:right">${volumeSummary}</td>
        <td></td>
        <td style="text-align:right">${costSummary}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>${baseStyles('#1E3A8A')}
      tfoot { display: table-row-group; }
      tfoot td {
        padding: 8px 10px;
        border-top: 2px solid #1E3A8A;
        white-space: nowrap;
      }
      .fuel-entry { break-inside: avoid; page-break-inside: avoid; }
      .allocation-row td { background: #f8fafc; padding: 7px 10px 9px; }
      .allocation-title {
        color: #64748b;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .45px;
        margin-bottom: 3px;
        text-transform: uppercase;
      }
      .allocation-item {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 2px 0;
      }
      .allocation-item span { white-space: nowrap; }
      .unallocated { color: #64748b; font-style: italic; }
    </style>
    </head><body>
    <h1>Fuel Log</h1>
    <p class="subtitle">${escapeHtml(vesselName)} &nbsp;·&nbsp; Generated ${dateStr()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Time</th><th>Location</th>
        <th>Amount</th><th>Price / Unit</th><th>Total</th><th>Comment</th><th>Logged By</th>
      </tr></thead>
      ${rows}
      ${totalsRow}
    </table>
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
