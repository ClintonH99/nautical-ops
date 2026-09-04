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
 * Moves the caller onto a fresh private solo "Crew Account" vessel. The
 * database RPC performs the move atomically, so a partial failure rolls back.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.slice(7);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await supabase.rpc('admin_leave_current_vessel', {
      p_user_id: user.id,
    });
    if (error || !data) {
      const message = error?.message || 'Could not leave vessel';
      const isExpected =
        message.includes('only Captain/MOV') ||
        message.includes('not currently part') ||
        message.includes('nothing to leave');
      return new Response(JSON.stringify({ error: message }), {
        status: isExpected ? 400 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('leave-vessel: uncaught error', err);
    return new Response(JSON.stringify({ error: 'Could not leave vessel' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
