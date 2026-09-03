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

async function createSoloVessel(): Promise<string> {
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);
  const { data, error } = await supabase
    .from('vessels')
    .insert([
      {
        name: 'Crew Account',
        invite_code: code,
        invite_expiry: expiry.toISOString(),
        is_solo: true,
      },
    ])
    .select()
    .single();
  if (error || !data) throw new Error('Could not create solo vessel');
  return data.id;
}

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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
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

    const { data: callerRow } = await supabase
      .from('users')
      .select('role, vessel_id')
      .eq('id', user.id)
      .single();

    if (!callerRow?.vessel_id || callerRow.role !== 'CAPTAIN_MOV') {
      return new Response(JSON.stringify({ error: 'Only the Captain/MOV can delete a vessel' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const vesselId = callerRow.vessel_id;

    const { data: subscription } = await supabase
      .from('vessel_subscriptions')
      .select('paddle_subscription_id, payment_provider')
      .eq('vessel_id', vesselId)
      .maybeSingle();

    if (subscription?.paddle_subscription_id) {
      return new Response(
        JSON.stringify({
          error:
            'This vessel has a legacy billing record. Contact support@nautical-ops.com so billing can be cancelled safely before the vessel is deleted.',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cancellationProvider =
      subscription?.payment_provider === 'apple' || subscription?.payment_provider === 'google'
        ? subscription.payment_provider
        : null;

    const { data: crewToMove } = await supabase
      .from('users')
      .select('id')
      .eq('vessel_id', vesselId);

    for (const person of crewToMove ?? []) {
      const newVesselId = await createSoloVessel();
      await supabase
        .from('users')
        .update({ vessel_id: newVesselId, role: 'CREW' })
        .eq('id', person.id);
    }

    await cleanupStorage('vessel-banners', vesselId);
    await cleanupStorage('contracts', vesselId);

    const { error: vesselDeleteError } = await supabase.from('vessels').delete().eq('id', vesselId);
    if (vesselDeleteError) {
      console.error('delete-vessel: vessel delete failed', vesselDeleteError);
      return new Response(
        JSON.stringify({
          error: 'Could not delete vessel. Please contact support@nautical-ops.com',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
