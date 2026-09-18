/**
 * Pure HTML builder for Watch Schedule PDF exports.
 *
 * Expo Print uses WebKit, whose automatic table pagination can split a row or
 * create a continuation page without the schedule context. We therefore
 * create deterministic, self-contained pages before sending the HTML to the
 * printer.
 */

import type { PublishedWatchTimetable, TimetableSlot } from '../services/watchKeeping';
import { formatLocalDateString } from './index';

// The earlier 20-row layout could overflow an A4 page when metadata or cell
// values wrapped. Twelve leaves room for multi-line names, positions, routes,
// and the page footer while keeping each printed page self-contained.
export const WATCH_SCHEDULE_ROWS_PER_PAGE = 12;

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

interface WatchSchedulePage {
  schedule: PublishedWatchTimetable;
  slots: TimetableSlot[];
}

function paginateSchedules(schedules: PublishedWatchTimetable[]): WatchSchedulePage[] {
  return schedules.flatMap((schedule) => {
    if (schedule.slots.length === 0) return [{ schedule, slots: [] }];

    const pages: WatchSchedulePage[] = [];
    for (let index = 0; index < schedule.slots.length; index += WATCH_SCHEDULE_ROWS_PER_PAGE) {
      pages.push({
        schedule,
        slots: schedule.slots.slice(index, index + WATCH_SCHEDULE_ROWS_PER_PAGE),
      });
    }
    return pages;
  });
}

export function buildWatchSchedulePdfHtml(schedules: PublishedWatchTimetable[]): string {
  const pages = paginateSchedules(schedules);
  const pageBlocks = pages
    .map(({ schedule, slots }, pageIndex) => {
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
        <p class="page-num">Page ${pageIndex + 1} of ${pages.length}</p>
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
    .page { width: 100%; break-inside: avoid-page; page-break-inside: avoid; }
    .page:not(:last-child) { break-after: page; page-break-after: always; }
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
    .page-num { margin: 10px 0 0; color: #6b7280; text-align: right; }
  </style>
</head>
<body>${pageBlocks}</body>
</html>`;
}
