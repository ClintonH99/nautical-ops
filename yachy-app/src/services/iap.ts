/**
 * Apple In-App Purchase Service (expo-iap v4.3.1)
 * Handles product fetching, purchasing, and restore purchases.
 */
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  restorePurchases,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  type ProductSubscription,
  type Purchase,
} from 'expo-iap';
import { Platform } from 'react-native';
import { getAllAppleProductIds } from '../constants/subscriptionPlans';
import { supabase } from './supabase';

export type IAPProduct = ProductSubscription;
type IAPPurchaseError = Parameters<Parameters<typeof purchaseErrorListener>[0]>[0];

/**
 * Initialize the IAP connection.
 * Call once when the VesselPlansScreen mounts.
 */
export async function initIAP(): Promise<boolean> {
  try {
    await initConnection();
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[IAP] initConnection error:', err);
    return false;
  }
}

/**
 * End the IAP connection.
 * Call when VesselPlansScreen unmounts.
 */
export async function endIAP(): Promise<void> {
  try {
    await endConnection();
  } catch (err) {
    if (__DEV__) console.warn('[IAP] endConnection error:', err);
  }
}

/**
 * Fetch all subscription products from the App Store.
 * Returns an empty array if unavailable.
 */
export async function fetchIAPProducts(): Promise<IAPProduct[]> {
  try {
    if (Platform.OS !== 'ios') return [];
    const productIds = getAllAppleProductIds();
    const products = await fetchProducts({ skus: productIds, type: 'subs' });
    return (products ?? []) as IAPProduct[];
  } catch (err) {
    if (__DEV__) console.warn('[IAP] fetchIAPProducts error:', err);
    return [];
  }
}

/**
 * Purchase a subscription by Apple Product ID.
 * Returns whatever requestPurchase() resolves with, and the caller acts on
 * that directly - this is the normal path. purchaseUpdatedListener was once
 * believed unreliable, but it was guarding on a property that does not exist
 * in expo-iap 4.3.1, so it never fired; that is fixed. It now serves as the
 * fallback for purchases Apple redelivers later, such as one interrupted by
 * lost connectivity.
 */
export async function purchaseSubscription(productId: string, vesselId: string): Promise<any> {
  try {
    const { data: purchaseToken, error: tokenError } = await supabase.rpc(
      'create_pending_apple_purchase',
      { p_vessel_id: vesselId }
    );
    if (tokenError || !purchaseToken) {
      throw tokenError ?? new Error('Could not securely start the purchase');
    }

    const result = await requestPurchase({
      request: {
        apple: { sku: productId, appAccountToken: purchaseToken as string },
      },
      type: 'subs',
    });
    return result;
  } catch (err) {
    if (__DEV__) console.warn('[IAP] purchaseSubscription error:', err);
    throw err;
  }
}

/**
 * Restore previous purchases.
 */
export async function restoreIAPPurchases(): Promise<void> {
  try {
    await restorePurchases();
  } catch (err) {
    if (__DEV__) console.warn('[IAP] restorePurchases error:', err);
    throw err;
  }
}

export interface RestoreIAPPurchasesResult {
  success: boolean;
  error?: string;
}

/**
 * Restore and server-verify an active Nautical Ops subscription.
 *
 * expo-iap's restorePurchases() only refreshes StoreKit. It does not return
 * purchases and it deliberately does not publish them to the purchase
 * listener, so callers must query and verify the restored transactions before
 * telling the customer that restoration succeeded.
 */
export async function restoreAndActivateIAPPurchases(
  vesselId: string
): Promise<RestoreIAPPurchasesResult> {
  try {
    await restorePurchases();
    const purchases = await getAvailablePurchases({
      alsoPublishToEventListenerIOS: false,
      onlyIncludeActiveItemsIOS: true,
    });
    const validProductIds = new Set(getAllAppleProductIds());
    const appPurchases = (purchases ?? []).filter((purchase) =>
      validProductIds.has(purchase.productId)
    );

    if (appPurchases.length === 0) {
      return {
        success: false,
        error: 'No active Nautical Ops subscription was found for this Apple ID.',
      };
    }

    let lastError = 'The restored subscription could not be verified.';
    for (const purchase of appPurchases) {
      const result = await verifyAndActivateIAPPurchase(purchase, vesselId);
      if (result.success) return { success: true };
      if (result.error) lastError = result.error;
    }

    return { success: false, error: lastError };
  } catch (err) {
    if (__DEV__) console.warn('[IAP] restore and activation error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not restore purchases. Please try again.',
    };
  }
}

/**
 * Verify a purchase with our Supabase Edge Function, which calls
 * Apple's App Store Server API directly using its own signed JWT
 * (server-to-server auth) rather than trusting client-supplied receipt
 * data - and update vessel_subscriptions on success. Only the
 * transactionId is sent; the edge function derives the plan tier from
 * Apple's own verified productId rather than trusting client input.
 */
export async function verifyAndActivateIAPPurchase(
  purchase: any,
  vesselId: string,
  finishPurchase = true
): Promise<{ success: boolean; error?: string }> {
  try {
    const transactionId = purchase?.transactionId ?? purchase?.id;
    if (!transactionId) {
      return { success: false, error: 'No transaction ID in purchase result' };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const invokePromise = supabase.functions.invoke('verify-apple-iap', {
      body: {
        transactionId,
        vesselId,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Verification request timed out')), 25000);
    });

    const { data, error: invokeError } = await Promise.race([
      invokePromise,
      timeoutPromise,
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    const result = data as { error?: string } | null;

    if (invokeError) {
      return {
        success: false,
        error: result?.error ?? invokeError.message ?? 'Verification failed',
      };
    }
    if (result?.error) {
      return { success: false, error: result.error };
    }

    if (finishPurchase) {
      await finishTransaction({ purchase, isConsumable: false });
    }
    return { success: true };
  } catch (err) {
    if (__DEV__) console.warn('[IAP] verifyAndActivateIAPPurchase error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Verification failed. Please try again.',
    };
  }
}

/**
 * Silently refresh a Captain's existing Apple subscription after the UI is on
 * screen. This backfills old subscriptions that pre-date server notifications.
 */
export async function reconcileAppleSubscription(vesselId: string): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;

  let connected = false;
  try {
    connected = await initIAP();
    if (!connected) return false;
    await restorePurchases();
    const purchases = await getAvailablePurchases({
      alsoPublishToEventListenerIOS: false,
      onlyIncludeActiveItemsIOS: true,
    });
    const validProductIds = new Set(getAllAppleProductIds());
    const appPurchases = (purchases ?? []).filter((purchase) =>
      validProductIds.has(purchase.productId)
    );

    for (const purchase of appPurchases) {
      const result = await verifyAndActivateIAPPurchase(purchase, vesselId, false);
      if (result.success) return true;
    }
    return false;
  } catch (error) {
    if (__DEV__) console.warn('[IAP] background reconciliation unavailable:', error);
    return false;
  } finally {
    if (connected) await endIAP();
  }
}

/**
 * Set up purchase listeners.
 * Returns a cleanup function — call it on unmount.
 */
export function setupIAPListeners(
  onPurchaseSuccess: (purchase: Purchase) => void,
  onPurchaseError: (error: IAPPurchaseError) => void
): () => void {
  const purchaseListener = purchaseUpdatedListener((purchase: Purchase) => {
    // Catches purchases Apple delivers outside the direct requestPurchase()
    // return - chiefly a purchase interrupted by lost connectivity at sea,
    // which Apple queues and redelivers here on next launch. Guards on the
    // same fields verifyAndActivateIAPPurchase accepts.
    if (purchase.transactionId || purchase.id) {
      onPurchaseSuccess(purchase);
    }
  });

  const errorListener = purchaseErrorListener((error) => {
    if (__DEV__) console.warn('[IAP] Purchase error:', error);
    onPurchaseError(error);
  });

  return () => {
    purchaseListener.remove();
    errorListener.remove();
  };
}
