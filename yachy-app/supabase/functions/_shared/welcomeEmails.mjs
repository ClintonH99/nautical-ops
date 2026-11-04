// Welcome content is unchanged; delivery is handled by the durable worker.
import { emailLogo, emailLogoAttachments } from './emailBrand.mjs';
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeSubjectValue(value, fallback) {
  const cleaned = String(value ?? fallback)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return cleaned || fallback;
}

const APP_URL = 'https://www.nautical-ops.com/login';

function emailButton(label) {
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

function emailInfoBox(content) {
  return `
    <div style="margin:22px 0 0; padding:17px 18px; border:1px solid #E4E8EF; border-radius:14px; background:#FAFBFC; color:#415066; font-size:14px; line-height:1.55;">
      ${content}
    </div>
  `;
}

function emailShell(kicker, title, content) {
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
                        ${emailLogo(46)}
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

function sendCaptainSignupEmail(captainEmail, captainName) {
  const safeCaptainName = escapeHtml(captainName || 'Captain');
  return {
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: captainEmail,
    reply_to: 'support@nautical-ops.com',
    subject: 'Welcome aboard, Captain',
    attachments: emailLogoAttachments(),
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
  };
}

function sendCrewJoinedEmail(userRecord, vesselName) {
  const safeName = escapeHtml(userRecord.name || 'there');
  const safeVesselName = escapeHtml(vesselName || 'your vessel');
  const subjectVesselName = safeSubjectValue(vesselName, 'your vessel');
  return {
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: userRecord.email,
    reply_to: 'support@nautical-ops.com',
    subject: `You're in \u2014 welcome to ${subjectVesselName}`,
    attachments: emailLogoAttachments(),
    html: emailShell(
      'Crew account',
      'Welcome aboard',
      `
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Hi ${safeName},</p>
        <p style="margin:0 0 20px; color:#526176; font-size:16px; line-height:1.6;">Your crew member account is ready and connected to <strong>${safeVesselName}</strong>. Your vessel tasks, watch schedules, hours of rest, and safety information are now available in Nautical Ops.</p>
        ${emailButton('Open Nautical Ops')}
      `
    ),
  };
}

function sendCrewSoloSignupEmail(userRecord) {
  const safeName = escapeHtml(userRecord.name || 'there');
  return {
    from: 'Nautical Ops <hello@nautical-ops.com>',
    to: userRecord.email,
    reply_to: 'support@nautical-ops.com',
    subject: 'Welcome to Nautical Ops',
    attachments: emailLogoAttachments(),
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
  };
}

export function welcomeMessage(job) {
  const record = job.recipient;
  if (job.kind === 'captain') return sendCaptainSignupEmail(record.email, record.name);
  if (job.kind === 'crew_solo') return sendCrewSoloSignupEmail(record);
  if (job.kind === 'crew_joined') return sendCrewJoinedEmail(record, job.vessel_name);
  throw new Error('Unknown welcome kind');
}
