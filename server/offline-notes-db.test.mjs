import { installInventory } from "./offline-inventory-fixture.mjs";
import { installVesselRecords } from "./offline-vessel-records-fixture.mjs";
import { installMaintenance } from "./offline-maintenance-fixture.mjs";
import { installYard } from "./offline-yard-fixture.mjs";
import test from "node:test";
import { installTrips } from "./offline-trips-fixture.mjs";
import { installPublications } from "./offline-publications-fixture.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const bin =
  process.env.OFFLINE_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
test("real isolated PostgreSQL offline note protocol", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nautical-offline-db-"));
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
  const sql = (source) =>
    execFileSync(
      join(bin, "psql"),
      ["-h", dir, "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
      { input: source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  const user = "00000000-0000-0000-0000-000000000001",
    vessel = "00000000-0000-0000-0000-000000000002",
    session = "00000000-0000-0000-0000-000000000003",
    note = "00000000-0000-0000-0000-000000000004";
  const device = "a".repeat(64);
  const auth = `SET ROLE authenticated; SET request.jwt.claim.sub='${user}'; SET request.jwt.claim.session_id='${session}';`;
  const run = (source) =>
    sql(auth + source)
      .split("\n")
      .at(-1);
  const value = {
    id: note,
    vessel_id: vessel,
    user_id: user,
    title: "At sea",
    content: "Saved offline",
    created_by_name: "Synthetic captain",
    created_at: "2026-11-09T00:00:00Z",
    updated_at: "2026-11-09T00:00:00Z",
  };
  const op = {
    id: "00000000-0000-0000-0000-000000000005",
    recordId: note,
    kind: "create",
    feature: "notes",
    value,
    baseRevision: null,
  };
  const apply = (x) =>
    `SELECT public.sync_web_offline_note('${vessel}','${device}','${JSON.stringify(x).replaceAll("'", "''")}'::jsonb);`;
  try {
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE postgres; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
      CREATE TABLE users(id uuid PRIMARY KEY,vessel_id uuid);
      CREATE TABLE user_devices(user_id uuid,session_id uuid,device_fingerprint text,revoked_at timestamptz,platform text);
      CREATE TABLE vessel_subscriptions(vessel_id uuid,status text,current_period_end timestamptz,grace_period_end timestamptz);
      CREATE TABLE notes(id uuid PRIMARY KEY,vessel_id uuid,user_id uuid,title text,content text,created_by_name text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.current_user_can_access_vessel(v uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.user_devices d ON d.user_id=u.id WHERE u.id=auth.uid() AND u.vessel_id=v AND d.session_id::text=auth.jwt()->>'session_id' AND d.revoked_at IS NULL)$$;
      CREATE POLICY own_notes ON notes TO authenticated USING(user_id=auth.uid() AND public.current_user_can_access_vessel(vessel_id)) WITH CHECK(user_id=auth.uid() AND public.current_user_can_access_vessel(vessel_id));
      GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON notes TO authenticated;
      INSERT INTO auth.users VALUES('${user}'); INSERT INTO auth.sessions(id,user_id) VALUES('${session}','${user}'); INSERT INTO users VALUES('${user}','${vessel}');
      INSERT INTO user_devices VALUES('${user}','${session}','${device}',null,'web');
      INSERT INTO vessel_subscriptions VALUES('${vessel}','trialing',now()+interval '30 days',null);`);
    sql(
      readFileSync(
        new URL(
          "../yachy-app/supabase/migrations/20261110003026_web_offline_notes.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const baseline = readFileSync(
      new URL(
        "../yachy-app/supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql",
        import.meta.url,
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
        new URL(
          "../yachy-app/supabase/migrations/20261110020000_web_offline_shopping.sql",
          import.meta.url,
        ),
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
    const migration = (name) =>
      readFileSync(
        new URL("../yachy-app/supabase/migrations/" + name, import.meta.url),
        "utf8",
      );
    sql(migration("20260904120000_TASK_RECURRENCE_MODEL.sql"));
    const shipyard = migration("20260912120000_ADD_SHIPYARD_RECORDS.sql");
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
    sql(migration("20261110030000_web_offline_tasks.sql"));
    await t.test(
      "offline task create/edit/complete retries and current RLS",
      () => {
        const value = {
          id: crypto.randomUUID(),
          vessel_id: vessel,
          category: "WEEKLY",
          department: "INTERIOR",
          title: "Inspect lines",
          notes: null,
          done_by_date: "2026-11-09",
          recurring: "7_DAYS",
          status: "NOT_STARTED",
          created_by: user,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_by: null,
          completed_at: null,
          completed_by_name: null,
        };
        const call = (op) =>
          JSON.parse(
            run(
              `SELECT sync_web_offline_task('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
            ),
          );
        const create = {
          id: crypto.randomUUID(),
          recordId: value.id,
          feature: "tasks",
          kind: "create",
          value,
          baseRevision: null,
        };
        const first = call(create);
        assert.equal(first.status, "applied");
        assert.deepEqual(call(create), first);
        const advance = {
          ...create,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: first.revision,
          value: { ...first.value, done_by_date: "2026-11-16" },
        };
        const advanced = call(advance);
        assert.equal(advanced.status, "applied");
        assert.equal(call(advance).value.done_by_date, "2026-11-16");
        assert.equal(
          call({
            ...advance,
            id: crypto.randomUUID(),
            value: { ...advance.value, title: "Stale edit" },
          }).status,
          "conflict",
        );
        assert.throws(() =>
          call({
            ...advance,
            id: crypto.randomUUID(),
            baseRevision: advanced.revision,
            value: { ...advanced.value, created_by: vessel },
          }),
        );
        assert.throws(() =>
          call({
            ...advance,
            id: crypto.randomUUID(),
            baseRevision: advanced.revision,
            value: { ...advanced.value, recurring: null },
          }),
        );
        const complete = {
          ...advance,
          id: crypto.randomUUID(),
          baseRevision: advanced.revision,
          value: {
            ...advanced.value,
            status: "COMPLETED",
            completed_by: user,
            completed_at: new Date().toISOString(),
            completed_by_name: "Synthetic crew",
          },
        };
        const completed = call(complete);
        assert.equal(completed.status, "applied");
        assert.throws(() =>
          call({
            ...complete,
            id: crypto.randomUUID(),
            baseRevision: completed.revision,
            value: {
              ...completed.value,
              status: "NOT_STARTED",
              completed_by: null,
              completed_at: null,
              completed_by_name: null,
            },
          }),
        );
        // Create then complete before first upload coalesces into one permitted create.
        const localId = crypto.randomUUID();
        const coalesced = {
          ...create,
          id: crypto.randomUUID(),
          recordId: localId,
          value: { ...complete.value, id: localId },
        };
        assert.equal(call(coalesced).status, "applied");
        sql(
          "DROP POLICY active_tasks ON vessel_tasks; CREATE POLICY read_tasks ON vessel_tasks FOR SELECT TO authenticated USING(public.current_user_can_access_vessel(vessel_id));",
        );
        assert.equal(
          call({
            ...advance,
            id: crypto.randomUUID(),
            baseRevision: completed.revision,
            value: { ...completed.value, title: "Denied edit" },
          }).status,
          "forbidden",
        );
        assert.equal(
          sql(`SELECT title FROM vessel_tasks WHERE id='${value.id}';`),
          "Inspect lines",
        );
        sql("DROP POLICY read_tasks ON vessel_tasks;");
        assert.deepEqual(
          JSON.parse(
            run(`SELECT read_web_offline_tasks('${vessel}','${device}');`),
          ),
          [],
        );
      },
    );
    sql(
      baseline.match(
        /CREATE TABLE IF NOT EXISTS "public"\."contractors" \([\s\S]*?\n\);/,
      )[0],
    );
    sql(`ALTER TABLE contractors ADD PRIMARY KEY(id); ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;
      CREATE POLICY active_contractors ON contractors TO authenticated USING(public.current_user_can_access_vessel(vessel_id)) WITH CHECK(public.current_user_can_access_vessel(vessel_id));
      GRANT SELECT,INSERT,UPDATE,DELETE ON contractors TO authenticated;`);
    sql(migration("20261110040000_web_offline_contractors.sql"));
    await t.test(
      "contractor contact edits are revisioned, idempotent and restricted by RLS",
      () => {
        const value = {
          id: crypto.randomUUID(),
          vessel_id: vessel,
          department: "BRIDGE",
          company_name: "Synthetic Marine",
          company_address: null,
          known_for: "Rigging",
          description: null,
          contacts: [
            {
              name: "Synthetic person",
              mobile: "",
              email: "synthetic@example.test",
            },
          ],
          created_by: user,
          created_at: new Date().toISOString(),
        };
        const op = {
          id: crypto.randomUUID(),
          recordId: value.id,
          feature: "contractors",
          kind: "create",
          value,
          baseRevision: null,
        };
        const call = (x) =>
          JSON.parse(
            run(
              `SELECT sync_web_offline_contractor('${vessel}','${device}','${JSON.stringify(x).replaceAll("'", "''")}'::jsonb);`,
            ),
          );
        const first = call(op);
        assert.equal(first.status, "applied");
        assert.deepEqual(call(op), first);
        const edit = {
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: first.revision,
          value: {
            ...first.value,
            contacts: [
              {
                name: "Updated synthetic person",
                mobile: "",
                email: "changed@example.test",
              },
            ],
          },
        };
        const updated = call(edit);
        assert.equal(updated.status, "applied");
        assert.equal(
          updated.value.contacts[0].name,
          "Updated synthetic person",
        );
        assert.equal(
          call({ ...edit, id: crypto.randomUUID() }).status,
          "conflict",
        );
        assert.throws(() =>
          call({
            ...edit,
            id: crypto.randomUUID(),
            baseRevision: updated.revision,
            value: {
              ...updated.value,
              contacts: [
                { name: "Hidden", mobile: "", email: "", secret: "bad" },
              ],
            },
          }),
        );
        assert.throws(() =>
          call({
            ...edit,
            id: crypto.randomUUID(),
            baseRevision: updated.revision,
            value: { ...updated.value, created_by: vessel },
          }),
        );
        sql(
          "DROP POLICY active_contractors ON contractors; CREATE POLICY read_contractors ON contractors FOR SELECT TO authenticated USING(public.current_user_can_access_vessel(vessel_id));",
        );
        assert.equal(
          call({
            ...edit,
            id: crypto.randomUUID(),
            baseRevision: updated.revision,
            value: { ...updated.value, company_name: "Denied change" },
          }).status,
          "forbidden",
        );
        sql("DROP POLICY read_contractors ON contractors;");
        assert.deepEqual(
          JSON.parse(
            run(
              `SELECT read_web_offline_contractors('${vessel}','${device}');`,
            ),
          ),
          [],
        );
      },
    );
    installPublications(sql, baseline, migration);
    await t.test(
      "publication roles, revisions, retries and downgrade enforcement",
      () => {
        const context = () =>
          JSON.parse(
            run(`SELECT get_web_offline_context('${vessel}','${device}');`),
          ).permissions;
        assert.deepEqual(context().rules, ["read"]);
        assert.deepEqual(context().musterStations, ["read"]);
        assert.deepEqual(context().safetyEquipment, [
          "read",
          "create",
          "update",
        ]);
        for (const [feature, table] of [
          ["rules", "rules"],
          ["safetyEquipment", "safety_equipment"],
          ["musterStations", "muster_stations"],
        ]) {
          const value = {
            id: crypto.randomUUID(),
            vessel_id: vessel,
            title: "Synthetic publication",
            data: { title: "Synthetic publication", rules: ["Wear shoes"] },
            created_by: user,
            created_at: "2026-11-09T00:00:00Z",
          };
          const operation = {
            id: crypto.randomUUID(),
            recordId: value.id,
            feature,
            kind: "create",
            value,
            baseRevision: null,
          };
          const request = (op) =>
            `SELECT sync_web_offline_${table}('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`;
          if (feature !== "safetyEquipment")
            assert.throws(() => run(request(operation)));
          sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
          const first = JSON.parse(run(request(operation)));
          assert.equal(first.status, "applied");
          assert.deepEqual(JSON.parse(run(request(operation))), first);
          const changed = {
            ...operation,
            id: crypto.randomUUID(),
            kind: "update",
            baseRevision: first.revision,
            value: { ...first.value, title: "Changed on device" },
          };
          const second = JSON.parse(run(request(changed)));
          assert.equal(second.status, "applied");
          assert.equal(
            JSON.parse(run(request({ ...changed, id: crypto.randomUUID() })))
              .status,
            "conflict",
          );
          assert.throws(() =>
            run(
              request({
                ...changed,
                value: { ...changed.value, title: "Reused ID" },
              }),
            ),
          );
          sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
          assert.equal(
            JSON.parse(
              run(`SELECT read_web_offline_${table}('${vessel}','${device}');`),
            ).length,
            1,
          );
          const downgrade = {
            ...changed,
            id: crypto.randomUUID(),
            baseRevision: second.revision,
            value: { ...second.value, title: "Crew edit" },
          };
          if (feature === "safetyEquipment")
            assert.equal(JSON.parse(run(request(downgrade))).status, "applied");
          else {
            assert.equal(
              JSON.parse(run(request(downgrade))).status,
              "forbidden",
            );
            assert.equal(
              sql(`SELECT title FROM ${table} WHERE id='${value.id}';`),
              "Changed on device",
            );
          }
          // No receipt may be created by a denied operation.
          assert.equal(
            sql(
              `SELECT count(*) FROM offline_private.record_receipts WHERE operation_id='${downgrade.id}';`,
            ),
            feature === "safetyEquipment" ? "1" : "0",
          );
          assert.throws(() =>
            run(
              request({
                ...operation,
                id: crypto.randomUUID(),
                recordId: crypto.randomUUID(),
                value: { ...value, vessel_id: crypto.randomUUID() },
              }),
            ),
          );
        }
      },
    );
    installTrips(sql, baseline, migration);
    await t.test(
      "trip dates, immutable type, atomic retry and current policy enforcement",
      () => {
        const value = {
          id: crypto.randomUUID(),
          vessel_id: vessel,
          type: "GUEST",
          title: "Offline crossing",
          start_date: "2026-11-09",
          end_date: "2026-11-12",
          notes: "Initial",
          department: null,
          yard_location: null,
          contractor_company_name: null,
          contact_details: null,
          created_by: user,
          created_at: "2026-11-09T00:00:00Z",
          updated_at: "2026-11-09T00:00:00Z",
        };
        const operation = {
          id: crypto.randomUUID(),
          recordId: value.id,
          feature: "trips",
          kind: "create",
          value,
          baseRevision: null,
        };
        const request = (op) =>
          `SELECT sync_web_offline_trip('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`;
        const first = JSON.parse(run(request(operation)));
        assert.equal(first.status, "applied");
        assert.deepEqual(JSON.parse(run(request(operation))), first);
        const update = {
          ...operation,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: first.revision,
          value: { ...first.value, notes: null, end_date: "2026-11-14" },
        };
        const second = JSON.parse(run(request(update)));
        assert.equal(second.status, "applied");
        assert.equal(second.value.notes, null);
        assert.equal(
          JSON.parse(run(request({ ...update, id: crypto.randomUUID() })))
            .status,
          "conflict",
        );
        assert.throws(() =>
          run(
            request({
              ...update,
              id: crypto.randomUUID(),
              baseRevision: second.revision,
              value: { ...second.value, type: "BOSS" },
            }),
          ),
        );
        for (const dates of [
          { start_date: "2026-11-20", end_date: "2026-11-14" },
          { start_date: "2026-02-30", end_date: "2026-11-14" },
        ]) {
          const id = crypto.randomUUID();
          assert.throws(() =>
            run(
              request({
                ...operation,
                id: crypto.randomUUID(),
                recordId: id,
                value: { ...value, ...dates, id },
              }),
            ),
          );
        }
        sql(`DROP POLICY "Active vessel members can manage trips" ON trips;
        CREATE POLICY trips_read ON trips FOR SELECT TO authenticated USING(public.current_user_can_access_vessel(vessel_id));`);
        assert.equal(
          JSON.parse(
            run(
              request({
                ...update,
                id: crypto.randomUUID(),
                baseRevision: second.revision,
              }),
            ),
          ).status,
          "forbidden",
        );
        assert.equal(
          sql(
            "SELECT count(*) FROM offline_private.record_receipts WHERE feature='trips';",
          ),
          "2",
        );
        assert.equal(sql("SELECT count(*) FROM trips;"), "1");
        sql("DROP POLICY trips_read ON trips;");
        assert.deepEqual(
          JSON.parse(
            run(`SELECT read_web_offline_trips('${vessel}','${device}');`),
          ),
          [],
        );
      },
    );
    installYard(sql, baseline, migration);
    await t.test(
      "yard completion identity, Captain-only record edits, retries and folder scope",
      () => {
        sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
        const value = {
          id: crypto.randomUUID(),
          vessel_id: vessel,
          job_title: "Check passerelle",
          job_description: null,
          yard_location: null,
          contractor_company_name: null,
          contact_details: null,
          done_by_date: null,
          status: "NOT_STARTED",
          completed_by: null,
          completed_at: null,
          completed_by_name: null,
          created_by: user,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          department: "BRIDGE",
          priority: "GREEN",
          trip_id: null,
          defect_details: null,
          defect_location: null,
          equipment_serial: null,
          start_date: "2026-11-10",
          end_date: "2026-11-12",
        };
        const op = {
          id: crypto.randomUUID(),
          recordId: value.id,
          feature: "yardJobs",
          kind: "create",
          value,
          baseRevision: null,
        };
        const request = (op) =>
          `SELECT sync_web_offline_yard_job('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`;
        const call = (op) => JSON.parse(run(request(op)));
        const first = call(op);
        assert.equal(first.status, "applied");
        assert.deepEqual(call(op), first);
        const complete = {
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: first.revision,
          value: {
            ...first.value,
            status: "COMPLETED",
            completed_by: user,
            completed_at: new Date().toISOString(),
            completed_by_name: "Synthetic crew",
          },
        };
        assert.throws(() =>
          call({
            ...complete,
            value: { ...complete.value, completed_by: crypto.randomUUID() },
          }),
        );
        const done = call(complete);
        assert.equal(done.status, "applied");
        assert.deepEqual(call(complete), done);
        const change = {
          ...complete,
          id: crypto.randomUUID(),
          baseRevision: done.revision,
          value: { ...done.value, job_title: "Captain correction" },
        };
        assert.throws(() => call(change));
        sql(`UPDATE users SET role='HOD' WHERE id='${user}';`);
        assert.throws(() => call(change));
        sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
        const corrected = call(change);
        assert.equal(corrected.status, "applied");
        assert.equal(
          call({ ...change, id: crypto.randomUUID() }).status,
          "conflict",
        );
        const otherVessel = crypto.randomUUID(),
          otherFolder = crypto.randomUUID(),
          folder = crypto.randomUUID();
        sql(
          `INSERT INTO vessels VALUES('${otherVessel}'); INSERT INTO shipyard_record_folders(id,vessel_id,name) VALUES('${otherFolder}','${otherVessel}','Private other vessel'),('${folder}','${vessel}','Electrical');`,
        );
        assert.throws(() =>
          run(
            `INSERT INTO shipyard_record_folder_items(job_id,folder_id) VALUES('${value.id}','${otherFolder}');`,
          ),
        );
        run(
          `INSERT INTO shipyard_record_folder_items(job_id,folder_id) VALUES('${value.id}','${folder}');`,
        );
        const folders = JSON.parse(
          run(
            `SELECT read_web_offline_shipyard_folders('${vessel}','${device}');`,
          ),
        );
        assert.deepEqual(
          folders.folders.map((f) => f.id),
          [folder],
        );
        assert.deepEqual(folders.assignments, [
          { job_id: value.id, folder_id: folder },
        ]);
        for (const patch of [
          { trip_id: crypto.randomUUID() },
          { start_date: "2026-02-30" },
          {
            status: "COMPLETED",
            completed_by: crypto.randomUUID(),
            completed_at: new Date().toISOString(),
            completed_by_name: "Forged",
          },
        ]) {
          const id = crypto.randomUUID();
          assert.throws(() =>
            call({
              ...op,
              id: crypto.randomUUID(),
              recordId: id,
              value: { ...value, ...patch, id },
            }),
          );
        }
        assert.equal(
          sql(
            "SELECT count(*) FROM offline_private.record_receipts WHERE feature='yardJobs';",
          ),
          "3",
        );
        assert.equal(sql("SELECT count(*) FROM yard_period_jobs;"), "1");
      },
    );
    installMaintenance(sql, baseline, migration);
    await t.test(
      "maintenance edits clear fields and retries cannot duplicate notifications",
      () => {
        const value = {
          id: crypto.randomUUID(),
          vessel_id: vessel,
          equipment: "Generator",
          serial_number: "synthetic-01",
          hours_of_service: "100",
          hours_at_next_service: "200",
          what_service_done: "Filter change",
          notes: "Before",
          service_done_by: "Synthetic crew",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          port_starboard_na: "Port",
        };
        const op = {
          id: crypto.randomUUID(),
          recordId: value.id,
          feature: "maintenanceLogs",
          kind: "create",
          value,
          baseRevision: null,
        };
        const call = (op) =>
          JSON.parse(
            run(
              `SELECT sync_web_offline_maintenance_log('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
            ),
          );
        const first = call(op);
        assert.equal(first.status, "applied");
        assert.deepEqual(call(op), first);
        const edit = {
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: first.revision,
          value: { ...first.value, notes: null, serial_number: null },
        };
        const second = call(edit);
        assert.equal(second.status, "applied");
        assert.equal(second.value.notes, null);
        assert.equal(second.value.serial_number, null);
        assert.deepEqual(call(edit), second);
        assert.equal(
          call({ ...edit, id: crypto.randomUUID() }).status,
          "conflict",
        );
        assert.throws(() =>
          call({
            ...edit,
            value: { ...edit.value, equipment: "Changed reused id" },
          }),
        );
        sql(`DROP POLICY "Active vessel members can manage maintenance_logs" ON maintenance_logs;
        CREATE POLICY maintenance_read ON maintenance_logs FOR SELECT TO authenticated USING(public.current_user_can_access_vessel(vessel_id));`);
        assert.equal(
          call({
            ...edit,
            id: crypto.randomUUID(),
            baseRevision: second.revision,
          }).status,
          "forbidden",
        );
        assert.equal(
          sql(
            "SELECT count(*) FROM offline_private.record_receipts WHERE feature='maintenanceLogs';",
          ),
          "2",
        );
        assert.equal(
          sql("SELECT count(*) FROM synthetic_notification_capture;"),
          "2",
        );
        assert.equal(sql("SELECT count(*) FROM maintenance_logs;"), "1");
        assert.throws(() =>
          call({
            ...op,
            id: crypto.randomUUID(),
            recordId: crypto.randomUUID(),
            value: { ...value, vessel_id: crypto.randomUUID() },
          }),
        );
      },
    );
    installVesselRecords(sql, baseline, migration);
    for (const [feature, table, rpc, fields] of [
      [
        "pumpOutLogs",
        "pump_out_logs",
        "pump_out_log",
        {
          log_date: "2026-11-09",
          log_time: "12:00",
          created_by_name: "Synthetic crew",
          discharge_type: "PUMPOUT_SERVICE",
          pumpout_service_name: null,
          location: "Dock",
          amount_in_gallons: 100,
          description: "Before",
        },
      ],
      [
        "generalWasteLogs",
        "general_waste_logs",
        "general_waste_log",
        {
          log_date: "2026-11-09",
          log_time: "12:00",
          created_by_name: "Synthetic crew",
          position_location: "Dock",
          description_of_garbage: "Before",
          weight: 10,
          weight_unit: "kgs",
        },
      ],
      [
        "uniforms",
        "uniforms",
        "uniform",
        {
          label: "Test uniforms",
          department: "INTERIOR",
          entries: [
            {
              amount: "2",
              size: "M",
              color: "Navy",
              gender: "",
              dayNight: "Day",
            },
          ],
          created_by: user,
          updated_at: new Date().toISOString(),
        },
      ],
    ])
      await t.test(
        feature +
          ": scoped RLS, atomic retries, clear fields and stale revision",
        () => {
          const value = {
            id: crypto.randomUUID(),
            vessel_id: vessel,
            created_at: new Date().toISOString(),
            ...fields,
          };
          const op = {
            id: crypto.randomUUID(),
            recordId: value.id,
            feature,
            kind: "create",
            value,
            baseRevision: null,
          };
          const call = (op) =>
            JSON.parse(
              run(
                `SELECT sync_web_offline_${rpc}('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
              ),
            );
          const first = call(op);
          assert.equal(first.status, "applied");
          assert.deepEqual(call(op), first);
          const patch =
            feature === "uniforms"
              ? { entries: [] }
              : feature === "pumpOutLogs"
                ? { description: null }
                : { weight: null };
          const edit = {
            ...op,
            id: crypto.randomUUID(),
            kind: "update",
            baseRevision: first.revision,
            value: { ...first.value, ...patch },
          };
          const second = call(edit);
          assert.equal(second.status, "applied");
          for (const [k, v] of Object.entries(patch))
            assert.deepEqual(second.value[k], v);
          assert.deepEqual(call(edit), second);
          assert.equal(
            call({ ...edit, id: crypto.randomUUID() }).status,
            "conflict",
          );
          assert.throws(() =>
            call({ ...edit, value: { ...edit.value, unknown: true } }),
          );
          const fresh = (patch) => {
            const id = crypto.randomUUID();
            return {
              ...op,
              id: crypto.randomUUID(),
              recordId: id,
              value: { ...value, id, ...patch },
            };
          };
          assert.throws(() => call(fresh({ vessel_id: crypto.randomUUID() })));
          for (const patch of feature === "uniforms"
            ? [
                { entries: [{ amount: "2" }] },
                { created_by: crypto.randomUUID() },
              ]
            : [
                { log_date: "2026-02-30" },
                { log_time: "25:00" },
                feature === "pumpOutLogs"
                  ? { amount_in_gallons: -1 }
                  : { weight: -1 },
              ])
            assert.throws(() => call(fresh(patch)));
          sql(
            `DROP POLICY "Active vessel members can manage ${table}" ON ${table}; CREATE POLICY record_read ON ${table} FOR SELECT TO authenticated USING(public.current_user_can_access_vessel(vessel_id));`,
          );
          assert.equal(
            call({
              ...edit,
              id: crypto.randomUUID(),
              baseRevision: second.revision,
            }).status,
            "forbidden",
          );
          assert.equal(sql(`SELECT count(*) FROM ${table};`), "1");
          assert.equal(
            sql(
              `SELECT count(*) FROM offline_private.record_receipts WHERE feature='${feature}';`,
            ),
            "2",
          );
        },
      );
    installInventory(sql, baseline, migration);
    await t.test(
      "inventory: replay, clear fields, stale base, legacy fields and current RLS",
      () => {
        const value = {
          id: crypto.randomUUID(),
          vessel_id: vessel,
          category_id: null,
          name: "Supplies",
          title: "Supplies",
          description: "Before",
          quantity: 0,
          location: "Locker",
          department: "BRIDGE",
          photo: null,
          last_edited_by: user,
          last_edited_by_name: "Spoofed name",
          last_edited_at: null,
          created_at: null,
          items: [{ amount: "2", item: "Rope" }],
        };
        const op = {
          id: crypto.randomUUID(),
          recordId: value.id,
          feature: "inventory",
          kind: "create",
          value,
          baseRevision: null,
        };
        const call = (op) =>
          JSON.parse(
            run(
              `SELECT sync_web_offline_inventory_item('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
            ),
          );
        const first = call(op);
        assert.equal(first.status, "applied");
        assert.deepEqual(call(op), first);
        assert.equal(first.value.last_edited_by_name, "Synthetic crew");
        assert.equal(first.value.last_edited_by, user);
        const edit = {
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: first.revision,
          value: { ...first.value, description: "", items: [] },
        };
        const second = call(edit);
        assert.equal(second.status, "applied");
        assert.equal(second.value.description, "");
        assert.deepEqual(second.value.items, []);
        assert.deepEqual(call(edit), second);
        assert.equal(
          call({ ...edit, id: crypto.randomUUID() }).status,
          "conflict",
        );
        for (const patch of [
          { quantity: 7 },
          { photo: "changed" },
          { category_id: crypto.randomUUID() },
          { items: [{ item: "Rope" }] },
          { items: [true] },
          { department: "ADMIN" },
        ])
          assert.throws(() =>
            call({
              ...edit,
              id: crypto.randomUUID(),
              baseRevision: second.revision,
              value: { ...second.value, ...patch },
            }),
          );
        assert.throws(() =>
          call({
            ...op,
            id: crypto.randomUUID(),
            value: { ...value, vessel_id: crypto.randomUUID() },
          }),
        );
        sql(
          'DROP POLICY "Active vessel members can manage inventory_items" ON inventory_items; CREATE POLICY record_read ON inventory_items FOR SELECT TO authenticated USING(public.current_user_can_access_vessel(vessel_id));',
        );
        assert.equal(
          call({
            ...edit,
            id: crypto.randomUUID(),
            baseRevision: second.revision,
          }).status,
          "forbidden",
        );
        assert.equal(sql("SELECT count(*) FROM inventory_items;"), "1");
        assert.equal(
          sql(
            "SELECT count(*) FROM offline_private.record_receipts WHERE feature='inventory';",
          ),
          "2",
        );
      },
    );
    let first;
    await t.test("grant binds session and caps access at seven days", () => {
      const c = JSON.parse(
        run(`SELECT get_web_offline_context('${vessel}','${device}');`),
      );
      assert.equal(c.exp - c.iat, 604800);
      assert.equal(c.sessionId, session);
    });
    await t.test(
      "create and identical retry commit one record and one receipt",
      () => {
        first = JSON.parse(run(apply(op)));
        assert.equal(first.status, "applied");
        assert.deepEqual(JSON.parse(run(apply(op))), first);
        assert.equal(sql("SELECT count(*) FROM notes;"), "1");
        assert.equal(
          sql("SELECT count(*) FROM offline_private.note_receipts;"),
          "1",
        );
      },
    );
    await t.test("changed payload under same ID rejected", () =>
      assert.throws(() =>
        run(apply({ ...op, value: { ...value, title: "Changed" } })),
      ),
    );
    await t.test("private receipt table cannot be read by the app role", () =>
      assert.throws(() => run("SELECT * FROM offline_private.note_receipts;")),
    );
    await t.test("wrong owner and wrong device rejected", () => {
      assert.throws(() =>
        run(
          apply({
            ...op,
            id: "00000000-0000-0000-0000-000000000006",
            value: { ...value, user_id: vessel },
          }),
        ),
      );
      assert.throws(() =>
        run(`SELECT get_web_offline_context('${vessel}','wrong-device');`),
      );
    });
    await t.test(
      "update compares real row revision and preserves concurrent online edit",
      () => {
        sql(`UPDATE notes SET content='Online change' WHERE id='${note}';`);
        const update = {
          ...op,
          id: "00000000-0000-0000-0000-000000000007",
          kind: "update",
          baseRevision: first.revision,
        };
        assert.equal(JSON.parse(run(apply(update))).status, "conflict");
        assert.equal(
          sql(`SELECT content FROM notes WHERE id='${note}';`),
          "Online change",
        );
        const fresh = JSON.parse(
          run(`SELECT read_web_offline_notes('${vessel}','${device}');`),
        )[0];
        update.baseRevision = fresh.revision;
        assert.equal(JSON.parse(run(apply(update))).status, "applied");
      },
    );
    await t.test(
      "revocation blocks replay of previously successful operation",
      () => {
        sql("UPDATE user_devices SET revoked_at=now();");
        assert.throws(() => run(apply(op)));
        sql("UPDATE user_devices SET revoked_at=null;");
      },
    );
    await t.test(
      "the same user and browser can reconcile a lost reply after signing in again",
      () => {
        const renewed = "00000000-0000-0000-0000-000000000008";
        sql(
          `INSERT INTO auth.sessions(id,user_id) VALUES('${renewed}','${user}'); UPDATE user_devices SET session_id='${renewed}';`,
        );
        const response = JSON.parse(
          sql(auth.replace(session, renewed) + apply(op))
            .split("\n")
            .at(-1),
        );
        assert.equal(response.status, "applied");
        assert.equal(response.operationId, op.id);
        assert.equal(sql("SELECT count(*) FROM notes;"), "1");
        sql(`UPDATE user_devices SET session_id='${session}';`);
      },
    );
    await t.test(
      "time-limited auth session expiry blocks access before subscription expiry",
      () => {
        sql(
          `UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id='${session}';`,
        );
        assert.throws(() => run(apply(op)));
        sql(`UPDATE auth.sessions SET not_after=null WHERE id='${session}';`);
      },
    );
    await t.test(
      "shopping writes use actual table policies and atomic receipts",
      () => {
        const id = "00000000-0000-0000-0000-000000000020";
        const record = {
          id,
          vessel_id: vessel,
          created_by: user,
          created_at: new Date().toISOString(),
          department: "BRIDGE",
          title: "Supplies",
          list_type: "general",
          is_master: false,
          items: [{ text: "Water", amount: "4", checked: false }],
        };
        const change = {
          id: "00000000-0000-0000-0000-000000000021",
          recordId: id,
          feature: "shoppingLists",
          kind: "create",
          baseRevision: null,
          value: record,
        };
        const shopping = (x) =>
          `SELECT sync_web_offline_shopping('${vessel}','${device}','${JSON.stringify(x).replaceAll("'", "''")}'::jsonb);`;
        const created = JSON.parse(run(shopping(change)));
        assert.equal(created.status, "applied");
        assert.deepEqual(JSON.parse(run(shopping(change))), created);
        assert.equal(sql("SELECT count(*) FROM shopping_lists;"), "1");
        assert.equal(
          sql(
            "SELECT count(*) FROM offline_private.record_receipts WHERE feature='shoppingLists';",
          ),
          "1",
        );
        assert.throws(() =>
          run("SELECT * FROM offline_private.record_receipts;"),
        );
        assert.throws(() =>
          sql(
            "SET SESSION AUTHORIZATION authenticated; SET ROLE nautical_offline_writer;",
          ),
        );
        assert.throws(() =>
          run(
            shopping({
              ...change,
              value: { ...record, title: "Tampered retry" },
            }),
          ),
        );
        const update = {
          ...change,
          id: "00000000-0000-0000-0000-000000000022",
          kind: "update",
          baseRevision: created.revision,
          value: { ...created.value, title: "Edited supplies" },
        };
        assert.equal(JSON.parse(run(shopping(update))).status, "applied");
        const stale = {
          ...update,
          id: "00000000-0000-0000-0000-000000000023",
          value: { ...record, title: "Stale edit" },
        };
        assert.equal(JSON.parse(run(shopping(stale))).status, "conflict");
        // A later restrictive policy must also apply to the offline function.
        sql(
          `CREATE POLICY no_shopping_edits ON shopping_lists AS RESTRICTIVE FOR UPDATE TO authenticated USING(false);`,
        );
        const current = JSON.parse(
          run(`SELECT read_web_offline_shopping('${vessel}','${device}');`),
        )[0];
        const denied = JSON.parse(
          run(shopping({ ...stale, baseRevision: current.revision })),
        );
        assert.equal(denied.status, "forbidden");
        assert.equal(
          sql(`SELECT title FROM shopping_lists WHERE id='${id}';`),
          "Edited supplies",
        );
        assert.equal(
          sql(
            "SELECT count(*) FROM offline_private.record_receipts WHERE feature='shoppingLists';",
          ),
          "2",
        );
        sql("DROP POLICY no_shopping_edits ON shopping_lists;");
        sql(
          `CREATE POLICY no_shopping_reads ON shopping_lists AS RESTRICTIVE FOR SELECT TO authenticated USING(false);`,
        );
        assert.deepEqual(
          JSON.parse(
            run(`SELECT read_web_offline_shopping('${vessel}','${device}');`),
          ),
          [],
        );
        assert.equal(JSON.parse(run(shopping(change))).status, "forbidden");
        sql("DROP POLICY no_shopping_reads ON shopping_lists;");
      },
    );
    await t.test(
      "expired trial and deleted auth session prevent grants and writes",
      () => {
        sql(
          "UPDATE vessel_subscriptions SET current_period_end=now()-interval '1 day';",
        );
        assert.throws(() => run(apply(op)));
        sql(
          "UPDATE vessel_subscriptions SET current_period_end=now()+interval '1 day'; DELETE FROM auth.sessions;",
        );
        assert.throws(() => run(apply(op)));
      },
    );
  } finally {
    execFileSync(
      join(bin, "pg_ctl"),
      ["-D", join(dir, "data"), "-m", "fast", "-w", "stop"],
      { stdio: "pipe" },
    );
  }
});
