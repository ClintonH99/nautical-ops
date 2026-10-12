/** Keep the app shell inside Safari's visible viewport, including keyboard changes.
 * Only the outer document is reset; individual ScrollViews retain their position.
 */
export function installWebViewport(): () => void {
  if (typeof document === 'undefined') return () => {};
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const style = document.createElement('style');
  style.dataset.nauticalViewport = '';
  style.textContent = `
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    #root, div[aria-modal="true"][role="dialog"] {
      position: fixed; left: 0; right: 0; bottom: auto;
      top: var(--nautical-viewport-top, 0px);
      height: var(--nautical-viewport-height, 100%);
      min-height: 0;
    }
  `;
  document.head.appendChild(style);
  let frame = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const isEditing = () => {
    const element = document.activeElement;
    return (
      element instanceof HTMLElement &&
      (element.matches('input, textarea, select') || element.isContentEditable)
    );
  };
  const update = () => {
    frame = 0;
    // Preserve browser pinch zoom. Do not resize/reposition the app under a zoomed user.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = viewport?.height ?? window.innerHeight;
    if (height > 0) root.style.setProperty('--nautical-viewport-height', `${height}px`);
    root.style.setProperty('--nautical-viewport-top', `${Math.max(0, viewport?.offsetTop ?? 0)}px`);
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };
  const settle = () => {
    if (isEditing() || (viewport && Math.abs(viewport.scale - 1) > 0.01)) return;
    // Safari can retain the document pan used to reveal a focused input after
    // the keyboard disappears. Our app scrolls inside ScrollViews, not the body.
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    schedule();
  };
  const onFocusOut = () => {
    timers.forEach(clearTimeout);
    // Sample after blur and after the keyboard animation, even if Safari omits
    // the final resize event (also covers closing a modal with a focused input).
    timers = [0, 150, 350, 700].map((delay) => setTimeout(settle, delay));
  };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', settle);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', onFocusOut);
  update();
  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', settle);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', onFocusOut);
    root.style.removeProperty('--nautical-viewport-height');
    root.style.removeProperty('--nautical-viewport-top');
    style.remove();
  };
}
