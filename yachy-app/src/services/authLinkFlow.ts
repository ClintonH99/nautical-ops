/**
 * Web pricing handoff: create one-time auth code, claim with session (generates magic link),
 * fetch action_link for the app to open in the system browser.
 */

import { supabase } from './supabase';

const PRICING_REDIRECT = 'https://nautical-ops.com/pricing';

export type OpenWebPricingResult = { actionLink: string } | { errorMessage: string };

async function parseFunctionError(error: { message: string; context?: Response }): Promise<string> {
  let message = error.message;
  const ctx = error.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body && typeof body === 'object' && 'error' in body && body.error) {
        message = String(body.error);
      }
    } catch {
      /* keep error.message */
    }
  }
  return message;
}

/**
 * Chains create-auth-code → claim-auth-link → get-auth-link.
 * Returns the Supabase magic link URL; after verification the user is redirected to pricing.
 */
export async function openWebPricingWithMagicLink(): Promise<OpenWebPricingResult> {
  try {
    let {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session ?? null;
    }
    if (!session?.access_token) {
      return { errorMessage: 'You must be signed in to continue.' };
    }

    const token = session.access_token;

    const { data: codeData, error: codeError } = await supabase.functions.invoke(
      'create-auth-code',
      { body: {} }
    );
    if (codeError) {
      if (__DEV__) console.warn('[authLinkFlow] create-auth-code:', codeError);
      return { errorMessage: await parseFunctionError(codeError) };
    }
    const codePayload = codeData as { code?: string; error?: string } | null;
    if (codePayload?.error) {
      return { errorMessage: String(codePayload.error) };
    }
    const code = codePayload?.code;
    if (!code || typeof code !== 'string') {
      return { errorMessage: 'Could not create auth code. Please try again.' };
    }

    const { data: claimData, error: claimError } = await supabase.functions.invoke(
      'claim-auth-link',
      {
        body: {
          code,
          redirect_to: PRICING_REDIRECT,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (claimError) {
      if (__DEV__) console.warn('[authLinkFlow] claim-auth-link:', claimError);
      return { errorMessage: await parseFunctionError(claimError) };
    }
    const claimPayload = claimData as { error?: string; success?: boolean } | null;
    if (claimPayload?.error) {
      return { errorMessage: String(claimPayload.error) };
    }

    const { data: linkData, error: linkError } = await supabase.functions.invoke('get-auth-link', {
      body: { code },
    });
    if (linkError) {
      if (__DEV__) console.warn('[authLinkFlow] get-auth-link:', linkError);
      return { errorMessage: await parseFunctionError(linkError) };
    }
    const linkPayload = linkData as {
      action_link?: string;
      status?: string;
      error?: string;
    } | null;
    if (linkPayload?.error) {
      return { errorMessage: String(linkPayload.error) };
    }
    const rawLink = linkPayload?.action_link;
    if (!rawLink || typeof rawLink !== 'string') {
      return {
        errorMessage:
          linkPayload?.status === 'pending'
            ? 'Auth link is not ready yet. Please try again.'
            : 'Could not retrieve sign-in link. Please try again.',
      };
    }
    const actionLink = rawLink.trim();
    if (!actionLink) {
      return { errorMessage: 'Could not retrieve sign-in link. Please try again.' };
    }

    return { actionLink };
  } catch (e) {
    if (__DEV__) console.warn('[authLinkFlow]', e);
    return {
      errorMessage: e instanceof Error ? e.message : 'Something went wrong. Please try again.',
    };
  }
}
