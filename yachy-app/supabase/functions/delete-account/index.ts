/**
 * Edge Function: Delete a user's account entirely.
 *
 * Two-step deletion, profile first then login credential last, so a
 * partial failure never leaves an unreachable orphaned profile:
 * 1. Delete the public.users row (and their vessel, if it was a solo
 *    "Crew Account" vessel nobody else could ever be on)
 * 2. Delete the actual auth.users login via the Admin API - the one
 *    thing only a service-role key can do, never the client directly
 *
 * A Captain/MOV with other crew still on their vessel cannot delete
 * their account until they promote someone else first - same rule and
 * same reasoning as the sole-Captain block on switching vessels.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: callerRow, error: callerError } = await supabase
      .from('users')
      .select('role, vessel_id')
      .eq('id', user.id)
      .single();
    if (callerError || !callerRow) {
      return new Response(JSON.stringify({ error: 'Could not load account' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let vesselToCleanup: string | null = null;

    if (callerRow.vessel_id) {
      const { data: vessel } = await supabase
        .from('vessels')
        .select('is_solo')
        .eq('id', callerRow.vessel_id)
        .single();

      if (callerRow.role === 'CAPTAIN_MOV') {
        const { count } = await supabase
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('vessel_id', callerRow.vessel_id)
          .neq('id', user.id);
        if ((count ?? 0) > 0) {
          return new Response(
            JSON.stringify({ error: 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before deleting your account.' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // Sole Captain, no other crew - safe to remove the vessel too,
        // regardless of is_solo, since nobody else is on it.
        vesselToCleanup = callerRow.vessel_id;
      } else if (vessel?.is_solo) {
        vesselToCleanup = callerRow.vessel_id;
      }
    }

    const { error: profileDeleteError } = await supabase.from('users').delete().eq('id', user.id);
    if (profileDeleteError) {
      console.error('delete-account: profile delete failed', profileDeleteError);
      return new Response(JSON.stringify({ error: 'Could not delete account. Please contact support@nautical-ops.com' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    if (vesselToCleanup) {
      const { error: vesselDeleteError } = await supabase.from('vessels').delete().eq('id', vesselToCleanup);
      if (vesselDeleteError) {
        console.error('delete-account: vessel cleanup failed (non-fatal)', vesselDeleteError);
      }
    }

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (authDeleteError) {
      console.error('delete-account: auth delete failed', authDeleteError);
      return new Response(JSON.stringify({ error: 'Profile removed, but could not fully delete login. Please contact support@nautical-ops.com' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('delete-account: uncaught error', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
