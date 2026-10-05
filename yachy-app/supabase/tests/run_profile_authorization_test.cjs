// Disposable PostgreSQL only; never connects to the linked production database.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

async function run(enforceDevices) {
  const db = new PGlite();
  const asUser = async (user, sql) => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
      [id(user), JSON.stringify({ sub: id(user), session_id: id(user + 100) })]);
    await db.exec('SET ROLE authenticated');
    try { return await db.query(sql); } finally { await db.exec('RESET ROLE'); }
  };
  const denied = async (user, sql, message) => {
    await assert.rejects(() => asUser(user, sql), message); checks++;
  };
  try {
    await db.exec(read('tests/minimal_foundation_schema.sql').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    await db.exec(read('tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm, ''));
    await db.exec(`ALTER TABLE users ADD COLUMN email TEXT, ADD COLUMN name TEXT,
      ADD COLUMN position TEXT, ADD COLUMN contract_type TEXT, ADD COLUMN rotation_group_id UUID;
      CREATE TABLE rotation_groups(id UUID PRIMARY KEY,vessel_id UUID);
      GRANT USAGE ON SCHEMA auth,public TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON users TO authenticated;`);
    await db.exec(read('migrations/20260903151000_ENFORCE_TWO_DEVICE_LIMIT.sql'));
    const source = read('migrations/20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
    for (const name of ['vessel_subscription_allows_access', 'current_user_can_access_vessel',
      'current_user_is_captain_of', 'current_captain_can_assign_profile', 'protect_user_security_fields']) {
      await db.exec(source.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$\\$;'))[0]);
    }
    for (const name of ['Users can read own profile or active vessel crew', 'Users edit own profile or Captain edits vessel crew']) {
      await db.exec(source.match(new RegExp('CREATE POLICY "' + name + '"[\\s\\S]*?;'))[0]);
    }
    await db.exec(`ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      CREATE TRIGGER protect_user_security_fields_trigger BEFORE INSERT OR UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION protect_user_security_fields();
      INSERT INTO vessels(id,name,invite_code) VALUES ('${id(1)}','Test A','TESTA'),('${id(2)}','Test B','TESTB');
      INSERT INTO rotation_groups(id,vessel_id) VALUES ('${id(51)}','${id(1)}'),('${id(52)}','${id(2)}');
      INSERT INTO users(id,vessel_id,role,email,name) VALUES
        ('${id(10)}','${id(1)}','CREW','crew@example.invalid','Crew'),
        ('${id(11)}','${id(1)}','CAPTAIN_MOV','captain@example.invalid','Captain'),
        ('${id(12)}','${id(1)}','HOD','hod@example.invalid','HOD'),
        ('${id(13)}','${id(2)}','CREW','other@example.invalid','Other');`);
    await db.exec(read('migrations/20261002120000_UNCONDITIONAL_PROFILE_AUTHORIZATION.sql'));
    await db.exec(`UPDATE security_enforcement_settings SET enabled=${enforceDevices}`);
    for (const user of [10,11,12,13,20,21,22]) {
      await db.exec(`INSERT INTO auth.users(id) VALUES ('${id(user)}')`);
      await asUser(user, `SELECT register_user_device('test-fingerprint-${user}','web','Test browser')`);
    }

    // Normal signup remains an unassigned profile, then uses a protected vessel RPC.
    await asUser(20, `INSERT INTO users(id,role,email) VALUES ('${id(20)}','CREW','newcrew@example.invalid')`);
    await asUser(21, `INSERT INTO users(id,role,email) VALUES ('${id(21)}','CAPTAIN_MOV','newcaptain@example.invalid')`);
    equal((await asUser(20, `SELECT vessel_id FROM users WHERE id='${id(20)}'`)).rows[0].vessel_id, null);
    equal((await asUser(21, `SELECT role FROM users WHERE id='${id(21)}'`)).rows[0].role, 'CAPTAIN_MOV');
    await denied(22, `INSERT INTO users(id,vessel_id,role) VALUES ('${id(22)}','${id(1)}','CAPTAIN_MOV')`, /security fields/);
    await denied(22, `INSERT INTO users(id,role) VALUES ('${id(22)}','HOD')`, /security fields/);
    await denied(22, `INSERT INTO users(id,role) VALUES ('${id(22)}','MANAGEMENT')`, /security fields/);
    await denied(22, `INSERT INTO users(id,role) VALUES ('${id(30)}','CREW')`, /security fields/);

    await denied(10, `UPDATE users SET role='CAPTAIN_MOV' WHERE id='${id(10)}'`, /own role/);
    await denied(10, `UPDATE users SET vessel_id='${id(2)}' WHERE id='${id(10)}'`, /authorized vessel actions/);
    await denied(10, `UPDATE users SET vessel_id=NULL WHERE id='${id(10)}'`, /authorized vessel actions/);
    await denied(10, `UPDATE users SET email='changed@example.invalid' WHERE id='${id(10)}'`, /identity fields/);
    await denied(10, `UPDATE users SET id='${id(31)}' WHERE id='${id(10)}'`, /identity fields/);
    await denied(10, `INSERT INTO users(id,role,email) VALUES ('${id(10)}','CAPTAIN_MOV','crew@example.invalid')
      ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role`, /own role/);
    equal((await asUser(10, `SELECT id FROM users WHERE vessel_id='${id(2)}'`)).rows.length, 0);
    await asUser(10, `UPDATE users SET name='Updated Crew', position='Deckhand' WHERE id='${id(10)}'`);
    equal((await asUser(10, `SELECT name FROM users WHERE id='${id(10)}'`)).rows[0].name, 'Updated Crew');
    // A crew member or HOD cannot update another member's authorization fields.
    equal((await asUser(12, `UPDATE users SET role='CAPTAIN_MOV' WHERE id='${id(10)}' RETURNING id`)).rows.length, 0);
    equal((await asUser(10, `UPDATE users SET role='CREW' WHERE id='${id(11)}' RETURNING id`)).rows.length, 0);
    // Captain promotion, demotion and same-vessel rotation/contract edits survive.
    for (const role of ['HOD','CAPTAIN_MOV','CREW']) {
      await asUser(11, `UPDATE users SET role='${role}' WHERE id='${id(10)}'`);
      equal((await asUser(10, `SELECT role FROM users WHERE id='${id(10)}'`)).rows[0].role, role);
    }
    await asUser(11, `UPDATE users SET contract_type='temporary',rotation_group_id='${id(51)}' WHERE id='${id(10)}'`);
    equal((await asUser(10, `SELECT contract_type FROM users WHERE id='${id(10)}'`)).rows[0].contract_type, 'temporary');
    await denied(11, `UPDATE users SET rotation_group_id='${id(52)}' WHERE id='${id(10)}'`, /different vessel/);
    await denied(11, `UPDATE users SET role='MANAGEMENT' WHERE id='${id(10)}'`, /Invalid vessel role/);
    await denied(11, `UPDATE users SET vessel_id=NULL WHERE id='${id(10)}'`, /authorized vessel actions/);
    await denied(11, `UPDATE users SET vessel_id='${id(2)}' WHERE id='${id(10)}'`, /authorized vessel actions/);
    equal((await asUser(11, `UPDATE users SET role='CAPTAIN_MOV' WHERE id='${id(13)}' RETURNING id`)).rows.length, 0);
    equal((await db.query(`SELECT role,vessel_id FROM users WHERE id='${id(10)}'`)).rows[0], {role:'CREW',vessel_id:id(1)});
    equal((await db.query('SELECT enabled FROM security_enforcement_settings')).rows[0].enabled, enforceDevices);
    // Migration is safely re-applicable and does not enable the rollout switch.
    await db.exec(read('migrations/20261002120000_UNCONDITIONAL_PROFILE_AUTHORIZATION.sql'));
    await denied(10, `UPDATE users SET role='CAPTAIN_MOV' WHERE id='${id(10)}'`, /own role/);
    console.log(`Profile authorization checks passed with device enforcement ${enforceDevices ? 'ON' : 'OFF'}`);
  } finally { await db.close(); }
}
(async()=>{ await run(false); await run(true); console.log(`${checks} profile authorization assertions passed`); })()
  .catch(error=>{ console.error(error.message); process.exitCode=1; });
