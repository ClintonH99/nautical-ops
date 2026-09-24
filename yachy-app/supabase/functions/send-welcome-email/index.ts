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

const BRAND_LOGO_URL =
  'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/a1/50/af/a150aff3-5e28-31a3-b01f-3cbfd2ee26c0/AppIcon-0-0-1x_U007epad-0-1-85-220.png/512x512bb.jpg';
const APP_URL = 'https://www.nautical-ops.com/login';

function emailButton(label: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 22px;">
      <tr>
        <td style="border-radius:14px; background:#1E3A8A;">
          <a href="${APP_URL}" style="display:inline-block; min-width:190px; padding:15px 24px; color:#ffffff; font-size:15px; font-weight:700; line-height:20px; text-align:center; text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
  `;
}

function emailInfoBox(content: string): string {
  return `
    <div style="margin:22px 0 0; padding:17px 18px; border:1px solid #E4E8EF; border-radius:14px; background:#FAFBFC; color:#415066; font-size:14px; line-height:1.55;">
      ${content}
    </div>
  `;
}

function emailShell(kicker: string, title: string, content: string): string {
  return `
    <div style="margin:0; padding:24px 12px; background:#EEF2F6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; color:#101828;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:620px; overflow:hidden; border:1px solid #E0E5EC; border-radius:18px; background:#ffffff;">
              <tr>
                <td align="center" style="padding:14px 24px; border-bottom:1px solid #EDF0F4; background:#ffffff;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="padding-right:11px; vertical-align:middle;">
                        <img src="${BRAND_LOGO_URL}" width="46" height="46" alt="Nautical Ops" style="display:block; width:46px; height:46px; border:0; border-radius:12px;" />
                      </td>
                      <td style="vertical-align:middle; color:#10295F; font-size:22px; font-weight:800; line-height:24px; letter-spacing:-0.4px; white-space:nowrap;">Nautical Ops</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:36px 44px 32px; background:#ffffff;">
                  <p style="margin:0 0 9px; color:#1E3A8A; font-size:12px; font-weight:800; line-height:16px; letter-spacing:1.4px; text-transform:uppercase;">${escapeHtml(kicker)}</p>
                  <h1 style="margin:0 0 14px; color:#101828; font-size:30px; font-weight:800; line-height:35px; letter-spacing:-0.7px;">${escapeHtml(title)}</h1>
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:21px 28px 23px; border-top:1px solid #EDF0F4; background:#FBFCFD; color:#8792A3; font-size:12px; line-height:19px;">
                  Nautical Ops<br />An app for crew, from crew.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function sendCaptainSignupEmail(captainEmail: string, captainName: string) {
  const safeCaptainName = escapeHtml(captainName || 'Captain');
  await resend.emails.send({
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: captainEmail,
    replyTo: 'support@nautical-ops.com',
    subject: 'Welcome aboard, Captain',
    html: emailShell(
      'Captain account',
      'Welcome aboard, Captain',
      `
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Hi ${safeCaptainName},</p>
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Your Captain (MOV) account is ready. You can now create your vessel, invite your crew, and manage operations from one place.</p>
        ${emailButton('Open Nautical Ops')}
        ${emailInfoBox('Start by creating your vessel profile. Once it is ready, Nautical Ops will generate the invite code your crew can use to join.')}
      `
    ),
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
    html: emailShell(
      'Subscription active',
      'You are officially subscribed',
      `
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Hi ${captainName},</p>
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Thank you for subscribing to Nautical Ops for <strong>${vesselName}</strong>. Open Vessel Settings to find your crew invite code and start adding your team.</p>
        ${emailButton('Open Nautical Ops')}
        ${emailInfoBox('Five percent of every subscription supports ocean cleanup. Thank you for helping protect the waters we all work on.')}
      `
    ),
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
    html: emailShell(
      'Crew account',
      'Welcome aboard',
      `
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Hi ${safeName},</p>
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Your crew member account is ready and connected to <strong>${safeVesselName}</strong>. Your vessel tasks, watch schedules, hours of rest, and safety information are now available in Nautical Ops.</p>
        ${emailButton('Open Nautical Ops')}
      `
    ),
  });
}

async function sendCrewSoloSignupEmail(userRecord: any) {
  const safeName = escapeHtml(userRecord.name || 'there');
  await resend.emails.send({
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: userRecord.email,
    replyTo: 'support@nautical-ops.com',
    subject: 'Welcome to Nautical Ops',
    html: emailShell(
      'Crew account',
      'Welcome aboard',
      `
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Hi ${safeName},</p>
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Your crew member account is ready. You can begin using Nautical Ops independently or join your vessel when you receive an invite code.</p>
        ${emailButton('Open Nautical Ops')}
        ${emailInfoBox('When your captain sends an invite code, open Nautical Ops and enter it to connect your account to the vessel.')}
      `
    ),
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
