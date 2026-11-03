// All evidence comes from authenticated server reads, never checkout URL flags.
import { emailLogo, emailLogoAttachments } from './emailBrand.mjs';
const APP = 'https://www.nautical-ops.com';
export const escapeHtml = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const validDate = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const date = (v) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(v)) + ' UTC';
const money = (v, currency) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(v) / 100);
const positive = (v) =>
  typeof v === 'string' && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v));

export function billingMessages({
  subscription: s,
  transactions,
  link,
  vessel,
  recipient,
  since,
  now = Date.now(),
}) {
  if (
    !s ||
    link.environment !== 'live' ||
    s.id !== link.subscription_id ||
    s.customer_id !== link.customer_id ||
    s.collection_mode !== 'automatic' ||
    !['trialing', 'active', 'past_due', 'paused', 'canceled'].includes(s.status) ||
    !Array.isArray(transactions) ||
    !validDate(since) ||
    !recipient?.email ||
    !recipient?.id
  )
    throw new Error('Invalid billing evidence');
  const end = s.current_billing_period?.ends_at;
  const future = validDate(end) && Date.parse(end) > now;
  const tier = {
    '1_5': '1–5',
    '6_10': '6–10',
    '11_15': '11–15',
    '16_25': '16–25',
    '26_40': '26–40',
    '40_plus': '40+',
  }[vessel.plan_tier];
  const cycle = {
    monthly: 'Monthly',
    '3_months': 'Every 3 months',
    '6_months': 'Every 6 months',
    '12_months': 'Yearly',
  }[vessel.billing_period];
  if (!tier || !cycle) throw new Error('Unknown plan');
  const plan = `${tier} crew members · ${cycle}`;
  const messages = [];
  const add = (
    kind,
    reference,
    subject,
    title,
    paragraphs,
    details,
    action = 'Open Nautical Ops',
    path = '/app'
  ) => {
    const text = [
      `Hi ${recipient.name || 'Captain'},`,
      ...paragraphs,
      ...details.map(([k, v]) => `${k}: ${v}`),
      `${action}: ${APP}${path}`,
      'Questions? support@nautical-ops.com',
    ].join('\n\n');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef2f6;font-family:Arial,sans-serif;color:#172744"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;background:white;border:1px solid #e0e5ec;border-radius:18px"><tr><td style="padding:24px;border-bottom:1px solid #edf0f4">${emailLogo(36)} <strong style="font-size:24px">Nautical Ops</strong></td></tr><tr><td style="padding:28px 24px"><h1 style="font-size:28px;line-height:1.2">${escapeHtml(title)}</h1><p>Hi ${escapeHtml(recipient.name || 'Captain')},</p>${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.6;color:#526176">${escapeHtml(p)}</p>`).join('')}<table role="presentation" width="100%" style="background:#f7f9fc;padding:16px;border-radius:12px">${details.map(([k, v]) => `<tr><td style="padding:8px 4px;vertical-align:top">${escapeHtml(k)}</td><td style="padding:8px 4px;font-weight:bold">${escapeHtml(v)}</td></tr>`).join('')}</table><p style="margin:30px 0"><a href="${APP}${path}" style="display:inline-block;padding:16px 24px;background:#233d8b;color:white;text-decoration:none;border-radius:12px;font-weight:bold">${escapeHtml(action)}</a></p><p style="color:#526176;line-height:1.5">Questions? <a href="mailto:support@nautical-ops.com">Contact support</a>.</p></td></tr><tr><td align="center" style="padding:20px;color:#6b778b;font-size:12px;border-top:1px solid #edf0f4">Nautical Ops · An app for crew, from crew.</td></tr></table></td></tr></table></body></html>`;
    messages.push({
      key: `billing-v1/${kind}/${reference}/${recipient.id}`,
      kind,
      message: {
        from: 'Nautical Ops <hello@nautical-ops.com>',
        to: recipient.email,
        reply_to: 'support@nautical-ops.com',
        subject,
        attachments: emailLogoAttachments(),
        html,
        text,
      },
    });
  };
  if (s.status === 'trialing' && future) {
    add(
      'trial',
      s.id,
      'Your Nautical Ops free trial is active',
      'Your 30-day free trial is active',
      [
        `Your vessel, ${vessel.name}, is ready. You can now invite your crew onboard and use Nautical Ops during your free trial.`,
        'No subscription payment is taken for starting this trial. If you add payment details, billing starts when your trial ends unless you cancel renewal beforehand. Without payment details, access ends when the trial expires.',
      ],
      [
        ['Vessel', vessel.name],
        ['Plan', plan],
        ['Trial ends', date(end)],
        ['Due for the trial', 'US$0.00'],
      ],
      'View Invite Code',
      '/vessel-settings?section=invite-code'
    );
  }
  let paid = false;
  for (const t of transactions) {
    if (
      t.subscription_id !== s.id ||
      t.customer_id !== s.customer_id ||
      t.status !== 'completed' ||
      !/^txn_[a-z0-9]{26}$/.test(t.id || '')
    )
      throw new Error('Transaction binding mismatch');
    if (!validDate(t.created_at) || Date.parse(t.created_at) < Date.parse(since)) continue;
    if (
      t.collection_mode !== 'automatic' ||
      t.currency_code !== 'USD' ||
      t.details?.totals?.balance !== '0'
    )
      continue;
    const captured = (t.payments || []).filter(
      (p) => p.status === 'captured' && positive(p.amount) && validDate(p.captured_at)
    );
    if (t.origin === 'subscription_payment_method_change') {
      if (t.details?.totals?.grand_total === '0' && captured.length === 0) {
        const description =
          s.status === 'trialing' && future
            ? `Your free trial still ends on ${date(end)}. Adding payment details has not restarted or shortened your trial. No subscription payment was taken by this setup.`
            : 'Paddle confirmed your payment-method update. This message confirms saved billing details, not a subscription payment.';
        add(
          'billing',
          t.id,
          'Your Nautical Ops billing details are saved',
          'Billing details saved',
          [
            `Paddle has confirmed the payment-method setup for ${vessel.name}.`,
            description,
            'You can review your plan and cancel renewal in Nautical Ops.',
          ],
          [
            ['Vessel', vessel.name],
            ['Plan', plan],
            ...(s.status === 'trialing' && future ? [['Trial ends', date(end)]] : []),
          ],
          'View Vessel Plans',
          '/vessel-plans'
        );
      }
      continue;
    }
    if (
      [
        'web',
        'api',
        'subscription_recurring',
        'subscription_update',
        'subscription_charge',
      ].includes(t.origin) &&
      positive(t.details?.totals?.grand_total) &&
      captured.reduce((n, p) => n + Number(p.amount), 0) === Number(t.details.totals.grand_total)
    ) {
      paid = true;
      add(
        'paid',
        t.id,
        'Your Nautical Ops payment is confirmed',
        'Payment confirmed',
        [
          `Paddle has confirmed a successful subscription payment for ${vessel.name}.`,
          'This is your Nautical Ops payment confirmation, not a replacement tax invoice. Paddle provides the official invoice.',
        ],
        [
          ['Vessel', vessel.name],
          ['Amount paid', money(t.details.totals.grand_total, t.currency_code)],
          ['Payment date', date(captured.at(-1).captured_at)],
          ['Payment reference', t.id],
        ]
      );
    }
  }
  // An active subscription is not necessarily proof of money moving (e.g. credit/discount).
  if (s.status === 'active' && future && !paid)
    add(
      'active',
      s.id,
      'Your Nautical Ops subscription is active',
      'Your subscription is active',
      [
        `Paddle confirms that the subscription for ${vessel.name} is active. You can access your vessel and invite your crew.`,
        'This confirms subscription access, not a charge. A payment confirmation is sent only when Paddle confirms money was collected.',
      ],
      [
        ['Vessel', vessel.name],
        ['Plan', plan],
        ['Current period ends', date(end)],
      ],
      'View Invite Code',
      '/vessel-settings?section=invite-code'
    );
  return messages;
}

export async function sendStoredEmail(row, { apiKey, fetcher = fetch, now = Date.now() }) {
  if (row.status === 'accepted') return { accepted: true, id: row.provider_id, duplicate: true };
  // Resend deduplicates for 24 hours. Never blindly retry an ambiguous old send.
  if (row.first_attempt_at && now - Date.parse(row.first_attempt_at) >= 23 * 60 * 60 * 1000)
    return { review: true };
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': row.email_key,
    },
    body: JSON.stringify(row.message),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Email provider status ${response.status}`);
  const data = await response.json();
  if (typeof data.id !== 'string' || !data.id) throw new Error('Missing email provider ID');
  return { accepted: true, id: data.id };
}
