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
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  type Product,
  type Purchase,
  type PurchaseError,
} from 'expo-iap';
import { Platform } from 'react-native';
import { getAllAppleProductIds, getPlanFromAppleProductId } from '../constants/subscriptionPlans';
import { supabase } from './supabase';

export type IAPProduct = Product;

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
    return products;
  } catch (err) {
    if (__DEV__) console.warn('[IAP] fetchIAPProducts error:', err);
    return [];
  }
}

/**
 * Purchase a subscription by Apple Product ID.
 * Returns whatever requestPurchase() resolves with - in testing, the
 * purchaseUpdatedListener event never fired even though the purchase
 * itself completed successfully, so the caller uses this return value
 * directly rather than relying solely on the listener.
 */
export async function purchaseSubscription(productId: string): Promise<any> {
  try {
    const result = await requestPurchase({
      request: {
        apple: { sku: productId },
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

/**
 * Verify a purchase receipt with our Supabase Edge Function
 * and update vessel_subscriptions on success.
 * Uses supabase.functions.invoke() - the same proven pattern used
 * elsewhere in this project (the old authLinkFlow.ts) - rather than
 * the previous .functions.url() call, which isn't a real method on
 * the installed supabase-js client and meant this request never
 * actually reached our edge function at all.
 */
export async function verifyAndActivateIAPPurchase(
  purchase: Purchase,
  vesselId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const plan = getPlanFromAppleProductId(purchase.productId);
    if (!plan) {
      return { success: false, error: 'Unknown product ID' };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    // Sandbox receipts always get rejected by Apple's production
    // verify endpoint first, forcing a second round-trip to the
    // sandbox endpoint - two full calls to Apple, so this gets a
    // more generous timeout than a typical single API call.
    const invokePromise = supabase.functions.invoke('verify-apple-iap', {
      body: {
        receiptData: purchase.transactionReceipt,
        productId: purchase.productId,
        transactionId: purchase.transactionId,
        vesselId,
        planTierId: plan.planTierId,
        billingPeriodId: plan.billingPeriodId,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Verification request timed out')), 25000);
    });

    const { data, error: invokeError } = await Promise.race([invokePromise, timeoutPromise]);
    const result = data as { error?: string } | null;

    if (invokeError) {
      return { success: false, error: result?.error ?? invokeError.message ?? 'Verification failed' };
    }
    if (result?.error) {
      return { success: false, error: result.error };
    }

    await finishTransaction({ purchase, isConsumable: false });
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
 * Set up purchase listeners.
 * Returns a cleanup function — call it on unmount.
 */
export function setupIAPListeners(
  onPurchaseSuccess: (purchase: Purchase) => void,
  onPurchaseError: (error: PurchaseError) => void
): () => void {
  const purchaseListener = purchaseUpdatedListener((purchase: Purchase) => {
    if (purchase.transactionReceipt) {
      onPurchaseSuccess(purchase);
    }
  });

  const errorListener = purchaseErrorListener((error: PurchaseError) => {
    if (__DEV__) console.warn('[IAP] Purchase error:', error);
    onPurchaseError(error);
  });

  return () => {
    purchaseListener.remove();
    errorListener.remove();
  };
}
