import { createPullToRefresh } from './pullToRefresh';

const INTERACTIVE = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'canvas',
  'iframe',
  'svg',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="spinbutton"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[data-refresh-ignore="true"]',
].join(',');

export function isRefreshStartAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(INTERACTIVE)) return false;
  if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.01) return false;
  if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))
    return false;
  // Check every containing scroller, including RN Web's nested ScrollViews.
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node.scrollTop > 1) return false;
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return false;
  }
  return window.scrollY <= 1;
}

export function createPageRefresh(actions: {
  online: () => boolean;
  reload: () => void;
  status: (message: string) => void;
}) {
  let reloading = false;
  return () => {
    if (reloading) return;
    if (!actions.online()) {
      actions.status(
        'You’re offline. Reconnect before refreshing; your current page has been kept.'
      );
      return;
    }
    reloading = true;
    actions.status('Refreshing…');
    try {
      actions.reload();
    } catch {
      reloading = false;
      actions.status('Could not refresh. Please try again.');
    }
  };
}

/** One shared gesture listener; no per-screen reload handlers or auth changes. */
export function installWebRefresh(refresh: () => void, status: (text: string) => void) {
  const gesture = createPullToRefresh();
  let startY: number | null = null;
  let startX = 0;
  let blocked = false;
  const reset = () => {
    gesture.cancel();
    startY = null;
    status('');
  };
  const start = (event: TouchEvent) => {
    reset();
    blocked = event.touches.length !== 1 || !isRefreshStartAllowed(event.target);
    if (blocked) return;
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    gesture.start(startX, startY, 0, 1);
  };
  const move = (event: TouchEvent) => {
    if (startY === null || blocked) return;
    const touch = event.touches[0];
    if (
      !touch ||
      event.touches.length !== 1 ||
      Math.abs(touch.clientX - startX) > 24 ||
      touch.clientY < startY - 8
    ) {
      blocked = true;
      reset();
      return;
    }
    gesture.move(touch.clientX, touch.clientY, event.touches.length);
    const distance = touch.clientY - startY;
    if (distance > 12) {
      // Avoid a second native reload and preserve our offline/gesture safeguards.
      if (event.cancelable) event.preventDefault();
      status(distance >= 85 ? 'Release to refresh' : 'Pull down to refresh');
    }
  };
  const end = () => {
    const shouldRefresh = gesture.end();
    startY = null;
    if (blocked) return;
    status('');
    if (shouldRefresh) refresh();
  };
  // Prevent native document pull-to-refresh on excluded gestures too. Ordinary
  // nested scrolling remains enabled. Restore styles when this shell unmounts.
  const nodes = [document.documentElement, document.body];
  const previous = nodes.map((node) => node.style.overscrollBehaviorY);
  nodes.forEach((node) => {
    node.style.overscrollBehaviorY = 'none';
  });
  document.addEventListener('touchstart', start, { capture: true, passive: true });
  document.addEventListener('touchmove', move, { capture: true, passive: false });
  document.addEventListener('touchend', end, true);
  document.addEventListener('touchcancel', reset, true);
  return () => {
    document.removeEventListener('touchstart', start, true);
    document.removeEventListener('touchmove', move, true);
    document.removeEventListener('touchend', end, true);
    document.removeEventListener('touchcancel', reset, true);
    nodes.forEach((node, index) => {
      node.style.overscrollBehaviorY = previous[index];
    });
  };
}
