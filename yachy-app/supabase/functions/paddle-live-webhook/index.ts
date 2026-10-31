// Retired after its credential appeared in browser tool output. Never process
// requests using that credential again, even if live rollout flags are enabled.
Deno.serve(() => Response.json({ error: 'This billing endpoint is retired' }, { status: 410 }));
