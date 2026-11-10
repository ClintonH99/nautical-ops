import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const template = await readFile(
  new URL(
    "../yachy-app/src/offline/service-worker.template.js",
    import.meta.url,
  ),
  "utf8",
);
function fixture() {
  const listeners = {};
  const entries = new Map([
    ["/index.html", new Response("synthetic app shell")],
    ["/_expo/app.js", new Response("synthetic code")],
  ]);
  const cache = {
    match: async (key) => entries.get(key)?.clone(),
    addAll: async () => {},
  };
  const self = {
    location: { origin: "https://offline.example" },
    clients: { claim: async () => {} },
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
  };
  vm.runInNewContext(
    template
      .replace("__OFFLINE_BUILD__", '"test"')
      .replace("__OFFLINE_ASSETS__", '["/index.html","/_expo/app.js"]'),
    {
      self,
      Set,
      URL,
      Request,
      Response,
      caches: { open: async () => cache, keys: async () => [] },
      fetch: async () => {
        throw Error("network disconnected");
      },
    },
  );
  function request(path, { method = "GET", mode = "navigate" } = {}) {
    let result = null;
    listeners.fetch({
      request: { url: new URL(path, self.location.origin).href, method, mode },
      respondWith: (value) => {
        result = value;
      },
    });
    return result;
  }
  return { request };
}
test("normal app route reload has cached shell while offline", async () => {
  const f = fixture();
  assert.equal(
    await (await f.request("/notepad")).text(),
    "synthetic app shell",
  );
});
for (const path of [
  "/",
  "/pre-departure/view?checklistId=00000000-0000-0000-0000-000000000001",
  "/pre-departure/edit?tripId=00000000-0000-0000-0000-000000000001",
  "/shopping/list?listType=trip",
  "/rules/create?ruleId=00000000-0000-0000-0000-000000000001",
  "/safety/equipment/create?equipmentId=00000000-0000-0000-0000-000000000001",
  "/safety/muster/create?musterStationId=00000000-0000-0000-0000-000000000001",
  "/trips/edit?type=GUEST",
  "/trips/edit?type=DELIVERY&tripId=00000000-0000-0000-0000-000000000001",
  "/tasks/list?category=WEEKLY",
  "/contractors/edit?contractorId=00000000-0000-0000-0000-000000000001",
  "/tasks/edit?category=DAILY&taskId=00000000-0000-0000-0000-000000000001",
  "/shopping/edit?listType=trip&asMasterList=true",
  "/shopping/edit?listId=00000000-0000-0000-0000-000000000001",
]) {
  test("approved offline route " + path, async () =>
    assert.equal(
      await (await fixture().request(path)).text(),
      "synthetic app shell",
    ),
  );
}
for (const path of [
  "/pre-departure/edit?tripId=invalid",
  "/pre-departure/view?checklistId=00000000-0000-0000-0000-000000000001&token=private",
  "/shopping/edit?token=private",
  "/tasks/edit?category=WEEKLY&category=DAILY",
  "/rules/create?ruleId=invalid",
  "/rules/create?ruleId=00000000-0000-0000-0000-000000000001&token=private",
  "/safety/muster/create?equipmentId=00000000-0000-0000-0000-000000000001",
  "/trips/edit?type=GUEST&type=BOSS",
  "/trips/edit?type=GUEST&token=private",
  "/trips/edit?tripId=invalid",
  "/tasks/edit?taskId=invalid",
  "/contractors/edit?contractorId=invalid",
  "/contractors/edit?contractorId=00000000-0000-0000-0000-000000000001&token=private",
  "/tasks/list?category=DAILY&token=private",
  "/shopping/list?listType=trip&listType=general",
  "/?token=private",
]) {
  test("unapproved offline query " + path, () =>
    assert.equal(fixture().request(path), null),
  );
}
test("a note editor with one valid record ID can reload offline", async () => {
  assert.equal(
    await (
      await fixture().request(
        "/notepad/edit?noteId=00000000-0000-0000-0000-000000000001",
      )
    ).text(),
    "synthetic app shell",
  );
});
for (const query of [
  "noteId=invalid",
  "noteId=00000000-0000-0000-0000-000000000001&token=private",
  "noteId=00000000-0000-0000-0000-000000000001&noteId=00000000-0000-0000-0000-000000000002",
]) {
  test("editor rejects unapproved query " + query, () =>
    assert.equal(fixture().request("/notepad/edit?" + query), null),
  );
}
for (const path of [
  "/vessel-plans",
  "/checkout",
  "/settings/devices",
  "/join-vessel",
  "/api/export-pdf",
  "/login",
  "/app?crewInvite=ready",
  "https://example.com/app",
]) {
  test(`never intercepts sensitive route ${path}`, () =>
    assert.equal(fixture().request(path), null));
}
test("POST never cached or queued by service worker", () =>
  assert.equal(fixture().request("/notepad", { method: "POST" }), null));
test("only explicitly listed static assets are cached", async () => {
  const f = fixture();
  assert.equal(
    await (await f.request("/_expo/app.js", { mode: "cors" })).text(),
    "synthetic code",
  );
  assert.equal(f.request("/private-user-data.json", { mode: "cors" }), null);
});

// Prevent named navigation and a reopened URL disagreeing on offline support.
test('implemented screen names and reopened paths share one offline route map',async()=>{
 const {OFFLINE_ROUTE_PATHS,supportsOfflineRoute}=await import('../yachy-app/src/offline/routes.ts');
 const linking=await readFile(new URL('../yachy-app/src/navigation/webLinking.ts',import.meta.url),'utf8');
 for(const [name,path] of Object.entries(OFFLINE_ROUTE_PATHS)) {
   assert.ok(linking.includes(`${name}: '${path.slice(1)}'`),name);
   assert.equal(supportsOfflineRoute(name,path),true);
   assert.equal(supportsOfflineRoute(null,path),true);
 }
 for(const [name,path] of [['VesselPlans','/vessel-plans'],['VesselSettings','/vessel-settings'],['CrewManagement','/crew'],['Login','/login']]) {
   assert.equal(supportsOfflineRoute(name,path),false);
   assert.equal(supportsOfflineRoute(null,path),false);
 }
});
