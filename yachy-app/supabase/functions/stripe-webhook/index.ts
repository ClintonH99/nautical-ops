/**
 * Stripe webhook handler.
 * Handles checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.
 * Updates vessel_subscriptions table.
 *
 * Configure in Stripe Dashboard: Webhooks -> Add endpoint
 * URL: https://<project>.supabase.co/functions/v1/stripe-webhook
 * Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
 * Signing secret: STRIPE_WEBHOOK_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    console.error('STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set');
    return new Response('Webhook not configured', { status: 503 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return new Response('Missing stripe-signature', { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(stripeKey);
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const vesselId = session.metadata?.vessel_id || session.client_reference_id;
        const planTier = session.metadata?.plan_tier;
        const billingPeriod = session.metadata?.billing_period || 'monthly';

        if (!vesselId || !planTier) {
          console.error('Missing vessel_id or plan_tier in session metadata');
          break;
        }

        const now = new Date();
        let periodStart = now;
        let periodEnd = new Date(now);

        if (session.subscription) {
          const stripe = new Stripe(stripeKey);
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          periodStart = new Date(sub.current_period_start * 1000);
          periodEnd = new Date(sub.current_period_end * 1000);
        } else {
          const months =
            { monthly: 1, '3_months': 3, '6_months': 6, '12_months': 12 }[billingPeriod] ?? 1;
          periodEnd.setMonth(periodEnd.getMonth() + months);
        }

        await supabaseAdmin.from('vessel_subscriptions').upsert(
          {
            vessel_id: vesselId,
            plan_tier: planTier,
            billing_period: billingPeriod,
            status: 'active',
            stripe_subscription_id: session.subscription as string | null,
            stripe_customer_id: session.customer as string | null,
            current_period_start: periodStart.toISOString(),
            current_period_end: periodEnd.toISOString(),
            updated_at: now.toISOString(),
          },
          {
            onConflict: 'vessel_id',
            ignoreDuplicates: false,
          }
        );
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const vesselId = sub.metadata?.vessel_id;
        if (!vesselId) break;

        const status =
          sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';
        const periodStart = new Date(sub.current_period_start * 1000);
        const periodEnd = new Date(sub.current_period_end * 1000);

        await supabaseAdmin
          .from('vessel_subscriptions')
          .update({
            status,
            current_period_start: periodStart.toISOString(),
            current_period_end: periodEnd.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await supabaseAdmin
          .from('vessel_subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response('Webhook handler failed', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
