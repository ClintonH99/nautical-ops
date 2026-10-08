/* Marketing interactions only. No authentication, payments or private data access. */
(() => {
  'use strict';
  const root = document.getElementById('nautical-home-concept');
  if (!root) return;
  const one = (selector) => root.querySelector(selector);
  const all = (selector) => [...root.querySelectorAll(selector)];
  const features = {
    trips: {
      label: 'Trips & planning',
      heading: 'Make the plan. Keep the crew informed.',
      copy: "Bring upcoming trips and preparation together, so your crew know what's ahead.",
      items: [
        'Plan upcoming trips and vessel movements',
        'Keep pre-departure checklists together',
        'Keep the crew informed of new trips',
      ],
    },
    tasks: {
      label: 'Tasks & maintenance',
      heading: 'Stay on top of the work onboard.',
      copy: 'Bring daily jobs, service records and longer-term work into one organised place.',
      items: [
        'Organise daily, weekly and monthly tasks',
        'Keep equipment maintenance logs',
        'Track shipyard jobs by department',
      ],
    },
    crew: {
      label: 'Crew & watchkeeping',
      heading: 'A connected crew. A clearer day.',
      copy: 'Give your team the information they need, with access suited to their onboard role.',
      items: [
        'Invite crew and assign onboard roles',
        'Publish schedules for the selected watch crew',
        'Manage crew leave and Hours of Rest',
      ],
    },
    records: {
      label: 'Records & exports',
      heading: 'Useful records. All in one place.',
      copy: 'Keep the details that matter accessible to your team and ready when you need them.',
      items: [
        'Track inventory and safety equipment',
        'Keep your personal My Sea Miles record',
        'Import templates and export vessel records',
      ],
    },
  };

  all('[data-feature]').forEach((button) => {
    button.addEventListener('click', () => {
      const feature = features[button.dataset.feature];
      if (!feature) return;
      all('[data-feature]').forEach((item) =>
        item.setAttribute('aria-pressed', String(item === button))
      );
      one('#no-feature-label').textContent = feature.label;
      one('#no-feature-heading').textContent = feature.heading;
      one('#no-feature-copy').textContent = feature.copy;
      one('#no-detail-list').replaceChildren(
        ...feature.items.map((text) => {
          const item = document.createElement('div');
          item.className = 'no-detail-item';
          const mark = document.createElement('span');
          mark.textContent = '✓';
          mark.setAttribute('aria-hidden', 'true');
          const label = document.createElement('span');
          label.textContent = text;
          item.append(mark, label);
          return item;
        })
      );
    });
  });

  // Approved worldwide USD base catalogue. These are not regional tax totals.
  // Integer minor-unit calculations match the server catalogue rounding.
  const monthlyCents = [7999, 8999, 11999, 14999, 19999, 24999];
  const periodPercent = { 1: 100, 3: 95, 6: 92, 12: 90 };
  let months = 1;
  function renderPrice() {
    const tier = Number(one('#no-crew-size').value);
    if (!Number.isInteger(tier) || tier < 0 || tier >= monthlyCents.length) return;
    const amount = Math.round((monthlyCents[tier] * months * periodPercent[months]) / 100) / 100;
    const unit = months === 1 ? 'month' : months === 12 ? 'year' : `${months} months`;
    const suffix = document.createElement('span');
    suffix.textContent = ` / ${unit}`;
    one('#no-price').replaceChildren(
      document.createTextNode(
        `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      ),
      suffix
    );
    one('#no-price-note').textContent =
      `USD base price. ${months === 1 ? 'Billed monthly.' : months === 12 ? 'Billed once per year.' : `Billed every ${months} months.`}`;
    all('[data-months]').forEach((button) =>
      button.setAttribute('aria-pressed', String(Number(button.dataset.months) === months))
    );
  }
  one('#no-crew-size').addEventListener('change', renderPrice);
  all('[data-months]').forEach((button) =>
    button.addEventListener('click', () => {
      const next = Number(button.dataset.months);
      if (!Object.hasOwn(periodPercent, next)) return;
      months = next;
      renderPrice();
    })
  );
  renderPrice();

  const menuButton = one('.no-menu');
  const menu = one('#no-mobile-nav');
  function closeMenu() {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menu.hidden = open;
    menuButton.setAttribute('aria-expanded', String(!open));
  });
  all('#no-mobile-nav a').forEach((link) => link.addEventListener('click', closeMenu));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      closeMenu();
      menuButton.focus();
    }
  });

  // Help only: these buttons never impersonate a browser installation prompt.
  all('[data-home]').forEach((button) =>
    button.addEventListener('click', () => {
      all('[data-home]').forEach((item) =>
        item.setAttribute('aria-pressed', String(item === button))
      );
      one('#no-home-iphone').hidden = button.dataset.home !== 'iphone';
      one('#no-home-android').hidden = button.dataset.home !== 'android';
    })
  );

  // Do not derive public donation totals from user counts or sandbox billing.
  // The donation display remains explicitly unpublished until a verified,
  // aggregate-only reporting feed is implemented and approved separately.
})();
