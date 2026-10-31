// Exact Paddle live prices approved 29 October 2026. Public display only.
// Checkout and tax confirmation remain in Vessel Plans.
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
      a: '$229.99',
      b: '$259.99',
      c: '$349.99',
      d: '$429.99',
      e: '$569.99',
      f: '$719.99',
      period: 'per 3 months',
    },
    '6months': {
      a: '$449.99',
      b: '$499.99',
      c: '$669.99',
      d: '$829.99',
      e: '$1109.99',
      f: '$1379.99',
      period: 'per 6 months',
    },
    yearly: {
      a: '$869.99',
      b: '$979.99',
      c: '$1299.99',
      d: '$1619.99',
      e: '$2159.99',
      f: '$2699.99',
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
