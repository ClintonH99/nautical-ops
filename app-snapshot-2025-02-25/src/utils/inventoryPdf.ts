/**
 * Build HTML for selected inventory items and export to PDF via expo-print + share.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Share from 'expo-sharing';
import { InventoryItem } from '../services/inventory';

const deptLabel = (d: string) => (d ?? '').charAt(0) + (d ?? '').slice(1).toLowerCase();

function sanitizeFilename(s: string): string {
  return s.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').trim() || 'Inventory';
}

function getInventoryPdfFilename(items: InventoryItem[]): string {
  const departments = [...new Set(items.map((i) => i.department ?? 'INTERIOR'))];
  const departmentName = departments.length === 1 ? deptLabel(departments[0]) : 'Mixed';
  const dateStr = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilename(departmentName)}_${dateStr}_Inventory_List.pdf`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInventoryHtml(items: InventoryItem[], title: string = 'Inventory'): string {
  const today = new Date().toISOString().slice(0, 10);
  const accent = '#1E3A8A';

  const cards = items.map((item) => {
    const dept = deptLabel(item.department ?? 'INTERIOR');
    const itemRows = (item.items?.length
      ? item.items
          .filter((r) => r.amount?.trim() || r.item?.trim())
          .map((r) => `<tr><td>${escapeHtml(r.amount)}</td><td>${escapeHtml(r.item)}</td></tr>`)
          .join('')
      : '') || '<tr><td colspan="2" style="color:#999;font-style:italic">—</td></tr>';

    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(item.title)}</span>
          <span class="dept-badge">${escapeHtml(dept)}</span>
        </div>
        ${item.location ? `<p class="card-meta"><strong>Location:</strong> ${escapeHtml(item.location)}</p>` : ''}
        ${item.description ? `<p class="card-desc">${escapeHtml(item.description)}</p>` : ''}
        <table class="items-table">
          <thead><tr><th>Amount</th><th>Item</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>`;
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 20px; font-weight: 700; color: ${accent}; margin-bottom: 4px; }
    .subtitle { font-size: 11px; color: #666; margin-bottom: 24px; }

    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .card-title { font-size: 13px; font-weight: 700; color: #111; }
    .dept-badge {
      font-size: 10px;
      font-weight: 700;
      color: ${accent};
      background: #EFF6FF;
      padding: 2px 8px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card-meta { font-size: 11px; color: #555; margin-bottom: 4px; }
    .card-desc { font-size: 11px; color: #444; margin-bottom: 8px; font-style: italic; }

    .items-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    .items-table thead tr { background: ${accent}; color: #fff; }
    .items-table th { padding: 6px 10px; text-align: left; font-weight: 600; }
    .items-table td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }
    .items-table tr:nth-child(even) td { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">Generated ${today} &nbsp;·&nbsp; ${items.length} item${items.length === 1 ? '' : 's'}</p>
  ${cards.join('')}
</body>
</html>`.trim();
}

export async function exportInventoryToPdf(items: InventoryItem[]): Promise<void> {
  if (items.length === 0) throw new Error('Select at least one item to export.');
  const html = buildInventoryHtml(items, 'Inventory');
  const { uri } = await Print.printToFileAsync({ html });
  const filename = getInventoryPdfFilename(items);
  const newUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  const canShare = await Share.isAvailableAsync();
  if (canShare) await Share.shareAsync(newUri, { mimeType: 'application/pdf', dialogTitle: 'Save Inventory PDF' });
}
