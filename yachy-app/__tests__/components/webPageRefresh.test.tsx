/** @jest-environment jsdom */
import React, { act } from 'react';
import { WebPageRefresh } from '../../src/components/WebPageRefresh.web';
import { installWebRefresh } from '../../src/utils/installWebRefresh';

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

it('provides an accessible refresh button outside screens, confirms and respects offline state', async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  try {
    await act(async () => {
      root.render(<WebPageRefresh />);
    });
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Refresh page');
    expect(installWebRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      button.click();
    });
    expect(mockReload).not.toHaveBeenCalled();
    online.mockReturnValue(false);
    await act(async () => {
      button.click();
    });
    expect(container.querySelector('[role="status"]')!.textContent).toContain('offline');
    online.mockReturnValue(true);
    confirm.mockReturnValue(true);
    await act(async () => {
      button.click();
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    confirm.mockRestore();
    online.mockRestore();
  }
});
