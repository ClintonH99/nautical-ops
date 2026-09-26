/* global __dirname, process, Buffer, console */
/* Local rendering regression check. No live records or backend calls.
 * NODE_PATH=<runtime node_modules> node scripts/verify-pdf-layout.cjs <output-dir>
 * Requires Playwright/Chromium in the test environment, not in the mobile app.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || '/private/tmp/nautical-pdf-qa');
fs.mkdirSync(output, { recursive: true });

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    filename
  );
};
for (const extension of ['.png', '.ttf'])
  require.extensions[extension] = (module, filename) => {
    module.exports = filename;
  };
const captured = [];
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id.endsWith('/standardPdf'))
    return {
      getPdfLogoBase64: async () =>
        fs.readFileSync(path.join(root, 'assets/sea-miles-pdf-logo-source.png')).toString('base64'),
      printStandardPdf: async (options) => {
        captured.push(options);
        return { uri: 'file:///fixture.pdf' };
      },
    };
  if (id === 'expo-file-system/legacy')
    return {
      cacheDirectory: 'file:///fixtures/',
      EncodingType: { Base64: 'base64' },
      readAsStringAsync: async (filename) => fs.readFileSync(filename).toString('base64'),
      moveAsync: async () => {},
      getInfoAsync: async () => ({ exists: false }),
    };
  if (id === 'expo-sharing')
    return { isAvailableAsync: async () => true, shareAsync: async () => {} };
  if (id === 'expo-asset')
    return {
      Asset: { fromModule: (filename) => ({ localUri: filename, downloadAsync: async () => {} }) },
    };
  if (id === './supabase') return { supabase: {} };
  return originalLoad.call(this, id, parent, isMain);
};
const load = (name) => require(path.join(root, 'src/utils', name + '.ts'));
const { preparePdfHtml } = load('pdfLayout');
const { brandPdf } = load('pdfBranding');
const logo = fs.readFileSync(path.join(root, 'assets/sea-miles-pdf-logo-source.png'));
const date = '2026-09-26';
const base = {
  id: 'fixture',
  vesselId: 'vessel',
  department: 'ENGINEERING',
  createdAt: `${date}T10:00:00Z`,
  createdByName: 'Alex Morgan',
  logDate: date,
  logTime: '10:00',
};
const samples = [];

async function capture(name, fn) {
  const before = captured.length;
  await fn();
  if (captured.length !== before + 1) throw new Error(`Missing shared export: ${name}`);
  samples.push({ name, ...captured.pop() });
}

async function fixtures() {
  for (const variant of ['short', 'long']) {
    const count = variant === 'short' ? 1 : 70;
    const text = (i) =>
      `ITEM-${String(i + 1).padStart(3, '0')} ${variant === 'long' ? 'Checked onboard equipment and confirmed all details. '.repeat(3) : 'Secure all loose equipment.'}`;
    const rows = Array.from({ length: count }, (_, i) => ({ amount: '2', item: text(i) }));
    await capture(`inventory-${variant}`, () =>
      load('inventoryPdf').exportInventoryToPdf([
        { ...base, title: 'Engine spares', location: 'Workshop', description: '', items: rows },
      ])
    );
    await capture(`uniforms-${variant}`, () =>
      load('uniformsPdf').exportUniformsToPdf([
        {
          ...base,
          label: 'Crew uniforms',
          entries: rows.map((r) => ({
            size: 'M',
            color: 'Navy',
            gender: 'Unisex',
            amount: '2',
            dayNight: r.item,
          })),
        },
      ])
    );
    await capture(`rules-${variant}`, () =>
      load('rulesPdf').generateRulesPdf(
        'Rules On-Board',
        rows.map((r) => r.item),
        'rules.pdf'
      )
    );
    await capture(`checklist-${variant}`, () =>
      load('preDepartureChecklistPdf').generatePreDepartureChecklistPdf(
        [
          {
            ...base,
            title: 'Deck checks',
            items: rows.map((r, i) => ({ label: r.item, sortOrder: i })),
          },
        ],
        'Test Vessel',
        'checklist.pdf'
      )
    );
    await capture(`shipyard-${variant}`, () =>
      load('yardJobsPdf').exportYardJobsToPdf(
        rows.map((r) => ({
          ...base,
          jobTitle: r.item,
          status: 'NOT_STARTED',
          jobDescription: r.item,
          yardLocation: 'Port',
        }))
      )
    );
    const muster = {
      vesselName: 'Test Vessel',
      musterStationLocations: ['Aft deck'],
      emergencySignals: { fire: 'Continuous alarm' },
      crewMembers: rows.map((r) => ({
        roleName: r.item,
        fire: 'Fire team',
        manOverboard: 'Lookout',
        grounding: 'Inspect',
        abandonShip: 'Raft',
        medical: 'First aid',
      })),
    };
    await capture(`muster-${variant}`, () =>
      load('musterStationPdf').generateMusterStationPdf(
        muster,
        'muster.pdf',
        'Muster Station & Duties'
      )
    );
    const safety = {
      vesselName: 'Test Vessel',
      fireExtinguishers: rows.map((r) => ({
        location: r.item,
        lastChecked: date,
        expiryDate: '2027-09-26',
      })),
    };
    await capture(`safety-${variant}`, () =>
      load('safetyEquipmentPdf').generateSafetyEquipmentPdf(
        safety,
        'Safety Equipment',
        'safety.pdf'
      )
    );
    await capture(`waste-${variant}`, () =>
      load('vesselLogsPdf').exportGeneralWasteLogPdf(
        rows.map((r) => ({
          ...base,
          positionLocation: 'Port',
          descriptionOfGarbage: r.item,
          weight: 2,
          weightUnit: 'kgs',
        })),
        'Test Vessel'
      )
    );
    await capture(`fuel-${variant}`, () =>
      load('vesselLogsPdf').exportFuelLogPdf(
        rows.map((r) => ({
          ...base,
          locationOfRefueling: r.item,
          amountOfFuel: 100,
          pricePerGallon: 4,
          pricePerVolumeUnit: 4,
          totalPrice: 400,
          volumeUnit: 'US_GALLONS',
          priceVolumeUnit: 'US_GALLONS',
          currencyCode: 'USD',
          comment: '',
        })),
        'Test Vessel'
      )
    );
    await capture(`discharge-${variant}`, () =>
      load('vesselLogsPdf').exportPumpOutLogPdf(
        rows.map((r) => ({
          ...base,
          location: 'Port',
          dischargeType: 'PUMPOUT_SERVICE',
          pumpoutServiceName: 'Dock',
          amountInGallons: 10,
          description: r.item,
        })),
        'Test Vessel'
      )
    );
    const slots = rows.map((r) => ({
      crewName: r.item,
      crewPosition: 'Deckhand',
      startDate: date,
      endDate: date,
      startTimeStr: '08:00',
      endTimeStr: '12:00',
      durationHours: 4,
    }));
    samples.push({
      name: `watch-${variant}`,
      title: 'Watch Schedule',
      html: load('watchSchedulePdf').buildWatchSchedulePdfHtml([
        {
          ...base,
          forDate: date,
          watchTitle: 'Delivery',
          startTime: '08:00',
          startLocation: 'Port',
          destination: 'Marina',
          slots,
        },
      ]),
    });
    const entries = rows.map((r, i) => ({
      ...base,
      voyageDate: date,
      vesselName: `Vessel ${i + 1}`,
      vesselLength: '42 m',
      fromLocation: 'Port',
      toLocation: 'Marina',
      capacityRole: r.item,
      milesLogged: 100,
      dayHours: 8,
      nightHours: 4,
      tidal: true,
      status: 'APPROVED',
      reviewedBy: 'captain',
      reviewerName: 'Alex Morgan',
      reviewedAt: date,
      reviewerSignatureType: 'typed',
      reviewerTypedName: 'Alex Morgan',
      reviewerContactFirstName: 'Alex',
      reviewerContactLastName: 'Morgan',
      reviewerContactCellNumber: '+1 555 0100',
      reviewerContactEmailAddress: 'captain@example.com',
    }));
    await capture(`sea-miles-${variant}`, () =>
      load('seaMilesPdf').generateSeaMilesPdf(entries, 'Sample Crew')
    );
    await capture(`rest-${variant}`, () =>
      load('hoursOfRestPdf').generateHoursOfRestPdf(
        {
          seafarerName: 'Sample Crew',
          rank: 'Deckhand',
          vesselName: 'Test Vessel',
          vesselImoNumber: '1234567',
          monthLabel: 'September 2026',
          days: rows.slice(0, 30).map((r, i) => ({
            date: `2026-09-${String(i + 1).padStart(2, '0')}`,
            hasRecord: i % 3 !== 0,
            hourMarks: Array.from({ length: 24 }, (_, h) => h >= 8 && h < 16),
            restHoursToday: '16:00',
            restIn24h: '16:00',
            restIn7d: '112:00',
            comment: r.item,
          })),
        },
        'rest.pdf'
      )
    );
    // Execute the screen's real inline builder, without loading any React screen.
    const source = fs.readFileSync(path.join(root, 'src/screens/MaintenanceLogScreen.tsx'), 'utf8');
    const builder = source.slice(
      source.indexOf('      const rows = logsToExport'),
      source.indexOf('      const { uri } = await printStandardPdf')
    );
    const logs = rows.map((r) => ({
      ...base,
      equipment: r.item,
      portStarboardNa: 'Port',
      serialNumber: 'SN123',
      hoursOfService: '100',
      hoursAtNextService: '200',
      whatServiceDone: 'Oil change',
      notes: '',
      serviceDoneBy: 'Alex',
    }));
    const html = new Function(
      'logsToExport',
      'vesselName',
      'dateStr',
      'escapeHtml',
      'formatDate',
      builder + '\nreturn html;'
    )(
      logs,
      'Test Vessel',
      date,
      (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      (s) => s.slice(0, 10)
    );
    samples.push({ name: `maintenance-${variant}`, html, title: 'Maintenance Log' });
  }
  // Full months with short notes and signatures must retain the compact form.
  for (const count of [28, 30, 31]) {
    await capture(`rest-month-${count}-short`, () =>
      load('hoursOfRestPdf').generateHoursOfRestPdf(
        {
          seafarerName: 'Sample Crew',
          rank: 'Deckhand',
          vesselName: 'Test Vessel',
          vesselImoNumber: '1234567',
          monthLabel: 'October 2026',
          masterSignature: { signatureType: 'typed', typedName: 'Alex Morgan' },
          seafarerSignature: { signatureType: 'typed', typedName: 'Sample Crew' },
          days: Array.from({ length: count }, (_, i) => ({
            date: `2026-10-${String(i + 1).padStart(2, '0')}`,
            hasRecord: i % 3 !== 0,
            hourMarks: Array.from({ length: 24 }, (_, h) => h >= 8 && h < 16),
            restHoursToday: '16:00',
            restIn24h: '16:00',
            restIn7d: '112:00',
            comment: 'Routine watch',
          })),
        },
        'rest.pdf'
      )
    );
  }
  // Empty data and multiple short boards must not force new or blank pages.
  const { REST_COMMENT_MAX_LENGTH } = load('restComment');
  for (const [kind, comment] of [
    ['wide-latin', 'W'.repeat(REST_COMMENT_MAX_LENGTH)],
    ['wide-unicode', 'Ｍ'.repeat(REST_COMMENT_MAX_LENGTH)],
    ['emoji', '😀'.repeat(REST_COMMENT_MAX_LENGTH / 2)],
  ]) {
    await capture(`rest-limit-${kind}-short`, () =>
      load('hoursOfRestPdf').generateHoursOfRestPdf(
        {
          seafarerName: 'Sample Crew',
          rank: 'Deckhand',
          vesselName: 'Test Vessel',
          vesselImoNumber: '1234567',
          monthLabel: 'October 2026',
          masterSignature: {
            signatureType: 'drawn',
            signatureImage: `data:image/png;base64,${logo.toString('base64')}`,
          },
          seafarerSignature: { signatureType: 'typed', typedName: 'Sample Crew' },
          days: Array.from({ length: 31 }, (_, i) => ({
            date: `2026-10-${String(i + 1).padStart(2, '0')}`,
            hasRecord: true,
            hourMarks: Array.from({ length: 24 }, (_, h) => h >= 8 && h < 16),
            restHoursToday: '16:00',
            restIn24h: '16:00',
            restIn7d: '112:00',
            comment,
          })),
        },
        'rest.pdf'
      )
    );
  }
  samples.push({
    name: 'inventory-empty',
    html: load('inventoryPdf').buildInventoryHtml([]),
    title: 'Inventory',
  });
  await capture('rules-two-short-boards', () =>
    load('rulesPdf').generateRulesDocumentsPdf(
      [
        { title: 'Deck', rules: ['Secure equipment.'] },
        { title: 'Interior', rules: ['Secure drawers.'] },
      ],
      'rules.pdf'
    )
  );
  await capture('muster-two-short-boards', () =>
    load('musterStationPdf').generateMusterStationListPdf(
      [
        { title: 'Aft', data: { crewMembers: [] } },
        { title: 'Bow', data: { crewMembers: [] } },
      ],
      'Test Vessel'
    )
  );
  await capture('safety-two-short-boards', () =>
    load('safetyEquipmentPdf').generateSafetyEquipmentListPdf(
      [
        { title: 'Deck', data: {} },
        { title: 'Interior', data: {} },
      ],
      'Test Vessel'
    )
  );
  samples.push({
    name: 'rules-oversized-line',
    html: load('rulesPdf').buildRulesPdfHtml([
      {
        title: 'Rules On-Board',
        rules: ['Oversized continuous text. '.repeat(2000) + ' LAST-CONTENT-MARKER'],
      },
    ]),
    title: 'Rules On-Board',
  });
}

(async () => {
  await fixtures();
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PDF_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const results = [];
  try {
    const page = await browser.newPage();
    for (const sample of samples) {
      const orientation = sample.orientation || 'portrait';
      const expectedOrientation = /^(rest|sea-miles)-/.test(sample.name) ? 'landscape' : 'portrait';
      if (orientation !== expectedOrientation)
        throw new Error(`${sample.name}: expected ${expectedOrientation} export`);
      const html = preparePdfHtml(
        sample.html,
        sample.title,
        orientation,
        false,
        sample.headerInContent
      );
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      if (sample.name.startsWith('rest-limit-')) {
        // Compare max-width comments against one-character comments at real print width.
        await page.setViewportSize({ width: Math.floor(((841.89 - 72) * 96) / 72), height: 1200 });
        const heights = await page.evaluate(() => {
          const cells = [...document.querySelectorAll('td.comment')];
          return cells.map((cell) => {
            const before = cell.getBoundingClientRect().height;
            const text = cell.textContent;
            cell.textContent = 'X';
            const after = cell.getBoundingClientRect().height;
            cell.textContent = text;
            return { before, after };
          });
        });
        if (heights.some(({ before, after }) => before > after + 1))
          throw new Error(`${sample.name}: comment exceeds one line`);
      }
      const raw = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const branded = await brandPdf(raw, sample.title, logo, sample.headerInContent);
      const document = await PDFDocument.load(branded);
      const count = document.getPageCount();
      if (
        (sample.name.endsWith('-short') ||
          sample.name.includes('two-short') ||
          sample.name.endsWith('-empty')) &&
        count !== 1
      )
        throw new Error(`${sample.name}: expected one page, got ${count}`);
      if (sample.name.endsWith('-long') && count < 2)
        throw new Error(`${sample.name}: expected overflow`);
      for (const sheet of document.getPages()) {
        if (sheet.getWidth() > sheet.getHeight() !== (orientation === 'landscape'))
          throw new Error(`${sample.name}: incorrect orientation`);
      }
      fs.writeFileSync(path.join(output, sample.name + '.html'), html);
      fs.writeFileSync(path.join(output, sample.name + '.pdf'), Buffer.from(branded, 'base64'));
      results.push({
        name: sample.name,
        title: sample.title.toUpperCase(),
        orientation,
        pages: count,
        headerInContent: Boolean(sample.headerInContent),
      });
      console.log(`${sample.name}: ${count} page(s), ${orientation}`);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
