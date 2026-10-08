-- One-off sandbox test reconciliation, not a migration.
-- Paddle customer ctm_01m4d4txhqgk4ckh6g36x9qh8p had no addresses or
-- transactions at 2026-10-08 07:18 UTC. POST address was rejected with HTTP 400,
-- field postal_code, request cdc33348-0784-4ec4-a4db-2e27036c7774.
-- Preserve the failed reservation, releasing only this no-transaction attempt.
BEGIN;
UPDATE public.paddle_checkout_intents SET state='canceled'
WHERE id='e904f6b2-f81b-45af-b98a-4a24862dbdea'
  AND vessel_id='2ac4d294-90f5-42f9-ab0e-44d19abd0d61'
  AND environment='sandbox' AND flow='cardless_trial'
  AND state='creating' AND transaction_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.vessel_subscriptions
    WHERE vessel_id='2ac4d294-90f5-42f9-ab0e-44d19abd0d61')
  AND NOT EXISTS (SELECT 1 FROM public.paddle_subscription_links
    WHERE vessel_id='2ac4d294-90f5-42f9-ab0e-44d19abd0d61')
RETURNING id,state;
COMMIT;
