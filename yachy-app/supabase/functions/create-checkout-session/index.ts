/**
 * Create Stripe Checkout session for vessel subscription.
 * Called by app with vesselId, planTier, billingPeriod.
 * Returns checkout URL for Pay with Card flow.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const PLAN_PRICES: Record<string, number> = {
  '1_5': 79.99,
  '6_10': 89.99,
  '11_15': 119.99,
  '16_25': 149.99,
  '26_40': 199.99,
  '40_plus': 249.99,
};

const BILLING_DISCOUNTS: Record<string, number> = {
  monthly: 0,
  '3_months': 5,
  '6_months': 8,
  '12_months': 10,
  once_off: 10,
};

const BILLING_MONTHS: Record<string, number> = {
  monthly: 1,
  '3_months': 3,
  '6_months': 6,
  '12_months': 12,
  once_off: 12,
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
      successUrl?: string;
      cancelUrl?: string;
    };

    const { vesselId, planTier, billingPeriod, successUrl, cancelUrl } = body;
    if (!vesselId || !planTier || !billingPeriod) {
      return new Response(
        JSON.stringify({ error: 'Missing vesselId, planTier, or billingPeriod' }),
        {
          status: 400,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        }
      );
    }

    const monthlyPrice = PLAN_PRICES[planTier];
    const discount = BILLING_DISCOUNTS[billingPeriod] ?? 0;
    const months = BILLING_MONTHS[billingPeriod] ?? 1;

    if (monthlyPrice == null) {
      return new Response(JSON.stringify({ error: 'Invalid plan tier' }), {
        status: 400,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY not set');
      return new Response(JSON.stringify({ error: 'Payment not configured' }), {
        status: 503,
        headers: corsHeaders({ 'Content-Type': 'application/json' }),
      });
    }

    const stripe = new Stripe(stripeKey);
    const discountedMonthly = monthlyPrice * (1 - discount / 100);
    const totalCents = Math.round(discountedMonthly * months * 100);

    const isRecurring = months === 1;
    const finalSuccessUrl = successUrl || 'nauticalops://subscription-success';
    const finalCancelUrl = cancelUrl || 'nauticalops://subscription-cancel';

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      client_reference_id: vesselId,
      metadata: {
        vessel_id: vesselId,
        plan_tier: planTier,
        billing_period: billingPeriod,
        user_id: user.id,
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Nautical Ops - ${planTier} (${billingPeriod})`,
              description: `Vessel subscription for ${months} month(s)`,
            },
            ...(isRecurring
              ? {
                  recurring: { interval: 'month' },
                  unit_amount: Math.round(discountedMonthly * 100),
                }
              : { unit_amount: totalCents }),
          },
          quantity: 1,
        },
      ],
    };

    if (isRecurring) {
      sessionParams.subscription_data = {
        metadata: {
          vessel_id: vesselId,
          plan_tier: planTier,
          billing_period: billingPeriod,
          user_id: user.id,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('create-checkout-session:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  }
});
