// Isolated browser verification. No production API, credentials or data.
// Run from the snapshot root. Commands on stdin: offline, online, status, stop.
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";

const root = resolve(import.meta.dirname, ".."),
  app = join(root, "yachy-app");
const dir = mkdtempSync(join(tmpdir(), "nautical-offline-app-"));
const bin = "/opt/homebrew/opt/postgresql@17/bin";
const port = Number(process.env.OFFLINE_APP_CHECK_PORT || 55880),
  origin = `http://127.0.0.1:${port}`;
const user = "00000000-0000-0000-0000-000000000001",
  vessel = "00000000-0000-0000-0000-000000000002",
  session = "00000000-0000-0000-0000-000000000003";
const stamp = new Date().toISOString(),
  end = new Date(Date.now() + 30 * 86400000).toISOString();
const authUser = {
  id: user,
  aud: "authenticated",
  role: "authenticated",
  email: "offline@example.test",
  email_confirmed_at: stamp,
  created_at: stamp,
  updated_at: stamp,
  app_metadata: { provider: "email" },
  user_metadata: {},
};
const profile = {
  ...authUser,
  name: "Offline Test Captain",
  role: "CAPTAIN_MOV",
  vessel_id: vessel,
  department: "BRIDGE",
  position: "Captain",
  vessel_creation_unlocked: true,
};
const subscription = {
  id: vessel,
  vessel_id: vessel,
  status: "active",
  current_period_end: end,
  current_period_start: stamp,
  plan_tier: "1_5",
  billing_period: "monthly",
  created_at: stamp,
  updated_at: stamp,
};
const authSecret = randomBytes(32);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const input =
  b64({ alg: "HS256", typ: "JWT" }) +
  "." +
  b64({
    sub: user,
    aud: "authenticated",
    role: "authenticated",
    session_id: session,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  });
const token =
  input +
  "." +
  createHmac("sha256", authSecret).update(input).digest("base64url");
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const publicKeys = {
  local: await crypto.subtle.exportKey("jwk", pair.publicKey),
};
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const sql = (source) =>
  execFileSync(
    join(bin, "psql"),
    ["-h", dir, "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const run = (source) =>
  sql(
    `SET ROLE authenticated; SET request.jwt.claim.sub='${user}'; SET request.jwt.claim.session_id='${session}';` +
      source,
  )
    .split("\n")
    .at(-1);
let loseNextNoteReply = false;
let server,
  stopped = false,
  databaseStarted = false;
function cleanup() {
  if (stopped) return;
  stopped = true;
  server?.closeAllConnections();
  server?.close();
  if (databaseStarted)
    execFileSync(
      join(bin, "pg_ctl"),
      ["-D", join(dir, "data"), "-m", "fast", "-w", "stop"],
      { stdio: "pipe" },
    );
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
try {
  execFileSync(
    join(bin, "initdb"),
    ["-D", join(dir, "data"), "-A", "trust", "--no-locale"],
    { stdio: "pipe" },
  );
  execFileSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      join(dir, "data"),
      "-l",
      join(dir, "server.log"),
      "-o",
      `-k ${dir} -c listen_addresses=''`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  databaseStarted = true;
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE postgres; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
    CREATE TABLE users(id uuid PRIMARY KEY,vessel_id uuid); CREATE TABLE user_devices(user_id uuid,session_id uuid,device_fingerprint text,revoked_at timestamptz,platform text);
    CREATE TABLE vessel_subscriptions(vessel_id uuid,status text,current_period_end timestamptz,grace_period_end timestamptz);
    CREATE TABLE notes(id uuid PRIMARY KEY,vessel_id uuid,user_id uuid,title text,content text,created_by_name text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.current_user_can_access_vessel(v uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.user_devices d ON d.user_id=u.id WHERE u.id=auth.uid() AND u.vessel_id=v AND d.session_id::text=auth.jwt()->>'session_id' AND d.revoked_at IS NULL)$$;
    CREATE POLICY own_notes ON notes TO authenticated USING(user_id=auth.uid() AND public.current_user_can_access_vessel(vessel_id)) WITH CHECK(user_id=auth.uid() AND public.current_user_can_access_vessel(vessel_id));
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON notes TO authenticated;
    INSERT INTO auth.users VALUES('${user}'); INSERT INTO auth.sessions(id,user_id) VALUES('${session}','${user}'); INSERT INTO users VALUES('${user}','${vessel}');
    INSERT INTO vessel_subscriptions VALUES('${vessel}','active',${quote(end)},null);`);
  sql(
    readFileSync(
      join(app, "supabase/migrations/20261110003026_web_offline_notes.sql"),
      "utf8",
    ),
  );
  const baseline = readFileSync(
    join(
      app,
      "supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql",
    ),
    "utf8",
  );
  sql(
    baseline.match(
      /CREATE TABLE IF NOT EXISTS "public"\."shopping_lists" \([\s\S]*?\n\);/,
    )[0],
  );
  sql(`ALTER TABLE shopping_lists ADD PRIMARY KEY(id); ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
    CREATE POLICY active_shopping ON shopping_lists TO authenticated USING(public.current_user_can_access_vessel(vessel_id)) WITH CHECK(public.current_user_can_access_vessel(vessel_id));
    GRANT SELECT,INSERT,UPDATE,DELETE ON shopping_lists TO authenticated;`);
  sql(
    readFileSync(
      join(app, "supabase/migrations/20261110020000_web_offline_shopping.sql"),
      "utf8",
    ),
  );
  sql(
    baseline.match(
      /CREATE TABLE IF NOT EXISTS "public"\."vessel_tasks" \([\s\S]*?\n\);/,
    )[0],
  );
  sql(`ALTER TABLE vessel_tasks ADD PRIMARY KEY(id); ALTER TABLE vessel_tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY active_tasks ON vessel_tasks TO authenticated USING(public.current_user_can_access_vessel(vessel_id)) WITH CHECK(public.current_user_can_access_vessel(vessel_id));
    GRANT SELECT,INSERT,UPDATE,DELETE ON vessel_tasks TO authenticated;
    CREATE FUNCTION public.current_user_can_manage_vessel(v uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;`);
  sql(
    readFileSync(
      join(app, "supabase/migrations/20260904120000_TASK_RECURRENCE_MODEL.sql"),
      "utf8",
    ),
  );
  const shipyard = readFileSync(
    join(app, "supabase/migrations/20260912120000_ADD_SHIPYARD_RECORDS.sql"),
    "utf8",
  );
  sql(
    shipyard.slice(
      shipyard.indexOf(
        "CREATE OR REPLACE FUNCTION public.enforce_completed_task_unmark_role()",
      ),
      shipyard.indexOf(
        "CREATE OR REPLACE FUNCTION public.unmark_yard_job_complete",
      ),
    ),
  );
  sql(
    readFileSync(
      join(app, "supabase/migrations/20261110030000_web_offline_tasks.sql"),
      "utf8",
    ),
  );
  sql(
    baseline.match(
      /CREATE TABLE IF NOT EXISTS "public"\."contractors" \([\s\S]*?\n\);/,
    )[0],
  );
  sql(`ALTER TABLE contractors ADD PRIMARY KEY(id); ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;
    CREATE POLICY active_contractors ON contractors TO authenticated USING(public.current_user_can_access_vessel(vessel_id)) WITH CHECK(public.current_user_can_access_vessel(vessel_id));
    GRANT SELECT,INSERT,UPDATE,DELETE ON contractors TO authenticated;`);
  sql(
    readFileSync(
      join(
        app,
        "supabase/migrations/20261110040000_web_offline_contractors.sql",
      ),
      "utf8",
    ),
  );
  const env = {
    ...process.env,
    EXPO_NO_DOTENV: "1",
    EXPO_NO_TELEMETRY: "1",
    CI: "1",
    EXPO_PUBLIC_WEB_OFFLINE: "true",
    EXPO_PUBLIC_WEB_OFFLINE_KEYS: JSON.stringify(publicKeys),
    EXPO_PUBLIC_SUPABASE_URL: origin,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "local-synthetic-publishable",
    EXPO_PUBLIC_SENTRY_DSN: "",
    POSTHOG_PROJECT_TOKEN: "",
    POSTHOG_HOST: "",
    SENTRY_AUTH_TOKEN: "",
  };
  for (const key of Object.keys(env)) if (/PADDLE/.test(key)) delete env[key];
  console.log(
    "Building isolated web app. No hosted services or real credentials.",
  );
  const build = spawn(
    process.execPath,
    [
      join(app, "node_modules/expo/bin/cli"),
      "export",
      "--platform",
      "web",
      "--clear",
    ],
    { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const logs = [];
  build.stdout.on("data", (x) => logs.push(x));
  build.stderr.on("data", (x) => logs.push(x));
  const code = await new Promise((resolve) => build.on("exit", resolve));
  writeFileSync(join(dir, "build.log"), Buffer.concat(logs));
  if (code !== 0) throw new Error(`Build failed: ${join(dir, "build.log")}`);
  execFileSync(process.execPath, ["scripts/copy-public-to-dist.mjs"], {
    cwd: app,
    env,
    stdio: "pipe",
  });
  console.log("Build passed. Test-only database and signing key stay local.");
  async function handle(req, res) {
    if (req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403);
      return res.end();
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-src 'none'",
    );
    const url = new URL(req.url, origin),
      path = url.pathname;
    const json = (data, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    let body = {};
    if (req.method === "POST") {
      let text = "";
      for await (const part of req) {
        text += part;
        if (text.length > 300000) return json({ error: "Too large" }, 413);
      }
      body = JSON.parse(text || "{}");
    }
    if (path === "/auth/v1/token") {
      if (
        body.email !== "offline@example.test" ||
        body.password !== "synthetic-offline-check"
      )
        return json({ error: "Invalid synthetic login" }, 401);
      return json({
        access_token: token,
        refresh_token: "local-refresh-only",
        token_type: "bearer",
        expires_in: 86400,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        user: authUser,
      });
    }
    const api = /^\/(auth|rest|functions)\//.test(path);
    if (api && req.headers.authorization !== `Bearer ${token}`)
      return json({ message: "Synthetic session required" }, 401);
    if (path === "/auth/v1/user") return json(authUser);
    if (path === "/rest/v1/rpc/register_user_device") {
      if (!/^[a-f0-9]{64}$/.test(body.p_device_fingerprint))
        return json({ message: "Wrong device" }, 400);
      sql(
        `DELETE FROM user_devices;INSERT INTO user_devices VALUES('${user}','${session}',${quote(body.p_device_fingerprint)},null,'web');`,
      );
      return json({
        allowed: true,
        active_device_count: 1,
        mode: "saved_browsers",
        user_id: user,
        server_time: new Date().toISOString(),
      });
    }
    if (path === "/rest/v1/rpc/get_vessel_subscription_entitlement")
      return json(subscription);
    if (path === "/functions/v1/web-offline-access") {
      const context = JSON.parse(
        run(
          `SELECT get_web_offline_context(${quote(body.vesselId)},${quote(body.deviceId)});`,
        ),
      );
      const claims = {
        ...context,
        sub: user,
        iss: "nautical-ops:127",
        aud: origin,
        projectId: "127",
      };
      const input =
        b64({ alg: "ES256", typ: "nautical-ops-offline+jwt", kid: "local" }) +
        "." +
        b64(claims);
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        new TextEncoder().encode(input),
      );
      return json({
        token: input + "." + Buffer.from(signature).toString("base64url"),
      });
    }
    if (path === "/rest/v1/rpc/read_web_offline_notes")
      return json(
        JSON.parse(
          run(
            `SELECT read_web_offline_notes(${quote(body.p_vessel_id)},${quote(body.p_device_id)});`,
          ),
        ),
      );
    if (path === "/rest/v1/rpc/sync_web_offline_note") {
      const result = JSON.parse(
        run(
          `SELECT sync_web_offline_note(${quote(body.p_vessel_id)},${quote(body.p_device_id)},${quote(JSON.stringify(body.p_operation))}::jsonb);`,
        ),
      );
      if (loseNextNoteReply) {
        loseNextNoteReply = false;
        res.destroy();
        server.closeAllConnections();
        server.close();
        console.log(
          "Synthetic note committed; response lost and HTTP server stopped. Use online to reconnect.",
        );
        return;
      }
      return json(result);
    }
    if (path === "/rest/v1/rpc/read_web_offline_shopping")
      return json(
        JSON.parse(
          run(
            `SELECT read_web_offline_shopping(${quote(body.p_vessel_id)},${quote(body.p_device_id)});`,
          ),
        ),
      );
    if (path === "/rest/v1/rpc/sync_web_offline_shopping")
      return json(
        JSON.parse(
          run(
            `SELECT sync_web_offline_shopping(${quote(body.p_vessel_id)},${quote(body.p_device_id)},${quote(JSON.stringify(body.p_operation))}::jsonb);`,
          ),
        ),
      );
    if (path === "/rest/v1/rpc/read_web_offline_tasks")
      return json(
        JSON.parse(
          run(
            `SELECT read_web_offline_tasks(${quote(body.p_vessel_id)},${quote(body.p_device_id)});`,
          ),
        ),
      );
    if (path === "/rest/v1/rpc/sync_web_offline_task")
      return json(
        JSON.parse(
          run(
            `SELECT sync_web_offline_task(${quote(body.p_vessel_id)},${quote(body.p_device_id)},${quote(JSON.stringify(body.p_operation))}::jsonb);`,
          ),
        ),
      );
    if (path === "/rest/v1/rpc/read_web_offline_contractors")
      return json(
        JSON.parse(
          run(
            `SELECT read_web_offline_contractors(${quote(body.p_vessel_id)},${quote(body.p_device_id)});`,
          ),
        ),
      );
    if (path === "/rest/v1/rpc/sync_web_offline_contractor")
      return json(
        JSON.parse(
          run(
            `SELECT sync_web_offline_contractor(${quote(body.p_vessel_id)},${quote(body.p_device_id)},${quote(JSON.stringify(body.p_operation))}::jsonb);`,
          ),
        ),
      );
    if (path === "/rest/v1/users")
      return json(url.searchParams.has("id") ? profile : [profile]);
    if (path === "/rest/v1/vessels")
      return json({
        id: vessel,
        name: "Synthetic Offline Vessel",
        created_at: stamp,
        updated_at: stamp,
        is_solo: false,
      });
    if (path === "/rest/v1/vessel_subscriptions") return json(subscription);
    if (
      /^\/rest\/v1\/(notifications|inventory_items|trips|vessel_tasks|crew_leave|maintenance_logs|user_departments|vessel_departures|vessel_departure|fuel_logs|rest_entries)$/.test(
        path,
      ) &&
      req.method === "GET"
    )
      return json([]);
    if (
      path.startsWith("/rest/") ||
      path.startsWith("/functions/") ||
      path.startsWith("/auth/")
    ) {
      console.log("Unimplemented test endpoint:", req.method, path);
      return json({ message: "Outside this synthetic check" }, 404);
    }
    if (req.method !== "GET")
      return json({ message: "Method not allowed" }, 405);
    let file = resolve(app, "dist", "." + decodeURIComponent(path));
    if (!file.startsWith(join(app, "dist") + "/"))
      file = join(app, "dist/index.html");
    if (!existsSync(file) || !extname(file))
      file = join(app, "dist/index.html");
    if (
      ![
        ".html",
        ".js",
        ".css",
        ".png",
        ".jpg",
        ".jpeg",
        ".svg",
        ".webp",
        ".ttf",
        ".woff",
        ".woff2",
        ".ico",
      ].includes(extname(file))
    )
      return json({ message: "Not served" }, 404);
    const mime = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ttf": "font/ttf",
      ".woff2": "font/woff2",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
    };
    if (path === "/offline-worker.js")
      res.setHeader("Service-Worker-Allowed", "/");
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
    });
    res.end(readFileSync(file));
  }
  const online = () =>
    new Promise((resolve) => {
      server = createServer((req, res) =>
        handle(req, res).catch(() => {
          if (!res.headersSent)
            res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Synthetic request failed" }));
        }),
      );
      server.listen(port, "127.0.0.1", resolve);
    });
  await online();
  console.log(
    `READY ${origin}/login | Login: offline@example.test / synthetic-offline-check`,
  );
  console.log(
    `Evidence directory: ${dir}. Commands: offline, online, change-online-note, status, stop`,
  );
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (line === "lose-next-reply") {
      loseNextNoteReply = true;
      console.log(
        "Next synthetic note reply will be lost after the database commit.",
      );
    }
    if (line === "offline") {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      console.log("OFFLINE — local HTTP server stopped; database retained.");
    }
    if (line === "online") {
      await online();
      console.log("ONLINE — same database, port and test signing key.");
    }
    if (line === "change-online-note") {
      sql(
        "UPDATE notes SET content='A different device edited this synthetic note.',updated_at=clock_timestamp();",
      );
      console.log("Synthetic online note changed for conflict check.");
    }
    if (line === "status") {
      const report = JSON.parse(
        sql(
          "SELECT json_build_object('notes',coalesce((SELECT json_agg(n) FROM notes n),'[]'),'shoppingLists',coalesce((SELECT json_agg(s) FROM shopping_lists s),'[]'),'tasks',coalesce((SELECT json_agg(t) FROM vessel_tasks t),'[]'),'contractors',coalesce((SELECT json_agg(c) FROM contractors c),'[]'),'receipts',(SELECT count(*) FROM offline_private.note_receipts)+(SELECT count(*) FROM offline_private.record_receipts));",
        ),
      );
      writeFileSync(join(dir, "result.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    }
    if (line === "stop") break;
  }
} finally {
  cleanup();
}
