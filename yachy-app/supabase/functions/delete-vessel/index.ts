/**
 * Edge Function: Delete a vessel entirely (Captain/MOV only).
 *
 * Apple and Google store subscriptions cannot be cancelled by this service;
 * the response tells the client when the customer must cancel in the store.
 * A historical Paddle-linked vessel is blocked from deletion until support
 * has confirmed that legacy billing is cancelled, preventing orphan charges.
 *
 * Every user on the vessel, INCLUDING the captain making this call,
 * is moved onto their own private solo "Crew Account" vessel - nobody's
 * actual account is deleted, only the vessel itself. This matches the
 * exact same solo-vessel mechanism used for a fresh crew signup with no
 * invite code.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function cleanupStorage(bucket: string, vesselId: string) {
  const { data: files } = await supabase.storage.from(bucket).list(vesselId);
  if (files?.length) {
    const paths = files.map((f) => `${vesselId}/${f.name}`);
    await supabase.storage.from(bucket).remove(paths);
  }
}

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

    const { data, error } = await supabase.rpc('admin_delete_current_vessel', {
      p_user_id: user.id,
    });
    if (error || !data) {
      const message = error?.message || 'Could not delete vessel';
      const isLegacyBilling = message.includes('legacy billing record');
      const isUnauthorized = message.includes('Only the Captain/MOV');
      return new Response(JSON.stringify({ error: message }), {
        status: isLegacyBilling ? 409 : isUnauthorized ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = data as {
      deleted_vessel_id: string;
      cancellation_provider: 'apple' | 'google' | null;
    };
    const vesselId = result.deleted_vessel_id;
    const cancellationProvider = result.cancellation_provider;

    await cleanupStorage('vessel-banners', vesselId);
    await cleanupStorage('contracts', vesselId);

    return new Response(
      JSON.stringify({
        success: true,
        needsManualStoreCancellation: cancellationProvider !== null,
        cancellationProvider,
        // Kept during the app transition so existing iOS builds still show
        // their Apple-specific cancellation reminder.
        needsManualAppleCancellation: cancellationProvider === 'apple',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('delete-vessel: uncaught error', err);
    return new Response(JSON.stringify({ error: 'Could not delete vessel' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
