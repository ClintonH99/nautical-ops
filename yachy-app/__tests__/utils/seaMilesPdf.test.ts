jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-asset', () => ({}));

import type { SeaMileEntry } from '../../src/types';
import { buildSeaMilesPdfHtml, SEA_MILES_PDF_PRINT_OPTIONS } from '../../src/utils/seaMilesPdf';

function approvedEntry(index: number): SeaMileEntry {
  const day = String((index % 28) + 1).padStart(2, '0');
  return {
    id: `entry-${index}`,
    userId: 'crew-1',
    reviewVesselId: `vessel-${index % 4}`,
    voyageDate: `2026-08-${day}`,
    vesselName: `M/Y Vessel ${index}`,
    vesselLength: '42 m',
    fromLocation: 'Fort Lauderdale',
    toLocation: 'Nassau',
    capacityRole: 'Deckhand',
    milesLogged: 142 + index,
    dayHours: 8,
    nightHours: 4,
    tidal: index % 2 === 0,
    status: 'APPROVED',
    declineComment: null,
    submittedAt: '2026-08-01T10:00:00Z',
    reviewedBy: `captain-${index % 4}`,
    reviewerName: `Captain ${index % 4}`,
    reviewerSignatureType: 'typed',
    reviewerSignatureImage: null,
    reviewerTypedName: `Captain ${index % 4}`,
    reviewerContactFirstName: 'Captain',
    reviewerContactLastName: String(index % 4),
    reviewerContactCellNumber: `+1 954 555 010${index % 4}`,
    reviewerContactEmailAddress: `captain${index % 4}@example.com`,
    reviewedAt: '2026-08-02T10:00:00Z',
    ownerName: 'Rachel Morgan',
    createdAt: `2026-08-${day}T09:00:00Z`,
    updatedAt: `2026-08-${day}T10:00:00Z`,
  };
}

describe('buildSeaMilesPdfHtml', () => {
  it('keeps up to 15 entries on one page when they fit', () => {
    const entries = Array.from({ length: 15 }, (_, index) => ({
      ...approvedEntry(index),
      reviewedBy: 'captain-1',
      reviewerName: 'Captain One',
      reviewerTypedName: 'Captain One',
      reviewerContactFirstName: 'Captain',
      reviewerContactLastName: 'One',
      reviewerContactCellNumber: '+1 954 555 0101',
      reviewerContactEmailAddress: 'captain1@example.com',
    }));
    const html = buildSeaMilesPdfHtml(entries, 'Rachel Morgan');

    expect((html.match(/PERSONAL SEA SERVICE RECORD/g) ?? []).length).toBe(1);
    expect(html).toContain('Page 1');
    expect(html).not.toContain('Page 2');
    expect((html.match(/class="page last-page"/g) ?? []).length).toBe(1);
  });

  it('adds a second page only when the records no longer fit', () => {
    const entries = Array.from({ length: 16 }, (_, index) => ({
      ...approvedEntry(index),
      reviewedBy: 'captain-1',
      reviewerName: 'Captain One',
      reviewerTypedName: 'Captain One',
      reviewerContactFirstName: 'Captain',
      reviewerContactLastName: 'One',
      reviewerContactCellNumber: '+1 954 555 0101',
      reviewerContactEmailAddress: 'captain1@example.com',
    }));
    const html = buildSeaMilesPdfHtml(
      entries,
      'Rachel Morgan',
      new Date('2026-09-10T12:00:00Z')
    );

    expect((html.match(/PERSONAL SEA SERVICE RECORD/g) ?? []).length).toBe(2);
    expect(html).toContain('Page 1');
    expect(html).toContain('Page 2');
    expect(html).not.toContain('CAPTAIN/MOV CERTIFICATION');
    expect((html.match(/Skipper Name &amp; Signature/g) ?? []).length).toBe(2);
    expect((html.match(/SEA MILES RECORD/g) ?? []).length).toBe(2);
    expect((html.match(/CAPTAIN'S CONTACT DETAILS TO VERIFY INFORMATION/g) ?? []).length).toBe(2);
    expect((html.match(/class="typed-signature"/g) ?? []).length).toBe(16);
    expect((html.match(/class="page"/g) ?? []).length).toBe(1);
    expect((html.match(/class="page last-page"/g) ?? []).length).toBe(1);
  });

  it('lists each approving captain once before the sea-mile records table', () => {
    const html = buildSeaMilesPdfHtml(
      [approvedEntry(1), approvedEntry(5), approvedEntry(2)],
      'Rachel Morgan'
    );

    expect((html.match(/class="captain-contact-row"/g) ?? []).length).toBe(2);
    expect(html.indexOf("CAPTAIN'S CONTACT DETAILS TO VERIFY INFORMATION")).toBeLessThan(
      html.indexOf('SEA MILES RECORD')
    );
    expect(html.indexOf('SEA MILES RECORD')).toBeLessThan(
      html.indexOf('Skipper Name &amp; Signature')
    );
  });

  it('forces the approved A4 landscape page and preserves navy print backgrounds', () => {
    const html = buildSeaMilesPdfHtml([approvedEntry(1)], 'Rachel Morgan');

    expect(html).toContain('@page { size: 297mm 210mm; margin: 0; }');
    expect(html).toContain('-webkit-print-color-adjust: exact !important');
    expect(html).toContain('background-color: #1E3A8A !important');
  });

  it('uses the supplied Nautical Ops logo and readable data-row typography', () => {
    const logoDataUri = 'data:image/png;base64,exact-logo';
    const html = buildSeaMilesPdfHtml(
      [approvedEntry(1)],
      'Rachel Morgan',
      new Date('2026-09-11T12:00:00Z'),
      logoDataUri
    );

    expect(html).toContain(`href="${logoDataUri}"`);
    expect(html).toContain('filter="url(#nautical-ops-gold)"');
    expect(html).toContain('clip-path="url(#nautical-ops-logo-crop)"');
    expect(html).toContain(
      '.sea-record-table td { height: 7mm; font-size: 9.2px; font-weight: 600; }'
    );
    expect(html).not.toContain('M15 75 Q15 85');
  });

  it('uses the saved Captain Contact Details name instead of the login-profile name', () => {
    const entry = approvedEntry(1);
    entry.reviewerName = 'Login Profile Name';
    entry.reviewerContactFirstName = 'James';
    entry.reviewerContactLastName = 'Morgan';

    const html = buildSeaMilesPdfHtml([entry], 'Rachel Morgan');

    expect(html).toContain('<span class="skipper-name">James Morgan</span>');
    expect(html).not.toContain('Login Profile Name');
  });

  it('uses the login-profile name only for an older record without saved contact details', () => {
    const entry = approvedEntry(1);
    entry.reviewerName = 'Legacy Captain';
    entry.reviewerContactFirstName = null;
    entry.reviewerContactLastName = null;
    entry.reviewerContactCellNumber = null;
    entry.reviewerContactEmailAddress = null;

    const html = buildSeaMilesPdfHtml([entry], 'Rachel Morgan');

    expect(html).toContain('<span class="skipper-name">Legacy Captain</span>');
  });

  it('uses A4 landscape dimensions for Expo Print on iOS', () => {
    expect(SEA_MILES_PDF_PRINT_OPTIONS).toEqual({
      width: 842,
      height: 595,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  });

  it('refuses to export any unapproved entry', () => {
    const entry = approvedEntry(1);
    entry.status = 'PENDING';
    expect(() => buildSeaMilesPdfHtml([entry], 'Rachel Morgan')).toThrow(
      'Only approved sea-mile entries can be exported'
    );
  });

  it('refuses approved records without their stored Captain signature', () => {
    const entry = approvedEntry(1);
    entry.reviewerTypedName = null;
    expect(() => buildSeaMilesPdfHtml([entry], 'Rachel Morgan')).toThrow(
      'must include its Captain/MOV approval signature'
    );
  });
});
