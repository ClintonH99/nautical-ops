/**
 * Pure HTML builder for Watch Schedule PDF exports.
 *
 * Rows flow naturally; the shared exporter stamps the actual rendered pages.
 */

import type { PublishedWatchTimetable, TimetableSlot } from '../services/watchKeeping';
import { formatLocalDateString } from './index';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getWatchScheduleDate(schedule: {
  forDate: string | null;
  createdAt: string;
}): string {
  return schedule.forDate || schedule.createdAt.slice(0, 10);
}

function slotTimeLabel(slot: TimetableSlot): string {
  if (!slot.startDate) return `${slot.startTimeStr} – ${slot.endTimeStr}`;

  const startDate = formatLocalDateString(slot.startDate, {
    month: 'short',
    day: 'numeric',
  });
  if (slot.endDate && slot.endDate !== slot.startDate) {
    const endDate = formatLocalDateString(slot.endDate, {
      month: 'short',
      day: 'numeric',
    });
    return `${startDate} ${slot.startTimeStr} – ${endDate} ${slot.endTimeStr}`;
  }
  return `${startDate} · ${slot.startTimeStr} – ${slot.endTimeStr}`;
}

export function buildWatchSchedulePdfHtml(schedules: PublishedWatchTimetable[]): string {
  const pageBlocks = schedules
    .map((schedule) => {
      const { slots } = schedule;
      const dateLabel = formatLocalDateString(getWatchScheduleDate(schedule), {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const rows = slots.length
        ? slots
            .map(
              (slot) => `<tr>
                <td>${escapeHtml(slot.crewPosition || '—')}</td>
                <td>${escapeHtml(slot.crewName)}</td>
                <td>${escapeHtml(slotTimeLabel(slot))}</td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="3" class="empty-row">No watch assignments</td></tr>';

      return `<section class="page">
        <header class="schedule-header">
          <h1>Watch Schedule</h1>
          <p class="subtitle">${escapeHtml(dateLabel)}</p>
          <p class="meta"><strong>Schedule:</strong> ${escapeHtml(schedule.watchTitle)}</p>
          ${
            schedule.startLocation
              ? `<p class="meta"><strong>From:</strong> ${escapeHtml(schedule.startLocation)}</p>`
              : ''
          }
          ${
            schedule.destination
              ? `<p class="meta"><strong>To:</strong> ${escapeHtml(schedule.destination)}</p>`
              : ''
          }
          <p class="meta"><strong>Start:</strong> ${escapeHtml(schedule.startTime)}</p>
        </header>
        <table>
          <thead>
            <tr>
              <th class="col-position">Position</th>
              <th class="col-crew">Crew</th>
              <th class="col-time">Date and time</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Watch Schedule</title>
  <style>
    @page { size: A4 portrait; margin: 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: system-ui, sans-serif; font-size: 11px; color: #111827; line-height: 1.35; }
    .page { width: 100%; margin-bottom: 18px; }
    .schedule-header { margin-bottom: 12px; }
    h1 { margin: 0 0 3px; font-size: 20px; font-weight: 700; color: #1E3A8A; }
    .subtitle { margin: 0 0 10px; color: #6b7280; }
    .meta { margin: 0 0 3px; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    thead tr { color: #ffffff; background: #1E3A8A; }
    th { padding: 7px 9px; text-align: left; font-weight: 600; }
    tbody tr { break-inside: avoid; page-break-inside: avoid; }
    td { padding: 6px 9px; border-bottom: 1px solid #e5e7eb; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) td { background: #f9fafb; }
    .col-position { width: 25%; }
    .col-crew { width: 30%; }
    .col-time { width: 45%; }
    .empty-row { padding: 18px 9px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>${pageBlocks}</body>
</html>`;
}
