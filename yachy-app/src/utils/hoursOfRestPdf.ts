/**
 * PDF export for Hours of Rest, matching the standard MLC/STCW
 * "Hours of Work and Rest" form layout.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PdfMonthData } from '../services/restEntries';

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateDisplay(dateStr: string): string {
  return dateStr.replace(/-/g, '/');
}

export async function generateHoursOfRestPdf(data: PdfMonthData, filename: string): Promise<void> {
  const hourHeaderCells = Array.from({ length: 24 }, (_, h) =>
    `<th>${String(h).padStart(2, '0')}</th>`
  ).join('');

  const dayRows = data.days
    .map((day) => {
      const hourCells = day.hourMarks
        .map((marked) => `<td class="hourcell">${marked ? 'X' : ''}</td>`)
        .join('');
      return (
        '<tr><td class="datecell">' +
        formatDateDisplay(day.date) +
        '</td>' +
        hourCells +
        '<td class="numcell">' +
        day.restHoursToday +
        '</td><td class="comment"></td><td class="numcell office">' +
        day.restIn24h +
        '</td><td class="numcell office">' +
        day.restIn7d +
        '</td></tr>'
      );
    })
    .join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4 landscape;margin:12mm}body{font-family:system-ui,sans-serif;font-size:9px;color:#111}' +
    'h1{font-size:16px;font-weight:700;text-align:center;margin-bottom:12px}' +
    '.info{width:100%;font-size:10px;margin-bottom:10px;border-collapse:collapse}' +
    '.info td{padding:3px 6px}' +
    '.infolabel{color:#666;width:70px}' +
    'table.grid{width:100%;border-collapse:collapse;font-size:8px}' +
    'table.grid th,table.grid td{border:1px solid #ccc;padding:2px;text-align:center}' +
    'table.grid thead th{background:#1E3A8A;color:#fff;font-weight:600}' +
    '.datecell{text-align:left;font-weight:600;white-space:nowrap}' +
    '.hourcell{width:16px}' +
    '.numcell{font-weight:600}' +
    '.office{background:#f3f4f6}' +
    '.comment{min-width:60px}' +
    '.footer{margin-top:14px;font-size:7px;color:#666;line-height:1.4}' +
    '.sigrow{display:flex;justify-content:space-between;margin-top:24px;font-size:9px}' +
    '.sigline{border-top:1px solid #333;width:260px;padding-top:4px;text-align:center}' +
    '</style></head><body>' +
    '<h1>Hours of Work and Rest</h1>' +
    '<table class="info"><tr>' +
    '<td class="infolabel">Seafarer</td><td>' + escapeHtml(data.seafarerName) + '</td>' +
    '<td class="infolabel">IMO</td><td>' + escapeHtml(data.vesselImoNumber || '-') + '</td>' +
    '</tr><tr>' +
    '<td class="infolabel">Rank</td><td>' + escapeHtml(data.rank) + '</td>' +
    '<td class="infolabel">Vessel</td><td>' + escapeHtml(data.vesselName) + '</td>' +
    '</tr><tr>' +
    '<td class="infolabel">Month</td><td>' + escapeHtml(data.monthLabel) + '</td>' +
    '<td class="infolabel">Watchkeeper</td><td>' + (data.isWatchKeeper ? 'Yes' : 'No') + '</td>' +
    '</tr></table>' +
    '<table class="grid"><thead><tr>' +
    '<th>Date</th>' + hourHeaderCells +
    '<th>Rest (24h)</th><th>Comments</th>' +
    '<th class="office">Any 24h*</th><th class="office">Any 7-day*</th>' +
    '</tr></thead><tbody>' +
    dayRows +
    '</tbody></table>' +
    '<div class="footer">*Not to be completed by the seafarer &mdash; office use only, calculated per the Seafarers&rsquo; Hours of Work and the Manning of Ships Convention, 1996 (No. 180) and the STCW Convention as amended.</div>' +
    '<div class="sigrow">' +
    '<div class="sigline">Signature of Master or Authorized Person</div>' +
    '<div class="sigline">Signature of Seafarer</div>' +
    '</div>' +
    '</body></html>';

  const { uri } = await Print.printToFileAsync({ html });
  const newUri = FileSystem.cacheDirectory + filename;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(newUri, { mimeType: 'application/pdf', dialogTitle: 'Save ' + filename });
  }
}
