(() => {
  const status = document.getElementById('status');
  const config = window.NAUTICAL_PADDLE;
  const params = new URLSearchParams(window.location.search);
  const manual = params.has('transaction');
  const transaction = params.get('transaction') || params.get('_ptxn');
  // Presentation intent only. Paddle's matching transaction and actual totals
  // remain authoritative; this flag cannot set prices, dates or entitlement.
  const paymentMethodIntent = params.get('flow') === 'payment-method';
  const node = (id) => document.getElementById(id);
  let loadTimer;
  let promoPending = false;
  let promoTimer;
  let checkoutReady = false;
  let appliedCode = '';
  let requestedCode;
  let checkoutStopped = false;
  let checkoutCompleted = false;
  let paymentMethodUpdate = false;
  const promoMessage = (text, state = '') => {
    node('promo-message').textContent = text;
    node('promo-message').dataset.state = state;
  };
  const settlePromo = () => {
    promoPending = false;
    requestedCode = undefined;
    window.clearTimeout(promoTimer);
    node('promo-apply').disabled = !checkoutReady;
    node('promo-remove').disabled = !checkoutReady;
    node('promo-apply').textContent = 'Apply';
    node('promo-code').disabled = !checkoutReady;
  };
  const changePromo = (code) => {
    if (!checkoutReady || promoPending || checkoutStopped || paymentMethodIntent) return;
    if (code !== null && (!code.trim() || code.length > 100)) {
      promoMessage('Enter a promo code first.', 'error');
      return;
    }
    promoPending = true;
    requestedCode = code === null ? null : code.trim();
    node('promo-code').disabled = true;
    node('promo-apply').disabled = true;
    node('promo-remove').disabled = true;
    node('promo-apply').textContent = 'Checking…';
    promoMessage('Checking with Paddle…');
    // Hide payment submission until Paddle confirms the new totals.
    node('payment-frame').style.visibility = 'hidden';
    promoTimer = window.setTimeout(() => {
      checkoutReady = false;
      checkoutStopped = true;
      settlePromo();
      promoMessage(
        'The code could not be confirmed. Reload checkout to check the current totals.',
        'error'
      );
      fail('Paddle did not confirm the promo-code update. Reload checkout before continuing.');
    }, 15000);
    try {
      // Only change the discount on this existing transaction. Never send items,
      // create a subscription, activate a trial, or calculate a local discount.
      window.Paddle.Checkout.updateCheckout({ discountCode: code === null ? null : code.trim() });
    } catch {
      checkoutReady = false;
      checkoutStopped = true;
      settlePromo();
      promoMessage('The code could not be checked. Reload checkout and try again.', 'error');
      fail('Promo-code update could not be confirmed. Reload checkout before continuing.');
    }
  };
  node('promo-form').addEventListener('submit', (event) => {
    event.preventDefault();
    changePromo(node('promo-code').value);
  });
  node('promo-remove').addEventListener('click', () => changePromo(null));
  const message = (text, retry = false) => {
    status.textContent = text;
    node('status-panel').hidden = false;
    node('retry').hidden = !retry;
  };
  const stopLoading = () => window.clearTimeout(loadTimer);
  const fail = (text) => {
    stopLoading();
    message(text, true);
  };
  const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const validTotals = (totals) =>
    totals && ['subtotal', 'tax', 'total'].every((key) => amount(totals[key]));
  const cycleLabel = (cycle) => {
    if (
      !cycle ||
      !['day', 'week', 'month', 'year'].includes(cycle.interval) ||
      !Number.isInteger(cycle.frequency) ||
      cycle.frequency < 1
    )
      return '';
    if (cycle.frequency === 1) return 'Every ' + cycle.interval;
    return 'Every ' + cycle.frequency + ' ' + cycle.interval + 's';
  };
  // Display-only context from the server-verified payment-method setup response.
  // Never infer an expiry by adding 30 days to today, or use storage as entitlement.
  let trialEnd;
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem('paddle-trial-summary:' + transaction) || 'null'
    );
    if (
      Number.isFinite(saved?.savedAt) &&
      Date.now() - saved.savedAt >= 0 &&
      Date.now() - saved.savedAt < 600000 &&
      typeof saved.trialEnd === 'string' &&
      Number.isFinite(Date.parse(saved.trialEnd)) &&
      Date.parse(saved.trialEnd) > Date.now()
    ) {
      trialEnd = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(saved.trialEnd));
    }
  } catch {
    /* Missing/restricted storage: Paddle still shows the authoritative dates. */
  }
  const renderSummary = (data) => {
    if (checkoutStopped) return null;
    node('payment-frame').style.visibility = 'hidden';
    const items = data?.items;
    const recurringItems = Array.isArray(items) ? items.filter((item) => item.billing_cycle) : [];
    const recurring = data?.recurring_totals;
    if (
      data?.transaction_id !== transaction ||
      !/^[A-Z]{3}$/.test(data?.currency_code || '') ||
      !Array.isArray(items) ||
      items.length === 0 ||
      !items.every(
        (item) =>
          typeof item.product?.name === 'string' &&
          item.product.name.trim() &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0 &&
          (!item.billing_cycle || cycleLabel(item.billing_cycle))
      ) ||
      !validTotals(data.totals) ||
      (recurringItems.length && !validTotals(recurring))
    ) {
      node('summary-details').hidden = true;
      checkoutReady = false;
      settlePromo();
      node('summary-loading').hidden = false;
      node('summary-loading').textContent =
        'Plan totals could not be confirmed. Reload checkout before continuing.';
      node('trial-note').hidden = true;
      node('payment-note').textContent =
        'Check the full recurring total and payment dates in Paddle before confirming.';
      return false;
    }
    // Unrelated customer events can arrive while Paddle is checking a code.
    // Do not unblock payment or claim success until this requested change is present.
    if (
      promoPending &&
      (requestedCode === null
        ? Boolean(data.discount)
        : data.discount?.code?.toLowerCase() !== requestedCode.toLowerCase())
    )
      return null;
    // Paddle.js events use major currency units (89.99), unlike REST API amounts (8999).
    const money = (value) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: data.currency_code,
        currencyDisplay: 'code',
      }).format(value);
    const text = (id, value) => {
      node(id).textContent = value;
    };
    const line = (id, value) => {
      node(id + '-row').hidden = !amount(value) || value === 0;
      text(id, amount(value) ? '−' + money(value) : '');
    };
    node('plan-items').replaceChildren();
    items.forEach((item) => {
      const li = document.createElement('li');
      const title = document.createElement('p');
      title.className = 'item-name';
      title.textContent = item.product.name;
      const period = document.createElement('p');
      period.className = 'item-period';
      period.textContent =
        (cycleLabel(item.billing_cycle) || 'One-time payment') +
        (item.quantity > 1 ? ' · Quantity: ' + item.quantity : '');
      li.append(title, period);
      node('plan-items').appendChild(li);
    });
    const totals = data.totals;
    const due = amount(totals.balance) ? totals.balance : totals.total;
    text('subtotal', money(totals.subtotal));
    text('tax', money(totals.tax));
    text('due-today', money(due));
    line('discount', totals.discount);
    line('credit', totals.credit);
    const hasRecurring = recurringItems.length > 0;
    node('recurring-section').hidden = !hasRecurring;
    if (hasRecurring) {
      const cycles = [...new Set(recurringItems.map((item) => cycleLabel(item.billing_cycle)))];
      text('recurring-subtotal', money(recurring.subtotal));
      text('recurring-tax', money(recurring.tax));
      text('recurring-total', money(recurring.total) + ' · ' + cycles.join(', ').toLowerCase());
      line('recurring-discount', recurring.discount);
    }
    // A price's trial_period describes its catalogue offer, NOT the current
    // subscription. Active payment-method updates carry it too. Only show a
    // trial when this transaction has recent server-verified trial context.
    const inFreeTrial = due === 0 && hasRecurring && Boolean(trialEnd);
    paymentMethodUpdate = paymentMethodIntent && hasRecurring && due === 0 && totals.total === 0;
    node('checkout-grid').dataset.flow = paymentMethodUpdate ? 'payment-method' : 'checkout';
    text('page-title', paymentMethodUpdate ? 'Update payment method' : 'Set up billing details');
    text(
      'page-subtitle',
      paymentMethodUpdate
        ? 'Choose how to pay for your vessel.'
        : 'Secure billing for your vessel, all in one place.'
    );
    node('update-note').hidden = !paymentMethodUpdate;
    node('promo-section').hidden = paymentMethodIntent;
    node('trial-badge').hidden = !inFreeTrial;
    text('trial-badge', 'Existing free trial');
    node('first-payment-row').hidden = !inFreeTrial;
    text('first-payment', trialEnd || 'See payment form');
    node('trial-note').hidden = !inFreeTrial;
    text(
      'trial-note',
      trialEnd
        ? 'Your existing trial end date stays the same. Confirm the date in Paddle before continuing.'
        : 'Check your trial end date in the secure payment form before continuing.'
    );
    text(
      'payment-note',
      inFreeTrial
        ? 'No subscription payment today. Review the recurring total and first payment date in Paddle. Cancel before the trial ends to avoid a subscription payment.'
        : paymentMethodUpdate
          ? 'No payment is due today. This checkout saves payment details for your existing subscription.'
          : 'Review the amount due today and any recurring charges in Paddle before confirming.'
    );
    node('summary-loading').hidden = true;
    node('summary-details').hidden = false;
    checkoutReady = true;
    appliedCode = typeof data.discount?.code === 'string' ? data.discount.code : '';
    node('promo-remove').hidden = !data.discount;
    if (appliedCode || requestedCode === null) node('promo-code').value = appliedCode;
    const hasSaving =
      (amount(totals.discount) && totals.discount > 0) ||
      (hasRecurring && amount(recurring.discount) && recurring.discount > 0);
    promoMessage(
      data.discount
        ? hasSaving
          ? (appliedCode ? 'Code ' + appliedCode + ' applied. ' : 'Discount applied. ') +
            'Review Paddle’s updated totals and offer terms before confirming.'
          : 'Paddle accepted the code, but no saving is shown in these totals. The first-payment discount has not been confirmed. Contact support before completing billing setup.'
        : 'Enter your code to check eligibility.',
      data.discount ? (hasSaving ? 'success' : 'error') : ''
    );
    settlePromo();
    node('payment-frame').style.visibility = 'visible';
    return true;
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
  node('checkout-grid').hidden = false;
  loadTimer = window.setTimeout(
    () =>
      message(
        'Secure checkout is taking longer than expected. Check your connection, reload this checkout, or return to Vessel Plans.',
        true
      ),
    20000
  );
  const script = document.createElement('script');
  script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  script.onerror = () =>
    fail('We could not load secure checkout. Check your connection and try again.');
  script.onload = () => {
    try {
      if (config.environment === 'sandbox') window.Paddle.Environment.set('sandbox');
      // Old _ptxn links auto-open. New links use one explicit open so the chosen
      // billing location can be carried over without creating a new transaction.
      window.Paddle.Initialize({
        token: config.token,
        checkout: {
          settings: {
            displayMode: 'inline',
            // Paddle rejects express for cardless-trial subscriptions, including
            // their payment-method updates. One-page retains wallets and cards.
            variant: 'one-page',
            allowLogout: false,
            showAddDiscounts: false,
            allowDiscountRemoval: true,
            theme: 'light',
            frameTarget: 'checkout-container',
            frameInitialHeight: '450',
            frameStyle:
              'width: 100%; min-width: 312px; background-color: transparent; border: none;',
          },
        },
        eventCallback(event) {
          if (checkoutCompleted) return;
          if (event.data?.transaction_id && event.data.transaction_id !== transaction) return;
          if (event.name === 'checkout.completed') {
            // Ignore incomplete/unbound success messages. This confirmation is
            // payment UI only; the app still verifies access on the server.
            if (event.data?.transaction_id !== transaction || event.data?.status !== 'completed') {
              fail(
                'Payment confirmation is incomplete. Return to Vessel Plans to check your subscription.'
              );
              return;
            }
            checkoutCompleted = true;
            checkoutStopped = true;
            checkoutReady = false;
            settlePromo();
            promoMessage('Checkout completed.');
            stopLoading();
            node('status-panel').hidden = true;
            node('checkout-grid').hidden = true;
            node('checkout-intro').hidden = true;
            node('success-title').textContent = paymentMethodUpdate
              ? 'Payment method updated'
              : 'Checkout completed';
            node('success-message').textContent = paymentMethodUpdate
              ? 'Paddle has confirmed your payment details. Return to Nautical Ops to check your current plan.'
              : 'Paddle has confirmed checkout. Return to Nautical Ops to check your server-confirmed subscription.';
            // Completed events use snake_case (selected/loaded use kebab-case).
            const methods = { apple_pay: 'Apple Pay', google_pay: 'Google Pay', card: 'Card' };
            const method = methods[event.data.payment?.method_details?.type];
            node('success-method').hidden = !method;
            node('success-method').textContent = method || '';
            node('success-panel').hidden = false;
            node('success-title').focus();
          } else if (event.name === 'checkout.closed') {
            checkoutStopped = true;
            checkoutReady = false;
            settlePromo();
            promoMessage('Checkout closed.');
            stopLoading();
            message('Checkout closed. You can return to Vessel Plans.');
            node('return-action').hidden = false;
          } else if (event.name === 'checkout.warning' && promoPending) {
            checkoutStopped = true;
            checkoutReady = false;
            settlePromo();
            promoMessage(
              'Paddle could not confirm this code. Reload checkout to check the current totals.',
              'error'
            );
            fail('The promo-code update was not confirmed. Reload checkout before continuing.');
          } else if (
            ['checkout.error', 'checkout.payment.error', 'checkout.payment.failed'].includes(
              event.name
            )
          ) {
            checkoutStopped = true;
            checkoutReady = false;
            settlePromo();
            promoMessage(
              'Checkout could not be confirmed. Reload before applying a code.',
              'error'
            );
            node('payment-frame').style.visibility = 'hidden';
            fail(
              'Checkout could not be completed. Follow the instructions in the secure payment form or return to Vessel Plans.'
            );
          } else if (
            [
              'checkout.loaded',
              'checkout.updated',
              'checkout.customer.created',
              'checkout.customer.updated',
              'checkout.customer.removed',
              'checkout.items.updated',
              'checkout.items.removed',
              'checkout.discount.applied',
              'checkout.discount.removed',
            ].includes(event.name)
          ) {
            stopLoading();
            try {
              const ready = renderSummary(event.data);
              if (ready === null) return;
              if (ready) {
                message('Review your plan and billing details in the secure Paddle form.');
                node('status-panel').hidden = true;
              } else {
                fail('Checkout totals could not be confirmed. Reload checkout before continuing.');
              }
            } catch {
              node('summary-details').hidden = true;
              fail('Checkout totals could not be confirmed. Reload checkout before continuing.');
            }
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
    } catch {
      fail(
        'Checkout could not start. Please return to Vessel Plans and contact support if this continues.'
      );
    }
  };
  document.head.appendChild(script);
})();
