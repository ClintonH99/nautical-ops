/**
 * Build HTML for selected shipyard jobs and export to PDF via expo-print + share.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Share from 'expo-sharing';
import { YardPeriodJob } from '../types';

const deptLabel = (d: string) => (d ?? '').charAt(0) + (d ?? '').slice(1).toLowerCase();

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

function sanitizeFilename(s: string): string {
  return s.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').trim() || 'Shipyard';
}

function getYardJobsPdfFilename(jobs: YardPeriodJob[]): string {
  const yards = [...new Set(jobs.map((j) => (j.yardLocation ?? '').trim()).filter(Boolean))];
  const yardName = yards.length === 1 ? yards[0] : 'Shipyard';
  const dateStr = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilename(yardName)}_${dateStr}_Shipyard_List.pdf`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label: string, value?: string | null): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(v)}</td></tr>`;
}

export function buildYardJobsHtml(jobs: YardPeriodJob[], title: string = 'Shipyard List'): string {
  const today = new Date().toISOString().slice(0, 10);
  const accent = '#1E3A8A';

  const cards = jobs.map((job) => {
    const dept = deptLabel(job.department ?? '');
    const status = STATUS_LABEL[job.status] ?? job.status;

    const details = [
      row('Description', job.jobDescription),
      row('Defect details', job.defectDetails),
      row('Defect location', job.defectLocation),
      row('Equipment serial', job.equipmentSerial),
      row('Yard location', job.yardLocation),
      row('Contractor', job.contractorCompanyName),
      row('Contact', job.contactDetails),
      row('Done by', job.doneByDate ? job.doneByDate.slice(0, 10) : ''),
      row('Status', status),
      row('Completed by', job.completedByName),
    ].join('');

    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(job.jobTitle)}</span>
          <span class="badges">
            ${dept ? `<span class="dept-badge">${escapeHtml(dept)}</span>` : ''}
          </span>
        </div>
        <table class="detail-table">
          <tbody>${details || '<tr><th>Details</th><td style="color:#999;font-style:italic">—</td></tr>'}</tbody>
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
      margin-bottom: 8px;
    }
    .card-title { font-size: 13px; font-weight: 700; color: #111; }
    .badges { white-space: nowrap; }
    .dept-badge {
      font-size: 10px;
      font-weight: 700;
      color: ${accent};
      background: #EFF6FF;
      padding: 2px 8px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-left: 4px;
    }

    .detail-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .detail-table th {
      text-align: left;
      font-weight: 600;
      color: #555;
      width: 34%;
      padding: 5px 10px 5px 0;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }
    .detail-table td {
      padding: 5px 0;
      color: #111;
      border-bottom: 1px solid #e5e7eb;
    }
    .detail-table tr:last-child th, .detail-table tr:last-child td { border-bottom: none; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">Generated ${today} &nbsp;·&nbsp; ${jobs.length} job${jobs.length === 1 ? '' : 's'}</p>
  ${cards.join('')}
</body>
</html>`.trim();
}

export async function exportYardJobsToPdf(jobs: YardPeriodJob[]): Promise<void> {
  if (jobs.length === 0) throw new Error('Select at least one job to export.');
  const html = buildYardJobsHtml(jobs, 'Shipyard List');
  const { uri } = await Print.printToFileAsync({ html });
  const filename = getYardJobsPdfFilename(jobs);
  const newUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  const canShare = await Share.isAvailableAsync();
  if (canShare) {
    await Share.shareAsync(newUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Save Shipyard List PDF',
    });
  }
}
