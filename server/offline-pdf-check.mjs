// Browser-driven local PDF regression fixture. No real data, credentials or API.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { createRequire } from "node:module";
const root = resolve(import.meta.dirname, ".."),
  app = join(root, "yachy-app"),
  out = process.env.PDF_CHECK_DIR || "/private/tmp/nautical-offline-pdf-check";
mkdirSync(out, { recursive: true });
const require = createRequire(join(app, "package.json")),
  ts = require("typescript");
const assets = JSON.parse(
  readFileSync(join(app, "src/utils/pdfEmbeddedAssets.json"), "utf8"),
);
const modules = {};
for (const file of [
  "pdfLayout",
  "pdfErrors",
  "offlinePdf.web",
  "vesselLogsPdf",
  "hoursOfRestPdf",
  "seaMilesPdf",
  "inventoryPdf",
  "rulesPdf",
  "pdfBranding",
]) {
  let source = readFileSync(join(app, "src/utils", file + ".ts"), "utf8");
  source = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  source = source.replace(/^import .*?;\n/gm, "").replace(/\bexport /g, "");
  if (file === "pdfBranding")
    source = source.replace(/require\('pdf-lib'\)/g, "window.PDFLib");
  const exports = {
    vesselLogsPdf: ["buildFuelLogHtml"],
    hoursOfRestPdf: ["buildHoursOfRestPdfHtml"],
    seaMilesPdf: ["buildSeaMilesPdfHtml"],
    inventoryPdf: ["buildInventoryHtml"],
    rulesPdf: ["buildRulesPdfHtml"],
  };
  modules[file] = exports[file]
    ? `const {${exports[file].join(",")}}=(()=>{${source};return {${exports[file].join(",")}};})();`
    : source;
}
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Offline PDF layout checks</title></head><body><h1>Offline PDF layout checks</h1><button id="run">Generate synthetic PDFs</button><pre id="status">Ready — local synthetic data only</pre><script src="/pdf-lib.js"></script><script type="module">
const assets=${JSON.stringify(assets)};
${Object.values(modules).join("\n")}
const fuel=Array.from({length:7},(_,i)=>({locationOfRefueling:'Synthetic harbour '+(i+1),logDate:'2026-11-10',logTime:'09:15',amountOfFuel:250.5,pricePerVolumeUnit:2.15,totalPrice:538.58,volumeUnit:'LITRES',priceVolumeUnit:'LITRES',currencyCode:'USD',comment:i===3?'Long comment to verify wrapping without clipping. '.repeat(75):'Synthetic receipt — saved safely offline.',offlinePending:i===0}));
const rest={seafarerName:'Synthetic Captain',rank:'Captain',vesselName:'Offline test vessel',vesselImoNumber:'IMO1234567',monthLabel:'November 2026',days:Array.from({length:30},(_,i)=>({date:'2026-11-'+String(i+1).padStart(2,'0'),hourMarks:Array.from({length:24},(_,h)=>h>=8&&h<16),hasRecord:i<20,restHoursToday:'16:00',restIn24h:'16:00',restIn7d:'112:00',comment:i===5?'Synthetic longer comment for wrapping in narrow columns.':'At sea'})),masterSignature:{signatureType:'typed',typedName:'Synthetic Master'},seafarerSignature:{signatureType:'typed',typedName:'Synthetic Captain'}};
document.getElementById('run').onclick=async()=>{const status=document.getElementById('status');try{const cases=[['sea','Sea Miles',buildSeaMilesPdfHtml(Array.from({length:40},(_,i)=>({voyageDate:'2026-11-10',createdAt:'2026-11-10',vesselName:'Synthetic vessel',vesselLength:'24m',fromLocation:'Port A',toLocation:'Port B',capacityRole:'Captain',milesLogged:80,dayHours:8,nightHours:2,tidal:true,status:'APPROVED',reviewerName:'Synthetic Master',reviewedAt:'2026-11-10',reviewerSignatureType:'typed',reviewerTypedName:'Synthetic Master'})),'Synthetic Crew'),'landscape',false],['inventory','Inventory',buildInventoryHtml([{title:'Engine spares',department:'ENGINEERING',location:'Engine room',description:'Synthetic offline inventory',items:Array.from({length:70},(_,i)=>({amount:String(i+1),item:'Synthetic spare '+i}))}]),'portrait',false],['rules','Rules On-Board',buildRulesPdfHtml([{title:'Synthetic rules',rules:Array.from({length:30},(_,i)=>'Rule '+(i+1)+': Keep the vessel records up to date. '.repeat(5))}]),'portrait',false],['fuel','Fuel Receipts',buildFuelLogHtml(fuel),'portrait',false],['rest','Hours of Work and Rest',buildHoursOfRestPdfHtml(rest,assets.signatureFont,assets.logo),'landscape',true],['long-table','Long table','<!doctype html><html><head><style>body{font:12px Arial}td,th{padding:6px;border:1px solid #ccc}table{border-collapse:collapse}th{background:#203c88;color:white}</style></head><body><table><thead><tr><th>Item</th><th>Description</th></tr></thead><tbody>'+Array.from({length:120},(_,i)=>'<tr><td>'+i+'</td><td>Record '+i+' — '+('Long synthetic description '.repeat(i===43?25:2))+'</td></tr>').join('')+'</tbody></table></body></html>','portrait',false]];for(const [name,title,html,orientation,header] of cases){status.textContent='Rendering '+name;const raw=await renderOfflinePdf(html,title,orientation,header);const data=await brandPdf(raw,title,assets.logo,header);const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const res=await fetch('/result/'+name,{method:'POST',body:bytes});if(!res.ok)throw Error('Could not save result');}status.textContent='PASS — Fuel, Rest, Sea Miles, Inventory, Rules and long tables generated locally';}catch(e){status.textContent='FAIL — '+e.stack;}};
</script></body></html>`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (req.headers.host !== "127.0.0.1:58320") {
    res.writeHead(403);
    return res.end();
  }
  if (
    req.method === "POST" &&
    /^\/result\/(fuel|rest|long-table|sea|inventory|rules)$/.test(path)
  ) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 20e6) {
        res.writeHead(413);
        return res.end();
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString() !== "%PDF-") {
      res.writeHead(400);
      return res.end();
    }
    writeFileSync(join(out, path.split("/").at(-1) + ".pdf"), bytes);
    return res.end("saved");
  }
  if (path === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(page);
  }
  const file =
    path === "/pdf-lib.js"
      ? require.resolve("pdf-lib/dist/pdf-lib.min.js")
      : path.startsWith("/offline-pdf/")
        ? join(app, "public", path)
        : null;
  if (file && existsSync(file)) {
    res.setHeader("Content-Type", "application/javascript");
    return res.end(readFileSync(file));
  }
  res.writeHead(404);
  res.end();
});
server.listen(58320, "127.0.0.1", () =>
  console.log("PDF checks http://127.0.0.1:58320 — " + out),
);
