import test from "node:test";
import assert from "node:assert/strict";
import { returnOnWeb } from "../yachy-app/src/navigation/webReturn.ts";
function nav(name, routeNames, params, canGoBack = false) {
  const calls = [];
  return {
    calls,
    goBack: () => calls.push(["back"]),
    canGoBack: () => canGoBack,
    getState: () => ({ index: 0, routeNames, routes: [{ name, params }] }),
    navigate: (...args) => calls.push(args),
  };
}
test("reloaded editors return to an available list and normal history remains unchanged", () => {
  const n = nav("AddEditYardJob", [
    "MainTabs",
    "YardPeriodJobs",
    "AddEditYardJob",
  ]);
  returnOnWeb(n);
  assert.deepEqual(n.calls, [["YardPeriodJobs"]]);
  const t = nav("AddEditTrip", ["MainTabs", "BossTrips", "AddEditTrip"], {
    type: "BOSS",
  });
  returnOnWeb(t);
  assert.deepEqual(t.calls, [["BossTrips"]]);
  const h = nav(
    "AddEditYardJob",
    ["MainTabs", "YardPeriodJobs", "AddEditYardJob"],
    undefined,
    true,
  );
  returnOnWeb(h);
  assert.deepEqual(h.calls, [["back"]]);
});
test("reloaded lists return home but restricted stacks cannot enter the app", () => {
  const n = nav("YardPeriodJobs", ["MainTabs", "YardPeriodJobs"]);
  returnOnWeb(n);
  assert.deepEqual(n.calls, [["MainTabs", { screen: "Home" }]]);
  for (const name of ["Login", "VesselPlans"]) {
    const n = nav(name, [name]);
    returnOnWeb(n);
    assert.deepEqual(n.calls, []);
  }
});

test("reloaded Fuel editors return to their own lists", () => {
  for (const [editor, list] of [
    ["AddEditFuelLog", "FuelLog"],
    ["FuelTransfer", "FuelTransfers"],
    ["FuelTankEntry", "FuelInventory"],
  ]) {
    const n = nav(editor, ["MainTabs", editor, list]);
    returnOnWeb(n);
    assert.deepEqual(n.calls, [[list]]);
  }
});
