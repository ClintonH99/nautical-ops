import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startOfflineTestControls } from "./offline-test-controls.mjs";

test("local controls stop/restart only their test server and reject cross-site requests", async () => {
  let online = true,
    connects = 0,
    disconnects = 0;
  const control = await startOfflineTestControls({
    port: 0,
    appOrigin: "http://127.0.0.1:55910",
    isOnline: () => online,
    connect: async () => {
      online = true;
      connects++;
    },
    disconnect: async () => {
      online = false;
      disconnects++;
    },
  });
  try {
    const page = await fetch(control.origin);
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    const html = await page.text(),
      token = html.match(/'X-Offline-Test-Key':'([a-f0-9]+)'/)[1];
    const post = (body, headers = {}) =>
      fetch(control.origin + "/connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Offline-Test-Key": token,
          Origin: control.origin,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await post(
          { connected: false },
          { Origin: "https://unrelated.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await post({ connected: false }, { "X-Offline-Test-Key": "wrong" }))
        .status,
      403,
    );
    assert.equal((await fetch(control.origin + "/connection")).status, 404);
    const hostileHost = await new Promise((resolve, reject) => {
      const req = request(
        control.origin,
        { headers: { Host: "unrelated.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostileHost, 403);
    assert.equal(disconnects, 0);
    assert.equal(
      (await post({ connected: false, command: "anything" })).status,
      400,
    );
    assert.equal((await post({ connected: false })).status, 200);
    assert.deepEqual(await (await fetch(control.origin + "/state")).json(), {
      online: false,
      busy: false,
    });
    await post({ connected: false });
    assert.equal(disconnects, 1);
    await post({ connected: true });
    assert.equal(connects, 1);
    assert.equal(online, true);
  } finally {
    await control.close();
  }
});
test("test controls reject a remotely hosted app", async () => {
  await assert.rejects(
    startOfflineTestControls({
      port: 0,
      appOrigin: "https://www.nautical-ops.com",
      isOnline: () => true,
    }),
    /loopback/,
  );
});
