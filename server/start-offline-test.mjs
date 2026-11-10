// Local user-test launcher. No cloud calls, credentials or production changes.
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const stateDir = join(tmpdir(), "nautical-offline-fuel-pdf-test");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const origin = "http://127.0.0.1:55913";
try {
  const response = await fetch(origin + "/state", {
    signal: AbortSignal.timeout(2000),
  });
  if (response.ok && typeof (await response.json()).online === "boolean") {
    console.log(`Offline test is running: ${origin}`);
    process.exit(0);
  }
} catch {}
const pidPath = join(stateDir, "pid");
if (existsSync(pidPath)) {
  const pid = Number(readFileSync(pidPath, "utf8"));
  try {
    process.kill(pid, 0);
    console.log(
      `Offline test is still starting. Open ${origin} shortly. Log: ${join(stateDir, "run.log")}`,
    );
    process.exit(0);
  } catch {}
}
const lock = join(stateDir, "starting");
try {
  mkdirSync(lock);
} catch {
  throw Error(`Another test launch is in progress. See ${stateDir}`);
}
try {
  // A fresh origin isolates each new disposable test vessel from prior browser data.
  const socket = createServer();
  await new Promise((done, fail) => {
    socket.once("error", fail);
    socket.listen(0, "127.0.0.1", done);
  });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  const log = openSync(join(stateDir, "run.log"), "w", 0o600);
  const child = spawn(
    process.execPath,
    [join(root, "server/offline-app-check.mjs")],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        OFFLINE_APP_CHECK_PORT: String(port),
        OFFLINE_TEST_CONTROLS_PORT: "55913",
      },
    },
  );
  child.unref();
  closeSync(log);
  writeFileSync(pidPath, String(child.pid), { mode: 0o600 });
  console.log(
    `Building your separate offline test app. Open ${origin} when ready.`,
  );
  console.log(`Startup log: ${join(stateDir, "run.log")}`);
} finally {
  rmSync(lock, { recursive: true });
}
