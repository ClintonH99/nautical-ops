/** @jest-environment jsdom */
import {
  createPageRefresh,
  installWebRefresh,
  isRefreshStartAllowed,
} from '../../src/utils/installWebRefresh';

function touch(target: Element, type: string, x: number, y: number, count = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
  });
  target.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  document.body.innerHTML = '';
});

it('requires confirmation, cancels safely and reloads only once', () => {
  const actions = {
    online: () => true,
    confirm: jest.fn().mockReturnValue(false),
    reload: jest.fn(),
    status: jest.fn(),
  };
  const refresh = createPageRefresh(actions);
  refresh();
  expect(actions.reload).not.toHaveBeenCalled();
  actions.confirm.mockReturnValue(true);
  refresh();
  refresh();
  expect(actions.reload).toHaveBeenCalledTimes(1);
  expect(actions.confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved changes'));
});

it('keeps the page when offline without asking to discard anything', () => {
  const actions = { online: () => false, confirm: jest.fn(), reload: jest.fn(), status: jest.fn() };
  createPageRefresh(actions)();
  expect(actions.reload).not.toHaveBeenCalled();
  expect(actions.confirm).not.toHaveBeenCalled();
  expect(actions.status).toHaveBeenCalledWith(expect.stringContaining('offline'));
});

it.each(['input', 'textarea', 'select', 'button', 'a', 'canvas', 'iframe', 'svg'])(
  'does not steal gestures on %s',
  (tag) => {
    const target = document.createElement(tag);
    document.body.appendChild(target);
    expect(isRefreshStartAllowed(target)).toBe(false);
  }
);

it('rejects scrolls away from the top and horizontal scroll containers', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.scrollTop = 12;
  expect(isRefreshStartAllowed(target)).toBe(false);
  target.scrollTop = 0;
  target.style.overflowX = 'auto';
  Object.defineProperty(target, 'scrollWidth', { value: 300 });
  Object.defineProperty(target, 'clientWidth', { value: 100 });
  expect(isRefreshStartAllowed(target)).toBe(false);
});

it('ignores controls and their child labels, modal forms and explicit exclusions', () => {
  for (const attribute of [
    'role="button"',
    'role="slider"',
    'role="dialog"',
    'data-refresh-ignore="true"',
  ]) {
    document.body.innerHTML = `<div ${attribute}><span>Label</span></div>`;
    expect(isRefreshStartAllowed(document.querySelector('span'))).toBe(false);
  }
});

it('does not refresh while the keyboard/input has focus', () => {
  document.body.innerHTML = '<input /><div>Content</div>';
  document.querySelector('input')!.focus();
  expect(isRefreshStartAllowed(document.querySelector('div'))).toBe(false);
});

it('handles a top pull, shows feedback, prevents native reload, and cleans up', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  document.documentElement.style.overscrollBehaviorY = 'contain';
  const refresh = jest.fn();
  const status = jest.fn();
  const cleanup = installWebRefresh(refresh, status);
  touch(target, 'touchstart', 30, 20);
  expect(touch(target, 'touchmove', 30, 115).defaultPrevented).toBe(true);
  expect(status).toHaveBeenCalledWith('Release to refresh');
  touch(target, 'touchend', 30, 115, 0);
  expect(refresh).toHaveBeenCalledTimes(1);
  cleanup();
  expect(document.documentElement.style.overscrollBehaviorY).toBe('contain');
  touch(target, 'touchstart', 30, 20);
  touch(target, 'touchmove', 30, 115);
  touch(target, 'touchend', 30, 115, 0);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('leaves horizontal calendar gestures, pinch and canceled touches alone', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const refresh = jest.fn();
  const cleanup = installWebRefresh(refresh, jest.fn());
  touch(target, 'touchstart', 30, 20);
  expect(touch(target, 'touchmove', 100, 115).defaultPrevented).toBe(false);
  touch(target, 'touchend', 100, 115, 0);
  touch(target, 'touchstart', 30, 20);
  touch(target, 'touchmove', 30, 115, 2);
  touch(target, 'touchend', 30, 115, 0);
  touch(target, 'touchstart', 30, 20);
  touch(target, 'touchmove', 30, 115);
  touch(target, 'touchcancel', 30, 115, 0);
  touch(target, 'touchend', 30, 115, 0);
  expect(refresh).not.toHaveBeenCalled();
  cleanup();
});
