/**
 * Legacy endpoint deliberately unavailable during credential recovery.
 * Its former implementation accepted an arbitrary userId without authorization.
 * The app uses the separately guarded delete-account flow. Do not restore this
 * endpoint's administrative database access without a reviewed permission model.
 */
Deno.serve((req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  return Response.json(
    { error: 'This legacy account-management endpoint is unavailable. Contact support.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
});
