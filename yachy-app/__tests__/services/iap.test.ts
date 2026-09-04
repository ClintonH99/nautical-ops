const mockInitConnection = jest.fn();
const mockEndConnection = jest.fn();
const mockFetchProducts = jest.fn();
const mockRequestPurchase = jest.fn();
const mockRestorePurchases = jest.fn();
const mockGetAvailablePurchases = jest.fn();
const mockFinishTransaction = jest.fn();
const mockPurchaseUpdatedListener = jest.fn();
const mockPurchaseErrorListener = jest.fn();
const mockGetSession = jest.fn();
const mockInvoke = jest.fn();

jest.mock('expo-iap', () => ({
  initConnection: (...args: unknown[]) => mockInitConnection(...args),
  endConnection: (...args: unknown[]) => mockEndConnection(...args),
  fetchProducts: (...args: unknown[]) => mockFetchProducts(...args),
  requestPurchase: (...args: unknown[]) => mockRequestPurchase(...args),
  restorePurchases: (...args: unknown[]) => mockRestorePurchases(...args),
  getAvailablePurchases: (...args: unknown[]) => mockGetAvailablePurchases(...args),
  finishTransaction: (...args: unknown[]) => mockFinishTransaction(...args),
  purchaseUpdatedListener: (...args: unknown[]) => mockPurchaseUpdatedListener(...args),
  purchaseErrorListener: (...args: unknown[]) => mockPurchaseErrorListener(...args),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    rpc: jest.fn(),
  },
}));

import {
  restoreAndActivateIAPPurchases,
  verifyAndActivateIAPPurchase,
} from '../../src/services/iap';

const purchase = {
  id: 'transaction-1',
  transactionId: 'transaction-1',
  productId: 'com.nauticalops.app.crew_1_5_v2.monthly',
};

describe('Apple IAP verification and restore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRestorePurchases.mockResolvedValue(undefined);
    mockGetAvailablePurchases.mockResolvedValue([]);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
    });
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    mockFinishTransaction.mockResolvedValue(undefined);
  });

  it('does not report a successful restore when Apple returns no active purchase', async () => {
    await expect(restoreAndActivateIAPPurchases('vessel-1')).resolves.toEqual({
      success: false,
      error: 'No active Nautical Ops subscription was found for this Apple ID.',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('server-verifies and finishes a restored Nautical Ops purchase', async () => {
    mockGetAvailablePurchases.mockResolvedValue([purchase]);

    await expect(restoreAndActivateIAPPurchases('vessel-1')).resolves.toEqual({
      success: true,
    });
    expect(mockInvoke).toHaveBeenCalledWith('verify-apple-iap', {
      body: { transactionId: 'transaction-1', vesselId: 'vessel-1' },
      headers: { Authorization: 'Bearer access-token' },
    });
    expect(mockFinishTransaction).toHaveBeenCalledWith({
      purchase,
      isConsumable: false,
    });
  });

  it('never finishes a transaction that the server rejects', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'Apple could not verify this transaction' },
      error: null,
    });

    await expect(verifyAndActivateIAPPurchase(purchase, 'vessel-1')).resolves.toEqual({
      success: false,
      error: 'Apple could not verify this transaction',
    });
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });
});
