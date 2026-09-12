import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import type { SeaMileEntry } from '../types';

const ROWS_PER_PAGE = 15;
const A4_LANDSCAPE_WIDTH = 842;
const A4_LANDSCAPE_HEIGHT = 595;
const NAVY = '#1E3A8A';
// Metro resolves this bundled image module for Asset.downloadAsync.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SEA_MILES_LOGO_ASSET = require('../../assets/sea-miles-pdf-logo-source.png');

interface CaptainContactRow {
  key: string;
  firstName: string;
  lastName: string;
  cellNumber: string;
  emailAddress: string;
}

export const SEA_MILES_PDF_PRINT_OPTIONS = {
  width: A4_LANDSCAPE_WIDTH,
  height: A4_LANDSCAPE_HEIGHT,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function signatureHtml(entry: SeaMileEntry): string {
  if (
    entry.reviewerSignatureType === 'drawn' &&
    entry.reviewerSignatureImage?.startsWith('data:image/')
  ) {
    return `<img class="signature-image" src="${escapeHtml(entry.reviewerSignatureImage)}" alt="Signature">`;
  }
  if (entry.reviewerSignatureType === 'typed' && entry.reviewerTypedName) {
    return `<span class="typed-signature">${escapeHtml(entry.reviewerTypedName)}</span>`;
  }
  return '';
}

function skipperDisplayName(entry: SeaMileEntry): string {
  const contactName = [entry.reviewerContactFirstName, entry.reviewerContactLastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

  return contactName || entry.reviewerName || '';
}

async function getLogoDataUri(): Promise<string> {
  const asset = Asset.fromModule(SEA_MILES_LOGO_ASSET);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Could not load the Nautical Ops logo for the PDF.');
  const base64 = await FileSystem.readAsStringAsync(asset.localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:image/png;base64,${base64}`;
}

function logoHtml(logoDataUri: string): string {
  return `
    <svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 560" aria-hidden="true">
      <defs>
        <filter id="nautical-ops-gold" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="
            0 0 0 0 0.784
            0 0 0 0 0.588
            0 0 0 0 0.102
            -0.333 -0.333 -0.333 0 1"/>
        </filter>
        <clipPath id="nautical-ops-logo-crop">
          <rect x="20" y="0" width="520" height="525"/>
        </clipPath>
      </defs>
      <image href="${escapeHtml(logoDataUri)}" width="560" height="560" preserveAspectRatio="xMidYMid meet" filter="url(#nautical-ops-gold)" clip-path="url(#nautical-ops-logo-crop)"/>
    </svg>`;
}

function entryRow(entry: SeaMileEntry): string {
  return `
    <tr>
      <td>${escapeHtml(formatDate(entry.voyageDate))}</td>
      <td>${escapeHtml(entry.vesselName)} &bull; ${escapeHtml(entry.vesselLength)}</td>
      <td>${escapeHtml(entry.fromLocation)} &rarr; ${escapeHtml(entry.toLocation)}</td>
      <td>${escapeHtml(entry.capacityRole)}</td>
      <td>${escapeHtml(formatNumber(entry.milesLogged))} NM</td>
      <td>${escapeHtml(formatNumber(entry.dayHours))}</td>
      <td>${escapeHtml(formatNumber(entry.nightHours))}</td>
      <td>${entry.tidal ? 'Yes' : 'No'}</td>
      <td class="skipper-cell">
        <span class="skipper-name">${escapeHtml(skipperDisplayName(entry))}</span>
        ${signatureHtml(entry)}
      </td>
    </tr>`;
}

function fallbackCaptainName(reviewerName: string | null): {
  firstName: string;
  lastName: string;
} {
  const parts = (reviewerName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Not recorded', lastName: 'Not recorded' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '—' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function uniqueCaptainContacts(entries: SeaMileEntry[]): CaptainContactRow[] {
  const contacts = new Map<string, CaptainContactRow>();

  entries.forEach((entry) => {
    const fallbackName = fallbackCaptainName(entry.reviewerName);
    const firstName = entry.reviewerContactFirstName?.trim() || fallbackName.firstName;
    const lastName = entry.reviewerContactLastName?.trim() || fallbackName.lastName;
    const cellNumber = entry.reviewerContactCellNumber?.trim() || '—';
    const emailAddress = entry.reviewerContactEmailAddress?.trim() || '—';
    const key = entry.reviewedBy || `${firstName}|${lastName}|${cellNumber}|${emailAddress}`;

    if (!contacts.has(key)) {
      contacts.set(key, { key, firstName, lastName, cellNumber, emailAddress });
    }
  });

  return [...contacts.values()];
}

function captainContactRows(entries: SeaMileEntry[]): string {
  return uniqueCaptainContacts(entries)
    .map(
      (contact) => `
        <tr class="captain-contact-row">
          <td>${escapeHtml(contact.firstName)}</td>
          <td>${escapeHtml(contact.lastName)}</td>
          <td>${escapeHtml(contact.cellNumber)}</td>
          <td>${escapeHtml(contact.emailAddress)}</td>
        </tr>`
    )
    .join('');
}

function paginateEntries(entries: SeaMileEntry[]): SeaMileEntry[][] {
  const pages: SeaMileEntry[][] = [];
  let currentPage: SeaMileEntry[] = [];

  entries.forEach((entry) => {
    const candidate = [...currentPage, entry];
    const captainCount = uniqueCaptainContacts(candidate).length;
    const capacity = Math.max(5, ROWS_PER_PAGE - Math.max(0, captainCount - 3));

    if (currentPage.length && candidate.length > capacity) {
      pages.push(currentPage);
      currentPage = [entry];
    } else {
      currentPage = candidate;
    }
  });

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function pageHtml(
  entries: SeaMileEntry[],
  crewMemberName: string,
  issueDate: string,
  pageNumber: number,
  isLastPage: boolean,
  logoDataUri = ''
): string {
  return `
    <section class="page${isLastPage ? ' last-page' : ''}">
      <header>
        <div class="brand">${logoDataUri ? logoHtml(logoDataUri) : ''}<span>NAUTICAL OPS</span></div>
        <h1>PERSONAL SEA SERVICE RECORD</h1>
        <div class="metadata">
          <div><span class="metadata-label">CREW MEMBER</span><strong>${escapeHtml(crewMemberName)}</strong></div>
          <div><span class="metadata-label">ISSUE DATE</span><strong>${escapeHtml(issueDate)}</strong></div>
          <div><span class="metadata-label">RECORD STATUS</span><strong>VERIFIED</strong></div>
        </div>
      </header>
      <section class="captain-contact-section">
        <h2>CAPTAIN'S CONTACT DETAILS TO VERIFY INFORMATION</h2>
        <table class="contact-table">
          <colgroup><col><col><col class="contact-cell-col"><col class="contact-email-col"></colgroup>
          <thead>
            <tr><th>First Name</th><th>Last Name</th><th>Cell Number with Area Code</th><th>Email Address</th></tr>
          </thead>
          <tbody>${captainContactRows(entries)}</tbody>
        </table>
      </section>
      <h2 class="sea-record-title">SEA MILES RECORD</h2>
      <table class="sea-record-table">
        <colgroup>
          <col class="date-col"><col class="vessel-col"><col class="route-col"><col class="role-col">
          <col class="miles-col"><col class="hours-col"><col class="hours-col"><col class="tidal-col"><col class="skipper-col">
        </colgroup>
        <thead>
          <tr>
            <th>Date</th><th>Vessel Name &amp; Length</th><th>From / To</th><th>Capacity / Role</th>
            <th>Miles Logged</th><th>Day Hours</th><th>Night Hours</th><th>Tidal (Y/N)</th><th>Skipper Name &amp; Signature</th>
          </tr>
        </thead>
        <tbody>${entries.map(entryRow).join('')}</tbody>
      </table>
      <footer><span>Generated securely by Nautical Ops</span><span>Page ${pageNumber}</span></footer>
    </section>`;
}

export function buildSeaMilesPdfHtml(
  entries: SeaMileEntry[],
  crewMemberName: string,
  generatedAt = new Date(),
  logoDataUri = ''
): string {
  if (!entries.length) throw new Error('Select at least one approved sea-mile entry.');
  if (entries.some((entry) => entry.status !== 'APPROVED')) {
    throw new Error('Only approved sea-mile entries can be exported.');
  }
  if (
    entries.some(
      (entry) =>
        !entry.reviewerName ||
        !entry.reviewedAt ||
        !entry.reviewerSignatureType ||
        (entry.reviewerSignatureType === 'drawn'
          ? !entry.reviewerSignatureImage
          : !entry.reviewerTypedName)
    )
  ) {
    throw new Error('Every exported entry must include its Captain/MOV approval signature.');
  }

  const sorted = [...entries].sort((a, b) =>
    a.voyageDate === b.voyageDate
      ? a.createdAt.localeCompare(b.createdAt)
      : a.voyageDate.localeCompare(b.voyageDate)
  );
  const pages = paginateEntries(sorted);
  const issueDate = generatedAt.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { size: 297mm 210mm; margin: 0; }
          * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { width: 297mm; margin: 0; padding: 0; color: ${NAVY}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
          .page { width: 297mm; height: 210mm; position: relative; page-break-after: auto; break-after: auto; padding: 6mm 8mm; overflow: hidden; }
          .page:not(.last-page) { page-break-after: always; break-after: page; }
          header { text-align: center; }
          .brand { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 15px; font-weight: 800; letter-spacing: .2px; }
          .brand-logo { width: 14mm; height: 14mm; }
          h1 { margin: 1mm 0 3mm; font-size: 25px; line-height: 1; color: ${NAVY}; letter-spacing: .5px; }
          .metadata { display: grid; grid-template-columns: repeat(3, 1fr); align-items: start; margin: 0 16mm 3mm; }
          .metadata > div { display: flex; flex-direction: column; gap: 1.2mm; }
          .metadata-label { font-size: 8px; font-weight: 700; letter-spacing: 1px; }
          .metadata strong { font-size: 13px; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; color: ${NAVY}; }
          th, td { border: .7px solid ${NAVY}; text-align: center; vertical-align: middle; padding: 1.15mm .8mm; line-height: 1.2; }
          th { color: #fff !important; background-color: ${NAVY} !important; box-shadow: inset 0 0 0 1000px ${NAVY}; font-weight: 800; }
          .captain-contact-section { margin: 0 0 2.4mm; }
          .captain-contact-section h2, .sea-record-title { margin: 0 0 1.4mm; color: ${NAVY}; font-size: 10px; line-height: 1; letter-spacing: .6px; text-align: left; }
          .captain-contact-section h2::after, .sea-record-title::after { content: ""; display: block; width: 16mm; height: .6mm; margin-top: 1.2mm; background-color: #C8961A; }
          .contact-table th { height: 6.5mm; font-size: 8px; }
          .contact-table td { height: 5.5mm; font-size: 8.5px; font-weight: 600; }
          .contact-cell-col { width: 25%; } .contact-email-col { width: 35%; }
          .sea-record-title { margin-top: 0; }
          .sea-record-table th { height: 9mm; font-size: 8.2px; }
          .sea-record-table td { height: 7mm; font-size: 9.2px; font-weight: 600; }
          .date-col { width: 8.5%; } .vessel-col { width: 14.5%; } .route-col { width: 16.5%; }
          .role-col { width: 11%; } .miles-col { width: 8.5%; } .hours-col { width: 6%; }
          .tidal-col { width: 6.5%; } .skipper-col { width: 22.5%; }
          .skipper-cell { white-space: nowrap; padding-left: 1.2mm; padding-right: 1.2mm; }
          .skipper-name { display: inline-block; width: 53%; text-align: left; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; }
          .signature-image { display: inline-block; width: 44%; height: 5.2mm; object-fit: contain; vertical-align: middle; }
          .typed-signature { display: inline-block; width: 44%; text-align: center; vertical-align: middle; font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 12px; font-style: italic; }
          footer { position: absolute; left: 8mm; right: 8mm; bottom: 3.5mm; display: flex; justify-content: space-between; font-size: 7px; color: ${NAVY}; }
        </style>
      </head>
      <body>${pages.map((page, index) => pageHtml(page, crewMemberName, issueDate, index + 1, index === pages.length - 1, logoDataUri)).join('')}</body>
    </html>`;
}

export async function generateSeaMilesPdf(
  entries: SeaMileEntry[],
  crewMemberName: string
): Promise<void> {
  const logoDataUri = await getLogoDataUri();
  const html = buildSeaMilesPdfHtml(entries, crewMemberName, new Date(), logoDataUri);
  const { uri } = await Print.printToFileAsync({
    html,
    ...SEA_MILES_PDF_PRINT_OPTIONS,
  });
  const today = new Date().toISOString().slice(0, 10);
  const filename = `Personal_Sea_Service_Record_${today}.pdf`;
  const destination = `${FileSystem.cacheDirectory}${filename}`;
  const existingFile = await FileSystem.getInfoAsync(destination);
  if (existingFile.exists) {
    await FileSystem.deleteAsync(destination, { idempotent: true });
  }
  await FileSystem.moveAsync({ from: uri, to: destination });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('PDF sharing is not available on this device.');
  }
  await Sharing.shareAsync(destination, {
    mimeType: 'application/pdf',
    dialogTitle: `Save ${filename}`,
  });
}
