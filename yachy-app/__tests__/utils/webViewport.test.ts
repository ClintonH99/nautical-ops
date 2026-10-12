/** @jest-environment jsdom */
import { installWebViewport } from '../../src/utils/installWebViewport.web';

describe('web keyboard viewport recovery', () => {
  let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
  let dispose: () => void;
  const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  beforeEach(() => {
    jest.useFakeTimers();
    viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    dispose = installWebViewport();
  });
  afterEach(() => {
    dispose();
    document.body.innerHTML = '';
    if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport);
    else Reflect.deleteProperty(window, 'visualViewport');
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const height = () =>
    document.documentElement.style.getPropertyValue('--nautical-viewport-height');
  it('tracks keyboard, browser-toolbar and orientation resizes', () => {
    expect(height()).toBe('800px');
    viewport.height = 420;
    viewport.offsetTop = 50;
    viewport.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(20);
    expect(height()).toBe('420px');
    expect(document.documentElement.style.getPropertyValue('--nautical-viewport-top')).toBe('50px');
    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(20);
    expect(height()).toBe('800px');
  });
  it('recovers after blur even when the final viewport resize event is missing', () => {
    viewport.height = 420;
    viewport.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(20);
    const scroller = document.createElement('div');
    scroller.scrollTop = 125;
    document.body.append(scroller);
    document.dispatchEvent(new Event('focusout'));
    jest.advanceTimersByTime(200);
    viewport.height = 800;
    jest.advanceTimersByTime(600);
    expect(height()).toBe('800px');
    expect(scroller.scrollTop).toBe(125);
  });
  it('does not reset the document while focus moves to another input', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    document.dispatchEvent(new Event('focusout'));
    jest.advanceTimersByTime(800);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('does not resize the app underneath pinch zoom', () => {
    viewport.scale = 2;
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(20);
    expect(height()).toBe('800px');
  });
  it('cleans up listeners, pending work and shell styles', () => {
    document.dispatchEvent(new Event('focusout'));
    dispose();
    viewport.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(800);
    expect(height()).toBe('');
    expect(document.querySelector('[data-nautical-viewport]')).toBeNull();
  });
});
