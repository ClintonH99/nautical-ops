/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';
const html = fs.readFileSync(path.join(__dirname, '../../public/checkout.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../../public/paddle-checkout.js'), 'utf8');
const transaction = 'txn_' + 'a'.repeat(26);
let callback: (event: any) => void;
beforeEach(() => {
  jest.useFakeTimers();
  document.documentElement.innerHTML = html;
  window.history.replaceState({}, '', `/checkout?transaction=${transaction}`);
  (window as any).NAUTICAL_PADDLE = {
    enabled: true,
    environment: 'sandbox',
    token: 'test_dummy_public_token',
  };
  (window as any).Paddle = {
    Environment: { set: jest.fn() },
    Initialize: ({ eventCallback }: any) => {
      callback = eventCallback;
    },
    Checkout: { open: jest.fn(), updateCheckout: jest.fn() },
  };
  // Execute only local source against a stub provider; no network or transactions.
  window.eval(script);
  document
    .querySelector('script[src="https://cdn.paddle.com/paddle/v2/paddle.js"]')!
    .dispatchEvent(new Event('load'));
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
it('a matching completed checkout returns to Home with presentation intent', () => {
  callback({
    name: 'checkout.completed',
    data: { transaction_id: transaction, status: 'completed' },
  });
  expect(document.getElementById('success-panel')!.hidden).toBe(false);
  expect(document.querySelector('#success-panel a')!.getAttribute('href')).toBe(
    '/app?crewInvite=ready'
  );
  expect(document.getElementById('home-return')!.getAttribute('href')).toBe(
    '/app?crewInvite=ready'
  );
  expect((window as any).Paddle.Checkout.updateCheckout).not.toHaveBeenCalled();
});
it.each([
  { transaction_id: 'txn_' + 'b'.repeat(26), status: 'completed' },
  { transaction_id: transaction, status: 'pending' },
  { status: 'completed' },
])('does not show success for incomplete or unrelated events', (data) => {
  callback({ name: 'checkout.completed', data });
  expect(document.getElementById('success-panel')!.hidden).toBe(true);
  expect(document.getElementById('home-return')!.getAttribute('href')).toBe('/app');
});
it('a closed checkout offers plans without a congratulations intent', () => {
  callback({ name: 'checkout.closed', data: { transaction_id: transaction } });
  expect(document.getElementById('success-panel')!.hidden).toBe(true);
  expect(document.getElementById('return-action')!.getAttribute('href')).toBe('/vessel-plans');
  expect(document.getElementById('home-return')!.getAttribute('href')).toBe('/app');
});
