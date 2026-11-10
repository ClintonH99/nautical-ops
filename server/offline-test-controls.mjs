import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

/** Loopback-only controls for the disposable offline test app; never shipped. */
export async function startOfflineTestControls({
  port,
  appOrigin,
  isOnline,
  connect,
  disconnect,
}) {
  const appUrl = new URL(appOrigin);
  if (
    appUrl.protocol !== "http:" ||
    appUrl.hostname !== "127.0.0.1" ||
    appUrl.pathname !== "/"
  )
    throw new Error("Test app must use loopback");
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  let origin,
    busy = false;
  const html =
    () => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Nautical Ops — Offline test</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{font:17px/1.6 system-ui,sans-serif;color:#172645;background:#f5f7fb;margin:0;padding:36px 20px}main{max-width:820px;margin:auto}h1{font-size:36px;line-height:1.2}h2{font-size:22px}.card{background:white;border:1px solid #dce2ed;border-radius:16px;padding:24px;margin:20px 0}.tag{font-size:13px;font-weight:700;letter-spacing:.08em;color:#47618a}a{color:#243c8b}button,.open{font:inherit;font-weight:650;border-radius:9px;padding:12px 18px;cursor:pointer;border:1px solid #243c8b;color:#243c8b;background:white;text-decoration:none;display:inline-block;margin:5px 8px 5px 0}.open{background:#243c8b;color:white}button:disabled{opacity:.4;cursor:default}code{background:#eef1f7;padding:3px 6px;border-radius:4px;overflow-wrap:anywhere}.muted{color:#586780}li{margin:9px 0}#status{font-weight:700}details{margin:18px 0}summary{cursor:pointer;font-weight:650}.state{display:flex;gap:12px;align-items:center}.dot{width:12px;height:12px;border-radius:100%;background:#7c8a9e}.online{background:#178453}.offline{background:#bd711c}</style></head><body><main>
<div class="tag">NAUTICAL OPS · LOCAL TEST BUILD</div><h1>Try working offline</h1>
<p>This is a separate test vessel on this Mac. Use the test account below. It cannot charge anyone or change your live vessel.</p>
<section class="card"><div class="state"><span id="dot" class="dot"></span><span id="status" role="status">Checking test connection…</span></div>
<p><a class="open" href="${appUrl.origin}/login" target="_blank" rel="noopener">Open test app</a></p>
<p>Email: <code>offline@example.test</code><br>Password: <code>synthetic-offline-check</code></p>
<button id="off" disabled>Disconnect test server</button><button id="on" disabled>Reconnect test server</button>
<p id="message" role="status" class="muted">These controls affect this test app only. Leave your Mac’s internet connected.</p></section>
<section class="card"><h2>Your first test</h2><ol>
<li>Open the test app, sign in and press <strong>Continue</strong> if the welcome screen appears. Wait for the app to finish preparing offline access.</li>
<li>Open <strong>Notepad</strong>, then return here and select <strong>Disconnect test server</strong>.</li>
<li>Go back to Notepad. Add a note and edit it. Confirm it says <strong>saved on this device</strong>. Refresh the app page and check that your note is still there.</li>
<li>Return here and select <strong>Reconnect test server</strong>. In the app, select <strong>Retry Sync</strong> if it appears. Wait until there are no pending changes, then refresh again.</li>
</ol><p>The same note should remain, with your latest text and no duplicate.</p></section>
<section class="card"><h2>Available to try</h2><p>Notes, shopping lists, tasks, contractors, rules, safety equipment, muster stations, trips, yard jobs, maintenance logs, discharge logs, waste logs, uniforms, inventory, checklists, crew leave, watch keeping, rest hours, watch duties, Sea Miles, Fuel receipts and transfers. PDFs generate on your device from downloaded records; saved vessel images and signatures remain available offline.</p>
<details><summary>Limits of this test build</summary><p>Download the app and records before disconnecting. Fuel levels show the last confirmed server balance until transfers sync. Only media already downloaded is available; new uploads, folder management and destructive actions require a connection. Plans, billing, invite codes and account management stay online.</p><p>This build uses a synthetic Captain account and local test data. It does not prove the final live installation or every role. The seven-day access limit is implemented and tested; it is not necessary to wait seven days for this trial.</p><p>Keep this Mac and the test process running. After a restart, use the supplied launcher to start a fresh test. Do not enter real customer information or payment details. Browser storage is not a backup.</p></details></section>
</main><script nonce="${nonce}">
const off=document.getElementById('off'),on=document.getElementById('on'),status=document.getElementById('status'),dot=document.getElementById('dot'),message=document.getElementById('message');
let working=false;
async function refresh(){try{const r=await fetch('/state',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();status.textContent=s.online?'Test server connected':'Test server disconnected';dot.className='dot '+(s.online?'online':'offline');off.disabled=working||s.busy||!s.online;on.disabled=working||s.busy||s.online;}catch{status.textContent='Test controls are not running';off.disabled=true;on.disabled=true;}}
async function change(connected){working=true;off.disabled=true;on.disabled=true;message.textContent='Changing test connection…';try{const r=await fetch('/connection',{method:'POST',headers:{'Content-Type':'application/json','X-Offline-Test-Key':'${token}'},body:JSON.stringify({connected})});if(!r.ok)throw Error();message.textContent=connected?'Reconnected. Return to the app and choose Retry Sync if needed.':'Disconnected. Return to the app to add, edit and refresh your saved records.';}catch{message.textContent='Could not change the test connection. Your saved device edits have not been deleted.';}finally{working=false;await refresh();}}
off.onclick=()=>change(false);on.onclick=()=>change(true);refresh();setInterval(refresh,3000);
</script></body></html>`;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    const reply = (code, value) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== new URL(origin).host)
      return reply(403, { error: "Local host required" });
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html());
    }
    if (req.method === "GET" && req.url === "/state")
      return reply(200, { online: isOnline(), busy });
    if (req.method !== "POST" || req.url !== "/connection")
      return reply(404, { error: "Not found" });
    if (
      req.headers.origin !== origin ||
      req.headers["x-offline-test-key"] !== token ||
      req.headers["content-type"] !== "application/json"
    )
      return reply(403, { error: "Use the local controls page" });
    if (busy)
      return reply(409, { error: "A connection change is already running" });
    let body = "";
    try {
      for await (const part of req) {
        body += part;
        if (body.length > 256) return reply(413, { error: "Too large" });
      }
      const input = JSON.parse(body);
      if (
        !input ||
        typeof input.connected !== "boolean" ||
        Object.keys(input).length !== 1
      )
        return reply(400, { error: "Invalid connection request" });
      if (busy)
        return reply(409, { error: "A connection change is already running" });
      busy = true;
      try {
        if (input.connected !== isOnline())
          await (input.connected ? connect() : disconnect());
      } finally {
        busy = false;
      }
      reply(200, { online: isOnline() });
    } catch {
      reply(400, { error: "Connection change failed" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
