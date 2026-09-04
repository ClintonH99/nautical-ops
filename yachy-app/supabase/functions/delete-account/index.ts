/**
 * Edge Function: Delete a user's account entirely.
 *
 * Two-step deletion: one atomic database RPC removes the profile and any
 * now-empty vessel, then the Admin API removes the login credential. The RPC
 * is retry-safe if the Auth deletion fails transiently.
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

    const { data, error } = await supabase.rpc('admin_prepare_account_deletion', {
      p_user_id: user.id,
    });
    if (error || !data) {
      const message = error?.message || 'Could not delete account';
      const isCaptainConflict = message.includes('only Captain/MOV');
      const isLegacyBilling = message.includes('legacy billing record');
      return new Response(JSON.stringify({ error: message }), {
        status: isCaptainConflict || isLegacyBilling ? 409 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = data as {
      deleted_vessel_id: string | null;
      cancellation_provider: 'apple' | 'google' | null;
    };

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (authDeleteError) {
      console.error('delete-account: auth delete failed', authDeleteError);
      return new Response(
        JSON.stringify({
          error: 'Account cleanup is incomplete. Please retry or contact support@nautical-ops.com',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        needsManualStoreCancellation: result.cancellation_provider !== null,
        cancellationProvider: result.cancellation_provider,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('delete-account: uncaught error', err);
    return new Response(JSON.stringify({ error: 'Could not delete account' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
