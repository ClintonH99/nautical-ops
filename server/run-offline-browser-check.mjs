// Run from the repository root. Loopback-only, allowlisted synthetic test assets.
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const compiled = await mkdtemp(join(tmpdir(), "nautical-offline-browser-"));
execFileSync(
  join(root, "yachy-app/node_modules/.bin/tsc"),
  [
    "--ignoreConfig",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--rewriteRelativeImportExtensions",
    "--lib",
    "ES2022,DOM",
    "--skipLibCheck",
    "--outDir",
    compiled,
    ...["access.ts", "outbox.ts", "indexedDb.web.ts"].map((name) =>
      join(root, "yachy-app/src/offline", name),
    ),
  ],
  { stdio: "inherit" },
);
const assets = new Map();
assets.set("/", {
  type: "text/html",
  data: await readFile(join(root, "server/offline-browser-harness.html")),
});
for (const name of [
  "access.js",
  "outbox.js",
  "indexedDb.web.js",
  "recovery.js",
])
  assets.set("/" + name, {
    type: "text/javascript",
    data: await readFile(join(compiled, name)),
  });
const server = createServer((req, res) => {
  const asset = assets.get(new URL(req.url, "http://localhost").pathname);
  if (req.method !== "GET" || !asset) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": asset.type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(asset.data);
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    `Synthetic browser checks: http://127.0.0.1:${server.address().port}`,
  ),
);
