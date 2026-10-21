import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const manifest = require("./package.json");
const lock = JSON.parse(
  fs.readFileSync(
    new URL("../yachy-app/package-lock.json", import.meta.url),
    "utf8",
  ),
);

test("retired native build and tunnel tooling stays out of the web installation", () => {
  for (const name of ["eas-cli", "@expo/ngrok", "diff", "ts-deepmerge"]) {
    assert.equal(manifest.devDependencies[name], undefined);
  }
  assert.equal(
    Object.keys(lock.packages).some((name) =>
      /(?:^|\/)node_modules\/(?:eas-cli|@expo\/ngrok|ts-deepmerge)$/.test(name),
    ),
    false,
  );
  assert.equal(
    Object.values(manifest.scripts).some((script) =>
      /^eas |--tunnel/.test(script),
    ),
    false,
  );
});

test("the retained Expo config dependency resolves the patched UUID without breaking ID generation", () => {
  const xcodeRequire = createRequire(require.resolve("xcode"));
  const uuidVersion = xcodeRequire("uuid/package.json").version;
  assert.equal(uuidVersion, "11.1.1");
  const project = require("xcode").project("nonexistent-test-project.pbxproj");
  project.hash = { project: { objects: {} } };
  const id = project.generateUuid();
  assert.match(id, /^[A-F0-9]{24}$/);
  const vulnerable = Object.entries(lock.packages).filter(
    ([name, entry]) => name.endsWith("/uuid") && entry.version !== "11.1.1",
  );
  assert.deepEqual(vulnerable, []);
});
