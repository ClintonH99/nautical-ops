import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { OfflineError } from "../yachy-app/src/offline/access.ts";
const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const ts = require("typescript");
const source = readFileSync(
  new URL("../yachy-app/src/offline/onlineActions.web.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function fixture(enabled, onLine, disconnected) {
  const alerts = [],
    state = { disconnected },
    exports = {};
  vm.runInNewContext(code, {
    exports,
    navigator: { onLine },
    require(name) {
      if (name === "react-native")
        return {
          Alert: {
            alert(...args) {
              alerts.push(args);
            },
          },
        };
      if (name === "./access") return { OfflineError };
      if (name === "./runtime.web")
        return {
          webOfflineEnabled: enabled,
          useOfflineStatus: { getState: () => state },
        };
      throw Error(name);
    },
  });
  return { api: exports, alerts, state };
}
test("online-only actions block both flight mode and an unreachable server with Wi-Fi enabled", () => {
  for (const [onLine, disconnected] of [
    [false, false],
    [false, true],
    [true, true],
  ]) {
    const f = fixture(true, onLine, disconnected);
    assert.throws(
      () => f.api.requireOnlineAction(),
      (e) => e.code === "ONLINE_ONLY",
    );
    assert.equal(f.api.allowOnlineAction("Deleting records"), false);
    assert.match(f.alerts[0][1], /needs a connection/);
    assert.match(f.alerts[0][1], /saved offline changes are kept/);
  }
});
test("connection recheck stops the action if a sync discovered an outage", () => {
  const f = fixture(true, true, false);
  f.api.requireOnlineAction();
  f.state.disconnected = true;
  assert.throws(
    () => f.api.requireOnlineAction(),
    (e) => e.code === "ONLINE_ONLY",
  );
  f.state.disconnected = false;
  f.api.requireOnlineAction();
  assert.equal(f.alerts.length, 0);
});
test("offline flag disabled preserves the existing native/live behavior", () => {
  const f = fixture(false, false, true);
  f.api.requireOnlineAction();
  assert.equal(f.api.allowOnlineAction(), true);
  assert.equal(f.alerts.length, 0);
});
