import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Keyboard } from 'react-native';
import { ForgotPasswordScreen } from '../../src/screens/ForgotPasswordScreen';
import authService from '../../src/services/auth';

const mockDefer = jest.fn();
jest.mock('../../src/store', () => ({
  useAuthStore: (selector: any) => selector({ setDeferUserUpdate: mockDefer }),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({ useThemeColors: () => ({}) }));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: {
    sendPasswordResetCode: jest.fn(async () => {}),
    verifyPasswordResetCode: jest.fn(async () => {}),
    updatePassword: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
  },
}));
jest.mock('../../src/components', () => {
  const { Text, TextInput, Pressable } = require('react-native');
  return {
    PageHeader: () => null,
    Input: ({ label, ...props }: any) => <TextInput accessibilityLabel={label} {...props} />,
    Button: ({ title, onPress, disabled }: any) => (
      <Pressable onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});

test('one password write and one success dialog; OK resets to Login without another submit', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const navigation = { reset: jest.fn(), navigate: jest.fn() };
  const ui = render(<ForgotPasswordScreen navigation={navigation} />);
  fireEvent.changeText(ui.getByLabelText('Email'), 'test@example.com');
  await act(async () => {
    fireEvent.press(ui.getByText('Send code'));
  });
  fireEvent.changeText(ui.getByLabelText('6-digit code'), '123456');
  await act(async () => {
    fireEvent.press(ui.getByText('Verify code'));
  });
  fireEvent.changeText(ui.getByLabelText('New password'), 'example-test-password');
  fireEvent.changeText(ui.getByLabelText('Confirm new password'), 'example-test-password');
  await act(async () => {
    fireEvent(ui.getByLabelText('Confirm new password'), 'submitEditing');
    fireEvent.press(ui.getByText('Update password'));
  });
  expect(authService.updatePassword).toHaveBeenCalledTimes(1);
  expect(authService.signOut).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalled();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(navigation.reset).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(ui.getByText('Update password'));
  });
  expect(alert).toHaveBeenCalledTimes(1);
  act(() => {
    alert.mock.calls[0][2]?.[0].onPress?.();
  });
  expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
  ui.unmount();
  jest.restoreAllMocks();
});
