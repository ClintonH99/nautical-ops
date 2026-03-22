/**
 * Create a Paddle Billing transaction and return checkout.url for Pay with Card.
 * Client opens URL in the system browser; Paddle redirects back after payment.
 *
 * Secrets: PADDLE_API_KEY, optional PADDLE_ENV=sandbox|live (default sandbox)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

/** Mirrors app src/constants/subscriptionPlans.ts PADDLE_PRICE_IDS */
const PADDLE_PRICE_IDS: Record<string, Record<string, string>> = {
  '1_5': {
    monthly: 'pri_01kmbephg7qqmbqvjck7zymssh',
    '3_months': 'pri_01kmbf0w42q58zngqdcccge9th',
    '6_months': 'pri_01kmbf1wrbe30gmhgb9g2pyg16',
    '12_months': 'pri_01kmbf5fq7jd2p0cx8j0xhakay',
  },
  '6_10': {
    monthly: 'pri_01kmber39aaqmmz1m6qbzq7yss',
    '3_months': 'pri_01kmbf9ej19e1f7h506ts5d73p',
    '6_months': 'pri_01kmbfabqx4q0654x9kwdh1pr9',
    '12_months': 'pri_01kmbfb5egpnskb5ecjv6xh77z',
  },
  '11_15': {
    monthly: 'pri_01kmbes0mbznxs11we7n8b9e5j',
    '3_months': 'pri_01kmbfcgm1y8kz52f18281ffrz',
    '6_months': 'pri_01kmbfdeyvk39w808zdv757rbx',
    '12_months': 'pri_01kmbfe65782vt1tdfgmhrpeww',
  },
  '16_25': {
    monthly: 'pri_01kmbet1wkq596zqe2y0cn8d20',
    '3_months': 'pri_01kmbff8h99yc7n0pk5che3bva',
    '6_months': 'pri_01kmbfg15wmgfsktswqhnkgw15',
    '12_months': 'pri_01kmbfgx5grpk10pt0awwjajhp',
  },
  '26_40': {
    monthly: 'pri_01kmbetrmtjw5jfefraw26yjee',
    '3_months': 'pri_01kmbfj17safnjk15v03anpqce',
    '6_months': 'pri_01kmbfk0f8smv3p048y5b7sm9f',
    '12_months': 'pri_01kmbfm2e3y1f27zn2e2c9c9xq',
  },
  '40_plus': {
    monthly: 'pri_01kmbevmd6a5hzdsf6pqmmx8rp',
    '3_months': 'pri_01kmbfn7etz89caxm9cj94tbmq',
    '6_months': 'pri_01kmbfp7sxramn43pg6cdzmsvq',
    '12_months': 'pri_01kmbfq0k4eg5fgensecty5d45',
  },
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extra,
  };
}

function paddleApiBase(): string {
  const env = (Deno.env.get('PADDLE_ENV') || 'sandbox').toLowerCase();
  return env === 'live' || env === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization' }), {
        status: 401,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }
    const token = authHeader.slice(7);
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    const body = (await req.json()) as {
      vesselId?: string;
      planTier?: string;
      billingPeriod?: string;
    };

    const { vesselId, planTier, billingPeriod } = body;
    if (!vesselId || !planTier || !billingPeriod) {
      return new Response(
        JSON.stringify({ error: 'Missing vesselId, planTier, or billingPeriod' }),
        {
          status: 400,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        }
      );
    }

    const priceId = PADDLE_PRICE_IDS[planTier]?.[billingPeriod];
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Invalid plan tier or billing period' }), {
        status: 400,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    const apiKey = Deno.env.get('PADDLE_API_KEY');
    if (!apiKey) {
      console.error('PADDLE_API_KEY not set');
      return new Response(JSON.stringify({ error: 'Payment not configured' }), {
        status: 503,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    const base = paddleApiBase();
    const payload = {
      items: [{ price_id: priceId, quantity: 1 }],
      custom_data: {
        vessel_id: vesselId,
        plan_tier: planTier,
        billing_period: billingPeriod,
        user_id: user.id,
      },
      collection_mode: 'automatic',
    };

    // include=checkout so the response includes data.checkout.url (Paddle Billing API)
    const paddleRes = await fetch(`${base}/transactions?include=checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const paddleJson = (await paddleRes.json()) as {
      data?: { checkout?: { url?: string | null }; id?: string };
      error?: { detail?: string; message?: string };
    };

    if (!paddleRes.ok) {
      console.error('Paddle API error:', paddleRes.status, JSON.stringify(paddleJson));
      return new Response(
        JSON.stringify({
          error: paddleJson.error?.detail || paddleJson.error?.message || 'Paddle request failed',
        }),
        {
          status: 502,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        }
      );
    }

    const url = paddleJson.data?.checkout?.url;
    if (!url) {
      console.error('Paddle response missing checkout.url', JSON.stringify(paddleJson));
      return new Response(
        JSON.stringify({
          error:
            'No checkout URL returned. Set a default payment link in Paddle Checkout settings and ensure the transaction can open checkout.',
        }),
        {
          status: 502,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        }
      );
    }

    return new Response(JSON.stringify({ url, transactionId: paddleJson.data?.id }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('create-paddle-checkout:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  }
});
