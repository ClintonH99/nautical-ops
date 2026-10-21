// Public display only. Checkout and tax confirmation remain in Vessel Plans.
(() => {
  'use strict';
  const data = {
    monthly: {
      a: '$79.99',
      b: '$89.99',
      c: '$119.99',
      d: '$149.99',
      e: '$199.99',
      f: '$249.99',
      period: 'per month',
    },
    '3months': {
      a: '$227.97',
      b: '$256.47',
      c: '$341.97',
      d: '$427.47',
      e: '$569.97',
      f: '$712.47',
      period: 'per 3 months',
    },
    '6months': {
      a: '$441.54',
      b: '$496.74',
      c: '$662.34',
      d: '$827.94',
      e: '$1103.94',
      f: '$1379.94',
      period: 'per 6 months',
    },
    yearly: {
      a: '$863.89',
      b: '$971.89',
      c: '$1295.89',
      d: '$1619.89',
      e: '$2159.89',
      f: '$2699.89',
      period: 'per year',
    },
  };
  const ids = [
    ['1-5', 'a'],
    ['6-10', 'b'],
    ['11-15', 'c'],
    ['16-25', 'd'],
    ['26-40', 'e'],
    ['40plus', 'f'],
  ];
  const buttons = [...document.querySelectorAll('[data-billing]')];
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.billing;
      if (!Object.hasOwn(data, key)) return;
      buttons.forEach((item) => item.classList.toggle('active', item === button));
      const selected = data[key];
      ids.forEach(([id, field]) => {
        const card = document.getElementById('card-' + id);
        const price = document.getElementById('price-' + id);
        const period = document.getElementById('period-' + id);
        const unavailable = selected[field] === null;
        card.classList.toggle('unavailable', unavailable);
        price.className = unavailable ? 'price-amount unavailable-text' : 'price-amount';
        price.textContent = unavailable ? 'Not available for this period' : selected[field];
        period.textContent = unavailable ? '' : selected.period;
      });
    });
  });
})();
