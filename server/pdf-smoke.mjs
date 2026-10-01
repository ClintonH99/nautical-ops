// Render real application builders; no production data or browser session is used.
// Run: CHROME_EXECUTABLE=/path/to/chrome node server/pdf-smoke.mjs /tmp/output-directory
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { renderPdf } from "./pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "yachy-app");
const requireApp = createRequire(path.join(app, "package.json"));
const ts = requireApp("typescript");
const { PDFDocument } = requireApp("pdf-lib");
const modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = await fs.readFile(
    path.join(app, "src/utils", `${name}.ts`),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      if (id === "./pdfLayout") return modules.get("pdfLayout");
      if (id === "pdf-lib") return requireApp(id);
      // Transport is intentionally mocked: we test the real builders with our web renderer.
      return {};
    },
    Uint8Array,
    Date,
  });
  modules.set(name, exports);
  return exports;
}
if (!process.env.CHROME_EXECUTABLE || !process.argv[2])
  throw new Error("Specify Chrome and output directory");
const out = path.resolve(process.argv[2]);
await fs.mkdir(out, { recursive: true });
const { preparePdfHtml } = await load("pdfLayout");
const { brandPdf } = await load("pdfBranding");
const { buildHoursOfRestPdfHtml } = await load("hoursOfRestPdf");
const logo = (
  await fs.readFile(path.join(app, "assets/sea-miles-pdf-logo-source.png"))
).toString("base64");
const font = (
  await fs.readFile(path.join(app, "assets/fonts/AlexBrush-Regular.ttf"))
).toString("base64");
const month = {
  seafarerName: "Test Crew",
  rank: "Deckhand",
  vesselName: "Test Vessel",
  vesselImoNumber: "1234567",
  monthLabel: "October 2026",
  days: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    hasRecord: true,
    hourMarks: Array.from({ length: 24 }, (_, hour) => hour >= 8 && hour < 16),
    restHoursToday: "16:00",
    restIn24h: "16:00",
    restIn7d: "112:00",
    comment: "Routine watch. All equipment checked.",
  })),
};
const fixtures = [
  {
    name: "hours-of-rest",
    title: "Hours of Work and Rest",
    orientation: "landscape",
    header: true,
    html: buildHoursOfRestPdfHtml(month, font, logo),
    pages: 1,
  },
  {
    name: "short-report",
    title: "Maintenance Log",
    orientation: "portrait",
    html: "<html><head></head><body><p>One maintenance entry.</p></body></html>",
    pages: 1,
  },
  {
    name: "long-report",
    title: "Inventory",
    orientation: "portrait",
    html: `<html><head><style>td{padding:8px}</style></head><body><table><thead><tr><th>Inventory item</th></tr></thead><tbody>${Array.from({ length: 100 }, (_, i) => `<tr><td>Test inventory item ${i + 1}</td></tr>`).join("")}</tbody></table></body></html>`,
    multiple: true,
  },
];
for (const fixture of fixtures) {
  const bytes = await renderPdf(
    preparePdfHtml(
      fixture.html,
      fixture.title,
      fixture.orientation,
      false,
      fixture.header,
    ),
    () =>
      puppeteer.launch({
        executablePath: process.env.CHROME_EXECUTABLE,
        headless: true,
      }),
  );
  const branded = Buffer.from(
    await brandPdf(bytes, fixture.title, logo, fixture.header),
    "base64",
  );
  const doc = await PDFDocument.load(branded);
  if (fixture.pages)
    assert.equal(
      doc.getPageCount(),
      fixture.pages,
      `${fixture.name} page count`,
    );
  if (fixture.multiple) assert.ok(doc.getPageCount() > 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.equal(width > height, fixture.orientation === "landscape");
  await fs.writeFile(path.join(out, `${fixture.name}.pdf`), branded);
  console.log(
    `${fixture.name}: ${doc.getPageCount()} page(s), ${width} x ${height}`,
  );
}
