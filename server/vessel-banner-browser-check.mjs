// Run: node server/vessel-banner-browser-check.mjs; open the printed local URL.
// Uses the actual web component. No accounts, uploads or production requests.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function render(source) {
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../yachy-app/src/components/VesselBanner.web.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) =>
      id === "expo-asset"
        ? {
            Asset: {
              fromModule: () => {
                throw Error("Use fixture URI");
              },
            },
          }
        : require(id),
    module,
    module.exports,
  );
  return renderToStaticMarkup(
    React.createElement(module.exports.VesselBanner, {
      source: { uri: source },
      name: "Vessel photo preview",
      onError: () => {},
    }),
  );
}
const shapes = [
  [1200, 900],
  [900, 1200],
  [1600, 900],
];
function sample(w, h) {
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#d3e5f4"/><path d="M0 ${h * 0.65}H${w}V${h}H0" fill="#276990"/><path d="M${w * 0.2} ${h * 0.51}H${w * 0.8}L${w * 0.7} ${h * 0.66}H${w * 0.3}Z" fill="white"/><path d="M${w * 0.45} ${h * 0.49}V${h * 0.2}L${w * 0.65} ${h * 0.49}Z" fill="#fff"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.35}" fill="none" stroke="#213a62" stroke-width="6"/><text x="${w / 2}" y="${h * 0.85}" text-anchor="middle" font-size="30">${w} × ${h} test image</text></svg>`,
    )
  );
}
let latest;
const server = createServer((req, res) => {
  if (req.url === "/sample.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(
      readFileSync(
        new URL(
          "../yachy-app/assets/default-vessel-banner.png",
          import.meta.url,
        ),
      ),
    );
    return;
  }
  if (req.url === "/result" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      latest = JSON.parse(body);
      console.log(JSON.stringify(latest));
      res.end("saved");
    });
    return;
  }
  if (req.url === "/result") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(latest || { status: "not run" }));
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const variants = shapes.map(([w, h]) => render(sample(w, h)));
  res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Vessel photo regression check</title>
  <style>body{margin:24px;background:#f6f8fa;font:16px system-ui;color:#162641}h1{font-size:24px}iframe{border:0;display:block}#results{white-space:pre-wrap}#checks{position:absolute;left:-20000px;top:0}.preview{max-width:720px;margin:auto}</style>
  <h1>Vessel photo: consistent framing</h1><p id="status">Running browser checks…</p><div class="preview">${render("/sample.png")}</div><pre id="results"></pre><div id="checks"></div>
  <script>
  const variants=${JSON.stringify(variants).replace(/</g, "\\u003c")};
  const widths=[320,390,767,768,1024,1199,1200,1440,1920];
  (async()=>{const failures=[], results=[];
    for(let shape=0;shape<variants.length;shape++){
      let baseline;
      const frame=document.createElement('iframe');frame.height=1600;document.querySelector('#checks').append(frame);
      await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc='<style>body{margin:0}</style>'+variants[shape]});
      for(const width of widths.concat([...widths].reverse())){
        frame.width=width;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const doc=frame.contentDocument, el=doc.querySelector('[data-testid="home-vessel-banner"]'),img=el.querySelector('img');
        await img.decode(); const rect=el.getBoundingClientRect(),css=frame.contentWindow.getComputedStyle(img);
        const signature=[Math.round(rect.width/rect.height*1000),css.objectFit,css.objectPosition].join('|');
        baseline??=signature;
        const errors=[];
        if(signature!==baseline)errors.push('visible crop changes with viewport');
        if(Math.abs(rect.width/rect.height-4/3)>.01)errors.push('phone framing not preserved');
        if(rect.width>720.5||rect.width>width+.5)errors.push('banner exceeds display bound');
        if(css.objectFit!=='cover'||css.objectPosition!=='50% 50%')errors.push('crop is not centred');
        const result={shape:shape+1,viewport:width,frame:[rect.width,rect.height],errors};results.push(result);
        if(errors.length)failures.push(result);
      } frame.remove();
    }
    const report={status:failures.length?'FAIL':'PASS',checks:results.length,failures};
    document.querySelector('#status').textContent=report.status+' — '+results.length+' photo/viewport/resize checks';
    document.querySelector('#results').textContent=failures.length?JSON.stringify(failures,null,2):'4:3 framing and centred crop preserved for landscape, portrait and wide photos.\\nPhone, tablet and laptop widths checked in both resize directions.';
    await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  })().catch(e=>{document.querySelector('#status').textContent='ERROR: '+e.message});
  </script>`);
});
server.listen(55940, "127.0.0.1", () =>
  console.log("Photo check: http://127.0.0.1:55940"),
);
process.on("SIGINT", () => server.close(() => process.exit(0)));
