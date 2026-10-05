// Disposable PostgreSQL (PGlite), never the linked database.
// Set PGLITE_MODULE_PATH to a separately installed @electric-sql/pglite package.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(
      read('supabase/tests/minimal_foundation_schema.sql').replace(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
        ''
      )
    );
    await db.exec(read('supabase/tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm, ''));
    await db.exec(`
      ALTER TABLE public.users ADD COLUMN email TEXT, ADD COLUMN contract_type TEXT, ADD COLUMN rotation_group_id UUID,
        ADD COLUMN department_2 TEXT, ADD COLUMN paused BOOLEAN DEFAULT FALSE;
      ALTER TABLE public.vessels ADD COLUMN management_company_id UUID, ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
      CREATE TABLE public.rotation_groups (id UUID PRIMARY KEY, vessel_id UUID);
      CREATE TABLE public.notes (user_id UUID, vessel_id UUID REFERENCES public.vessels(id) ON DELETE CASCADE);
      CREATE TABLE public.sea_mile_entries (user_id UUID, vessel_name TEXT, review_vessel_id UUID REFERENCES public.vessels(id) ON DELETE SET NULL);
      CREATE FUNCTION public.current_session_has_device_access() RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$ SELECT COALESCE(current_setting('test.device_allowed', true), 'yes') <> 'no' $$;
      CREATE FUNCTION public.security_enforcement_enabled() RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$ SELECT TRUE $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT SELECT, UPDATE ON public.users TO authenticated;
      GRANT SELECT ON public.notes, public.sea_mile_entries TO authenticated;
    `);
    const security = read('supabase/migrations/20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
    for (const name of [
      'vessel_subscription_allows_access',
      'current_user_can_access_vessel',
      'current_user_is_captain_of',
      'current_captain_can_assign_profile',
      'protect_user_security_fields',
    ]) {
      const sql = security.match(
        new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$\\$;')
      )?.[0];
      if (!sql) throw new Error('Missing production function ' + name);
      await db.exec(sql);
    }
    for (const name of [
      'Users can read own profile or active vessel crew',
      'Users edit own profile or Captain edits vessel crew',
      'Members manage only their own notes',
    ]) {
      const sql = security.match(new RegExp('CREATE POLICY "' + name + '"[\\s\\S]*?;'))?.[0];
      if (!sql) throw new Error('Missing production policy ' + name);
      await db.exec(sql);
    }
    const seaMiles = read('supabase/migrations/20260910200000_ADD_SEA_MILES.sql');
    await db.exec(
      seaMiles.match(/CREATE POLICY "Owners and reviewing Captains read sea miles"[\s\S]*?;/)[0]
    );
    await db.exec(`ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sea_mile_entries ENABLE ROW LEVEL SECURITY;
      CREATE TRIGGER protect_user_security_fields_trigger BEFORE INSERT OR UPDATE ON public.users
        FOR EACH ROW EXECUTE FUNCTION public.protect_user_security_fields();`);
    await db.exec(read('supabase/migrations/20261002120000_UNCONDITIONAL_PROFILE_AUTHORIZATION.sql'));
    await db.exec(read('supabase/migrations/20260927100000_CAPTAIN_REMOVE_CREW.sql'));
    const previous = await db.exec(read('supabase/tests/captain_remove_crew_test.sql'));
    console.log(previous.at(-1).rows);
    await db.exec(read('supabase/migrations/20260927110000_VESSEL_CREATION_AFTER_DEPARTURE.sql'));
    await db.exec(
      security.match(
        /CREATE OR REPLACE FUNCTION public.validate_vessel_invite_code\([\s\S]*?\$\$;/
      )[0]
    );
    await db.exec(read('supabase/migrations/20260910170000_CLEAN_UP_SOLO_VESSEL_ON_JOIN.sql'));
    const result = await db.exec(read('supabase/tests/vessel_departure_creation_test.sql'));
    console.log(result.at(-1).rows);
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
