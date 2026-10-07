(() => {
  const status = document.getElementById('status');
  const config = window.NAUTICAL_PADDLE;
  const params = new URLSearchParams(window.location.search);
  const manual = params.has('transaction');
  const transaction = params.get('transaction') || params.get('_ptxn');
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
    (manual && params.has('_ptxn')) ||
    params.getAll('transaction').length > 1 ||
    params.getAll('_ptxn').length > 1 ||
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
      // Old _ptxn links auto-open. New links use one explicit open so the chosen
      // billing location can be carried over without creating a new transaction.
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
      if (manual) {
        let customer;
        try {
          const key = 'paddle-prefill:' + transaction;
          const saved = JSON.parse(window.sessionStorage.getItem(key) || 'null');
          window.sessionStorage.removeItem(key);
          if (
            saved &&
            typeof saved.email === 'string' &&
            saved.email.length <= 254 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saved.email) &&
            Number.isFinite(saved.savedAt) &&
            Date.now() - saved.savedAt >= 0 &&
            Date.now() - saved.savedAt < 600000 &&
            /^[A-Z]{2}$/.test(saved.address?.countryCode || '') &&
            typeof saved.address?.postalCode === 'string' &&
            saved.address.postalCode.length <= 32
          ) {
            customer = {
              email: saved.email,
              address: {
                countryCode: saved.address.countryCode,
                ...(saved.address.postalCode ? { postalCode: saved.address.postalCode } : {}),
              },
            };
          }
        } catch {
          /* Prefill is optional, never evidence of a payment or exemption. */
        }
        window.Paddle.Checkout.open({
          transactionId: transaction,
          ...(customer ? { customer } : {}),
        });
      }
      message('Review your plan and billing details in the secure Paddle window.');
    } catch {
      message(
        'Checkout could not start. Please return to Vessel Plans and contact support if this continues.'
      );
    }
  };
  document.head.appendChild(script);
})();
