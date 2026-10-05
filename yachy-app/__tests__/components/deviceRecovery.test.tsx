import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
const mockStart = jest.fn(), mockVerify = jest.fn(), mockReplace = jest.fn(), mockContinue = jest.fn(), mockDispose = jest.fn();
const mockList = jest.fn(), mockRemove = jest.fn();
jest.mock('../../src/services/deviceManagement', () => ({
  createDeviceRecovery: () => ({ start: mockStart, verify: mockVerify, replace: mockReplace, continueToApp: mockContinue, dispose: mockDispose, resend: jest.fn(), refresh: mockList }),
  listAccountDevices: () => mockList(), removeAccountDevice: (...args: unknown[]) => mockRemove(...args),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({ useThemeColors: () => ({ background:'#fff', surface:'#fff', textPrimary:'#111', textSecondary:'#666', border:'#ddd' }) }));
jest.mock('../../src/components', () => {
  const { TextInput, Pressable, Text } = jest.requireActual('react-native');
  return {
    PageHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
    Input: ({ label, ...props }: { label: string }) => <TextInput accessibilityLabel={label} {...props} />,
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean }) => <Pressable disabled={disabled || loading} onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});
import { LostDeviceScreen } from '../../src/screens/LostDeviceScreen';
import { ManageDevicesScreen } from '../../src/screens/ManageDevicesScreen';
const devices = [{ id:'old', device_name:'Old iPad', platform:'web', last_seen_at:'2026-10-01T12:00:00Z', is_current:false }];
beforeEach(() => {
  jest.clearAllMocks(); mockStart.mockResolvedValue(undefined); mockVerify.mockResolvedValue(devices); mockReplace.mockResolvedValue(undefined);
  mockContinue.mockResolvedValue(undefined); mockDispose.mockResolvedValue(undefined); mockList.mockResolvedValue(devices); mockRemove.mockResolvedValue(undefined);
});
it('requires verification and a selected device before continuing to the app', async () => {
  const screen=render(<LostDeviceScreen />);
  fireEvent.changeText(screen.getByLabelText('Email'),'crew@example.com');
  fireEvent.changeText(screen.getByLabelText('Password'),'password');
  fireEvent.press(screen.getByText('Verify account and send code'));
  await waitFor(() => expect(screen.getByLabelText('Email verification code')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Email verification code'),'123456'); fireEvent.press(screen.getByText('Verify code'));
  await waitFor(() => expect(screen.getByText('Old iPad')).toBeTruthy());
  fireEvent.press(screen.getByText('Remove selected and register this device'));
  expect(mockReplace).not.toHaveBeenCalled(); expect(mockContinue).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Old iPad')); fireEvent.press(screen.getByText('Remove selected and register this device'));
  await waitFor(() => expect(screen.getByText('Continue to Nautical Ops')).toBeTruthy());
  expect(mockReplace).toHaveBeenCalledWith(['old']); expect(mockContinue).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Continue to Nautical Ops')); await waitFor(() => expect(mockContinue).toHaveBeenCalledTimes(1));
});
it('stays in verification when the emailed code fails', async () => {
  mockVerify.mockRejectedValue(new Error('Code expired'));
  const screen=render(<LostDeviceScreen />);
  fireEvent.changeText(screen.getByLabelText('Email'),'crew@example.com'); fireEvent.changeText(screen.getByLabelText('Password'),'password');
  fireEvent.press(screen.getByText('Verify account and send code'));
  await waitFor(() => expect(screen.getByLabelText('Email verification code')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Email verification code'),'123456'); fireEvent.press(screen.getByText('Verify code'));
  await waitFor(() => expect(screen.getByText('Code expired')).toBeTruthy());
  expect(mockReplace).not.toHaveBeenCalled(); expect(screen.queryByText('Continue to Nautical Ops')).toBeNull();
});
it('requires confirmation before removing a saved device in Settings', async () => {
  const screen=render(<ManageDevicesScreen />);
  await waitFor(() => expect(screen.getByText('Old iPad')).toBeTruthy());
  fireEvent.press(screen.getByText('Remove device')); expect(mockRemove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Cancel')); expect(mockRemove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Remove device')); fireEvent.press(screen.getByText('Confirm removal'));
  await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('old'));
  await waitFor(() => expect(screen.queryByText('Old iPad')).toBeNull());
});
it('does not offer to remove the current device', async () => {
  mockList.mockResolvedValue([{...devices[0], is_current:true}]);
  const screen=render(<ManageDevicesScreen />);
  await waitFor(() => expect(screen.getByText('Old iPad · This device')).toBeTruthy());
  expect(screen.queryByText('Remove device')).toBeNull();
});
