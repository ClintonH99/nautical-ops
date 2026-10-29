/** @jest-environment jsdom */
import React, { act } from 'react';
import { WebPageRefresh } from '../../src/components/WebPageRefresh.web';
import { installWebRefresh } from '../../src/utils/installWebRefresh';
import { usesPullRefreshOnly } from '../../src/utils/refreshDevice';

const { createRoot } = jest.requireActual<{
  createRoot(container: Element): {
    render(children: React.ReactNode): void;
    unmount(): void;
  };
}>('react-dom/client');

const mockReload = jest.fn();
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ surface: '#fff', textPrimary: '#123456', border: '#ddd' }),
}));
jest.mock('../../src/utils/installWebRefresh', () => {
  const actual = jest.requireActual('../../src/utils/installWebRefresh');
  return {
    ...actual,
    installWebRefresh: jest.fn(() => jest.fn()),
    createPageRefresh: (actions: object) =>
      actual.createPageRefresh({ ...actions, reload: mockReload }),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ uri: '/test-boat-logo.png' }) },
}));

it('provides the desktop navy pill, respects offline state and reloads without a prompt', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const confirm = jest.spyOn(window, 'confirm');
  const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  try {
    await act(async () => {
      root.render(<WebPageRefresh />);
    });
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Refresh page');
    expect(button.style.background).toBe('rgb(30, 58, 138)');
    expect(button.style.color).toBe('rgb(255, 255, 255)');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(installWebRefresh).not.toHaveBeenCalled();
    online.mockReturnValue(false);
    await act(async () => {
      button.click();
    });
    expect(container.querySelector('[role="status"]')!.textContent).toContain('offline');
    expect(mockReload).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(async () => {
      button.click();
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    confirm.mockRestore();
    online.mockRestore();
  }
});

it.each([
  ['iPhone', 'iPhone', 5],
  ['Android', 'Linux armv8l', 5],
  ['Macintosh', 'MacIntel', 5],
])(
  'shows the top boat on %s, then reloads without a prompt',
  async (userAgent, platform, maxTouchPoints) => {
    jest.useFakeTimers();
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    const ua = jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    const pf = jest.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
    const previous = Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints');
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: maxTouchPoints,
    });
    const confirm = jest.spyOn(window, 'confirm');
    const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<WebPageRefresh />));
      expect(container.querySelector('button')).toBeNull();
      expect(installWebRefresh).toHaveBeenCalledTimes(1);
      const pullRefresh = jest.mocked(installWebRefresh).mock.calls[0][0];
      const status = jest.mocked(installWebRefresh).mock.calls[0][1];
      expect(container.querySelector('[data-refresh-indicator]')).toBeNull();
      await act(async () => status('Pull down to refresh'));
      const boat = container.querySelector<HTMLElement>('[data-refresh-indicator="boat"]')!;
      expect(boat.style.left).toBe('50%');
      expect(boat.style.position).toBe('fixed');
      expect(boat.querySelector('img')!.getAttribute('src')).toBe('/test-boat-logo.png');
      expect(boat.querySelector('[data-refreshing="false"]')).not.toBeNull();
      expect(container.querySelector('[data-refresh-feedback]')).toBeNull();
      await act(async () => status('Release to refresh'));
      expect(boat.textContent).toBe('Release to refresh');
      expect(container.querySelector('[data-refresh-feedback]')).toBeNull();
      await act(async () => status(''));
      expect(container.querySelector('[data-refresh-indicator]')).toBeNull();
      online.mockReturnValue(false);
      await act(async () => pullRefresh());
      expect(container.querySelector('[data-refresh-indicator]')).toBeNull();
      expect(container.querySelector('[role="status"]')!.textContent).toContain('offline');
      await act(async () => jest.advanceTimersByTime(500));
      expect(mockReload).not.toHaveBeenCalled();
      online.mockReturnValue(true);
      await act(async () => pullRefresh());
      expect(mockReload).not.toHaveBeenCalled();
      expect(container.querySelector('[data-refreshing="true"]')).not.toBeNull();
      expect(container.querySelector('[data-refresh-feedback]')).toBeNull();
      await act(async () => status(''));
      expect(container.querySelector('[data-refreshing="true"]')).not.toBeNull();
      await act(async () => jest.advanceTimersByTime(200));
      expect(mockReload).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
      expect(container.querySelector('[role="status"]')!.textContent).toBe('Refreshing…');
      expect(container.querySelector('style')!.textContent).toContain('prefers-reduced-motion');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      ua.mockRestore();
      pf.mockRestore();
      confirm.mockRestore();
      online.mockRestore();
      if (previous) Object.defineProperty(window.navigator, 'maxTouchPoints', previous);
      else Reflect.deleteProperty(window.navigator, 'maxTouchPoints');
      jest.useRealTimers();
    }
  }
);

it('cancels a pending mobile reload when the shell unmounts', async () => {
  jest.useFakeTimers();
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const ua = jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<WebPageRefresh />));
    await act(async () => jest.mocked(installWebRefresh).mock.calls[0][0]());
    expect(mockReload).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    jest.runAllTimers();
    expect(mockReload).not.toHaveBeenCalled();
    ua.mockRestore();
    online.mockRestore();
    jest.useRealTimers();
  }
});

it.each([
  ['iPhone', 'iPhone', 5, false, true],
  ['Android tablet', 'Linux', 5, false, true],
  ['Macintosh', 'MacIntel', 5, false, true],
  ['Macintosh', 'MacIntel', 0, false, false],
  ['Windows', 'Win32', 10, false, false],
  ['Windows', 'Win32', 10, true, true],
])(
  'classifies %s / %s / touch=%s / touch-first=%s',
  (userAgent, platform, maxTouchPoints, touchFirst, expected) => {
    expect(usesPullRefreshOnly({ userAgent, platform, maxTouchPoints }, touchFirst)).toBe(expected);
  }
);
