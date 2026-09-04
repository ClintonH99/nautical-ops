/**
 * Edge Function: Send welcome/subscription emails via Resend
 *
 * Triggered by Database Webhooks on two tables:
 * 1. vessel_subscriptions (INSERT/UPDATE) - "thank you for subscribing" to
 *    the Captain, only the moment status first becomes 'active' (not on
 *    renewals)
 * 2. users (INSERT/UPDATE) - fires the moment a user first gets a
 *    vessel_id. Branches four ways:
 *    - CAPTAIN_MOV, real vessel -> Captain signup welcome (immediately,
 *      regardless of payment)
 *    - CREW/HOD, real vessel (is_solo = false) -> Crew joined welcome
 *    - CREW/HOD, solo vessel (is_solo = true) -> Crew solo signup welcome
 *    Never re-fires on a later vessel switch, since that's a different
 *    starting condition (one vessel to another, not none to one).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const resend = new Resend(Deno.env.get('RESEND_API_KEY')!);

function isTrustedInternalRequest(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return Boolean(serviceRoleKey && req.headers.get('authorization') === `Bearer ${serviceRoleKey}`);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeSubjectValue(value: unknown, fallback: string): string {
  const cleaned = String(value ?? fallback)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return cleaned || fallback;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: any;
  schema: string;
  old_record: any | null;
}

const BRAND_HEADER = `
  <div style="background:#0D1B2A; padding:32px 20px; text-align:center;">
    <div style="display:inline-block; border:1.5px solid #C9A227; padding:10px 24px;">
      <span style="color:#ffffff; font-size:15px; font-weight:500; letter-spacing:2px;">NAUTICAL OPS</span>
    </div>
  </div>
`;
const BRAND_FOOTER = `
  <div style="border-top:1px solid #e5e5e5; padding:16px 24px; text-align:center;">
    <span style="font-size:11px; color:#888888;">Nautical Ops \u00b7 Built by crew, for crew</span>
  </div>
`;

async function sendCaptainSignupEmail(captainEmail: string, captainName: string) {
  const safeCaptainName = escapeHtml(captainName || 'Captain');
  await resend.emails.send({
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: captainEmail,
    replyTo: 'support@nautical-ops.com',
    subject: 'Welcome to Nautical Ops',
    html: `
      ${BRAND_HEADER}
      <div style="padding:28px 24px; font-size:14px; line-height:1.7; color:#111111;">
        <p style="margin:0 0 14px;">Hi ${safeCaptainName},</p>
        <p style="margin:0 0 14px;">You're in \u2014 your account and vessel are ready to go. Nautical Ops is built to handle the day-to-day: tasks, watch schedules, hours of rest, safety records, all in one place.</p>
        <p style="margin:0 0 14px;">When you're ready to bring your crew on board, head to <strong>Vessel Plans</strong> to choose a subscription that fits your crew size \u2014 that's what unlocks your invite code so you can start adding people.</p>
        <p style="margin:0 0 14px;">If you have any questions, email us at support@nautical-ops.com.</p>
        <p style="margin:0;">Fair winds and following seas,<br>Clinton Handford<br>Founder & Developer of Nautical Ops</p>
      </div>
      ${BRAND_FOOTER}
    `,
  });
}

async function sendCaptainSubscriptionEmail(vesselId: string) {
  const { data: vessel } = await supabase
    .from('vessels')
    .select('name')
    .eq('id', vesselId)
    .single();

  const { data: captain } = await supabase
    .from('users')
    .select('email, name')
    .eq('vessel_id', vesselId)
    .eq('role', 'CAPTAIN_MOV')
    .limit(1)
    .maybeSingle();

  if (!captain?.email) {
    console.error('No captain email found for vessel', vesselId);
    return;
  }

  const vesselName = escapeHtml(vessel?.name || 'your vessel');
  const captainName = escapeHtml(captain.name || 'Captain');

  await resend.emails.send({
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: captain.email,
    replyTo: 'support@nautical-ops.com',
    subject: "Welcome aboard \u2014 you're officially subscribed",
    html: `
      ${BRAND_HEADER}
      <div style="padding:28px 24px; font-size:14px; line-height:1.7; color:#111111;">
        <p style="margin:0 0 14px;">Hi ${captainName},</p>
        <p style="margin:0 0 14px;">Thank you for subscribing to Nautical Ops for <strong>${vesselName}</strong>. You're all set \u2014 head into the app and open <strong>Vessel Settings</strong> to find your crew invite code, and start adding your team.</p>
        <p style="margin:0 0 14px;">One more thing worth knowing: 5% of every subscription goes straight to ocean cleanup. So beyond running a smoother vessel, you're already doing something good for the water we all work on.</p>
        <p style="margin:0 0 14px;">If anything's missing or you want a feature added, email us at <span style="color:#0D1B2A; font-weight:500;">support@nautical-ops.com</span>.</p>
        <p style="margin:0;">Fair winds and following seas,<br>Clinton Handford<br>Founder & Developer of Nautical Ops</p>
      </div>
      ${BRAND_FOOTER}
    `,
  });
}

async function sendCrewJoinedEmail(userRecord: any, vesselName: string) {
  const safeName = escapeHtml(userRecord.name || 'there');
  const safeVesselName = escapeHtml(vesselName || 'your vessel');
  const subjectVesselName = safeSubjectValue(vesselName, 'your vessel');
  await resend.emails.send({
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: userRecord.email,
    replyTo: 'support@nautical-ops.com',
    subject: `You're in \u2014 welcome to ${subjectVesselName}`,
    html: `
      ${BRAND_HEADER}
      <div style="padding:28px 24px; font-size:14px; line-height:1.7; color:#111111;">
        <p style="margin:0 0 14px;">Hi ${safeName},</p>
        <p style="margin:0 0 14px;">You've just joined <strong>${safeVesselName}</strong> on Nautical Ops. Everything you need day to day \u2014 tasks, watch schedules, hours of rest, safety info \u2014 is right there in the app.</p>
        <p style="margin:0;">Welcome aboard.</p>
      </div>
      ${BRAND_FOOTER}
    `,
  });
}

async function sendCrewSoloSignupEmail(userRecord: any) {
  const safeName = escapeHtml(userRecord.name || 'there');
  await resend.emails.send({
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: userRecord.email,
    replyTo: 'support@nautical-ops.com',
    subject: 'Welcome to Nautical Ops',
    html: `
      ${BRAND_HEADER}
      <div style="padding:28px 24px; font-size:14px; line-height:1.7; color:#111111;">
        <p style="margin:0 0 14px;">Hi ${safeName},</p>
        <p style="margin:0 0 14px;">Your account is ready. Nautical Ops is built to handle the day-to-day life on board \u2014 tasks, watch schedules, hours of rest, safety records, all in one place.</p>
        <p style="margin:0;">When your Captain sends you an invite code for your vessel, head to <strong>Settings \u2192 My Profile \u2192 Join a different vessel</strong> to get connected to your crew's real setup.</p>
      </div>
      ${BRAND_FOOTER}
    `,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }
    if (!isTrustedInternalRequest(req)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const payload = (await req.json()) as WebhookPayload;

    if (payload.table === 'vessel_subscriptions') {
      const becameActive =
        payload.record?.status === 'active' &&
        (payload.type === 'INSERT' || payload.old_record?.status !== 'active');

      if (becameActive) {
        await sendCaptainSubscriptionEmail(payload.record.vessel_id);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (payload.table === 'users') {
      const firstVesselJoin =
        payload.record?.vessel_id && (payload.type === 'INSERT' || !payload.old_record?.vessel_id);

      if (firstVesselJoin) {
        const { data: vessel } = await supabase
          .from('vessels')
          .select('name, is_solo')
          .eq('id', payload.record.vessel_id)
          .single();

        if (payload.record.role === 'CAPTAIN_MOV') {
          await sendCaptainSignupEmail(payload.record.email, payload.record.name);
        } else if (vessel?.is_solo) {
          await sendCrewSoloSignupEmail(payload.record);
        } else {
          await sendCrewJoinedEmail(payload.record, vessel?.name || 'your vessel');
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unhandled table' }), { status: 400 });
  } catch (e) {
    console.error('send-welcome-email error:', e);
    return new Response(JSON.stringify({ error: 'Unable to process email notification' }), {
      status: 500,
    });
  }
});
