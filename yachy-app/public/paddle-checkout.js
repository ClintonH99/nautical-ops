/* global document, window, URLSearchParams */
(() => {
  const status = document.getElementById('status');
  const config = window.NAUTICAL_PADDLE;
  const transaction = new URLSearchParams(window.location.search).get('_ptxn');
  const message = (text) => {
    status.textContent = text;
  };
  if (!config?.enabled) {
    message('Checkout is not available yet. Please return to Vessel Plans.');
    return;
  }
  const prefix =
    config.environment === 'sandbox' ? 'test_' : config.environment === 'live' ? 'live_' : null;
  if (
    !prefix ||
    typeof config.token !== 'string' ||
    !config.token.startsWith(prefix) ||
    !/^txn_[a-z0-9]{26}$/.test(transaction || '')
  ) {
    message('This checkout link is invalid. Please return to Vessel Plans to continue.');
    return;
  }
  document.getElementById('environment').hidden = config.environment !== 'sandbox';
  const script = document.createElement('script');
  script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  script.onerror = () =>
    message('We could not load secure checkout. Check your connection and try again.');
  script.onload = () => {
    try {
      if (config.environment === 'sandbox') window.Paddle.Environment.set('sandbox');
      // Paddle automatically opens the server-created transaction from _ptxn.
      // Do not construct client-side prices or call open() a second time.
      window.Paddle.Initialize({
        token: config.token,
        checkout: { settings: { displayMode: 'overlay', allowLogout: false } },
        eventCallback(event) {
          if (event.name === 'checkout.completed') {
            message(
              'Checkout completed. Return to Vessel Plans to check your server-confirmed subscription.'
            );
          } else if (event.name === 'checkout.closed') {
            message('Checkout closed. You can return to Vessel Plans.');
          } else if (event.name === 'checkout.error' || event.name === 'checkout.payment.error') {
            message(
              'Checkout could not be completed. Follow the instructions in the payment window or return to Vessel Plans.'
            );
          }
        },
      });
      message('Review your plan and billing details in the secure Paddle window.');
    } catch {
      message(
        'Checkout could not start. Please return to Vessel Plans and contact support if this continues.'
      );
    }
  };
  document.head.appendChild(script);
})();
