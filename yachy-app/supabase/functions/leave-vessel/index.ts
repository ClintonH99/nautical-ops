/**
 * Edge Function: Leave the current vessel, without deleting it.
 *
 * Available to any role. A Captain/MOV needs at least one other
 * Captain/MOV already on the vessel first (same safeguard as switching
 * vessels) - Crew/HOD have no such restriction, since they leaving never
 * risks leaving a vessel without a Captain.
 *
 * Rejects outright if the caller is already on their own solo "Crew
 * Account" vessel - nothing meaningful to leave, and proceeding would
 * just abandon one solo vessel for a pointless new one.
 *
 * Moves the caller onto a fresh private solo "Crew Account" vessel.
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

    const { data: callerRow } = await supabase
      .from('users')
      .select('role, vessel_id')
      .eq('id', user.id)
      .single();

    if (!callerRow?.vessel_id) {
      return new Response(JSON.stringify({ error: 'You are not currently part of a vessel' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: currentVessel } = await supabase
      .from('vessels')
      .select('is_solo')
      .eq('id', callerRow.vessel_id)
      .single();

    if (currentVessel?.is_solo) {
      return new Response(JSON.stringify({ error: 'You already have your own private account - there is nothing to leave.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (callerRow.role === 'CAPTAIN_MOV') {
      const { count } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('vessel_id', callerRow.vessel_id)
        .eq('role', 'CAPTAIN_MOV')
        .neq('id', user.id);

      if ((count ?? 0) < 1) {
        return new Response(
          JSON.stringify({ error: 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before leaving.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    const { data: newVessel, error: vesselError } = await supabase
      .from('vessels')
      .insert([{ name: 'Crew Account', invite_code: code, invite_expiry: expiry.toISOString(), is_solo: true }])
      .select()
      .single();
    if (vesselError || !newVessel) {
      return new Response(JSON.stringify({ error: 'Could not create your new account' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    await supabase
      .from('users')
      .update({ vessel_id: newVessel.id, role: 'CREW' })
      .eq('id', user.id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('leave-vessel: uncaught error', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
