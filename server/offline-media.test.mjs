import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { downloadOfflineImage } from "../yachy-app/src/offline/mediaCache.web.ts";

test("offline image cache omits credentials, rejects redirects and retains only bounded raster data", async (t) => {
  const url =
    "https://example.invalid/storage/v1/object/public/vessel-banners/vessel/banner.jpg";
  let options;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    options = init;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });
  });
  const old = globalThis.FileReader;
  globalThis.FileReader = class {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
      this.onload();
    }
  };
  t.after(() => {
    if (old) globalThis.FileReader = old;
    else delete globalThis.FileReader;
  });
  assert.equal(await downloadOfflineImage(url), "data:image/png;base64,AQID");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  for (const response of [
    new Response("<script>", { headers: { "content-type": "text/html" } }),
    new Response("x", {
      headers: {
        "content-type": "image/png",
        "content-length": String(6 * 1024 * 1024),
      },
    }),
    new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
      headers: { "content-type": "image/png" },
    }),
  ]) {
    globalThis.fetch = async () => response;
    await assert.rejects(downloadOfflineImage(url));
  }
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.equal(await downloadOfflineImage(url), null);
  globalThis.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(downloadOfflineImage(url));
});

test("bundled offline PDF engines match pinned checksums and carry licenses", () => {
  const dir = new URL("../yachy-app/public/offline-pdf/", import.meta.url),
    manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
  for (const [file, hash] of Object.entries(manifest.sha256))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(file, dir)))
        .digest("hex"),
      hash,
      file,
    );
  for (const file of ["pdfmake-LICENSE.txt", "html-to-pdfmake-LICENSE.txt"])
    assert.match(
      readFileSync(new URL(file, dir), "utf8"),
      /MIT|Permission is hereby granted/,
    );
});
