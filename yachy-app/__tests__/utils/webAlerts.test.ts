/** @jest-environment jsdom */
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../../src/store', () => ({
  useThemeStore: { getState: () => ({ backgroundTheme: 'night' }) },
  BACKGROUND_THEMES: {
    night: {
      surface: '#123',
      textPrimary: '#fff',
      textSecondary: '#ddd',
      border: '#456',
      control: '#123',
      borderStrong: '#ccc',
    },
  },
}));
import { Alert } from 'react-native';
import { installWebAlerts } from '../../src/utils/installWebAlerts.web';

describe('browser Alert adapter', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    installWebAlerts();
  });
  const click = (label: string) => {
    const button = Array.from(document.querySelectorAll('dialog button')).find(
      (item) => item.textContent === label
    ) as HTMLButtonElement;
    expect(button).toBeDefined();
    button.click();
  };
  it('requires explicit confirmation and preserves callbacks', () => {
    const remove = jest.fn();
    Alert.alert('Delete log', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: remove },
    ]);
    expect(remove).not.toHaveBeenCalled();
    click('Cancel');
    expect(remove).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    Alert.alert('Delete log', '', [{ text: 'Delete', onPress: remove }]);
    click('Delete');
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('renders untrusted messages as text, never HTML', () => {
    Alert.alert('<img src=x onerror=alert(1)>', '<script>bad()</script>');
    expect(document.querySelector('dialog img')).toBeNull();
    expect(document.querySelector('dialog p')?.textContent).toContain('<script>');
    click('OK');
  });
  it('supports multi-choice filters and queues subsequent alerts', () => {
    const select = jest.fn();
    Alert.alert('Filter', '', [
      { text: 'All' },
      { text: 'Permanent', onPress: select },
      { text: 'Rotational' },
      { text: 'Cancel', style: 'cancel' },
    ]);
    Alert.alert('Next', 'Ready');
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    click('Permanent');
    expect(select).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog h2')?.textContent).toBe('Next');
    click('OK');
  });
  it('Escape cancels without invoking the destructive callback', () => {
    const remove = jest.fn();
    Alert.alert('Delete?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', onPress: remove },
    ]);
    document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(remove).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });
});
