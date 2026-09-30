import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { LeaveVesselRecovery } from '../../src/components/LeaveVesselRecovery';

const mockLeave = jest.fn();
jest.mock('../../src/services/vesselDeparture', () => ({
  leaveVesselForAccount: (...args: unknown[]) => mockLeave(...args),
  isOnlyCaptainError: (message: string) => message.includes('only Captain/MOV'),
  APPOINT_CAPTAIN_TITLE: 'Appoint Another Captain/MOV',
  APPOINT_CAPTAIN_MESSAGE: 'Promote another crew member to Captain/MOV before leaving.',
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ textPrimary: '#111', textSecondary: '#64748b' }),
}));
jest.mock('../../src/components/Button', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    Button: ({ title, onPress, disabled, loading }: any) => (
      <Pressable disabled={disabled || loading} onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../../src/components/Input', () => {
  const { TextInput } = jest.requireActual('react-native');
  return {
    Input: ({ label, ...props }: any) => <TextInput accessibilityLabel={label} {...props} />,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLeave.mockResolvedValue({});
});

it('requires an explicit confirmation and credentials, and cancel performs no mutation', () => {
  const screen = render(<LeaveVesselRecovery />);
  fireEvent.press(screen.getByText('Leave Vessel'));
  expect(screen.getByText(/Your My Sea Miles stays with you/)).toBeTruthy();
  expect(mockLeave).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Confirm and Leave Vessel'));
  expect(screen.getByText(/Enter your account email and password/)).toBeTruthy();
  expect(mockLeave).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Cancel'));
  expect(screen.queryByLabelText('Account password')).toBeNull();
});

it('submits the entered credentials only after confirmation and clears the password', async () => {
  const screen = render(<LeaveVesselRecovery />);
  fireEvent.press(screen.getByText('Leave Vessel'));
  fireEvent.changeText(screen.getByLabelText('Account email'), ' crew@example.com ');
  fireEvent.changeText(screen.getByLabelText('Account password'), 'secret');
  fireEvent.press(screen.getByText('Confirm and Leave Vessel'));
  await waitFor(() =>
    expect(mockLeave).toHaveBeenCalledWith({ email: 'crew@example.com', password: 'secret' })
  );
  await waitFor(() => expect(screen.getByLabelText('Account password').props.value).toBe(''));
});

it('explains the last-captain restriction instead of showing a generic support error', async () => {
  mockLeave.mockRejectedValue(new Error('You are the only Captain/MOV on this vessel.'));
  const screen = render(<LeaveVesselRecovery requiresSignIn={false} />);
  fireEvent.press(screen.getByText('Leave Vessel'));
  expect(screen.queryByLabelText('Account password')).toBeNull();
  fireEvent.press(screen.getByText('Confirm and Leave Vessel'));
  await waitFor(() => expect(screen.getByText(/Appoint Another Captain\/MOV/)).toBeTruthy());
  expect(mockLeave).toHaveBeenCalledWith(undefined);
});

it('blocks duplicate submissions and cancel during the request', async () => {
  let resolve!: () => void;
  mockLeave.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  const screen = render(<LeaveVesselRecovery requiresSignIn={false} />);
  fireEvent.press(screen.getByText('Leave Vessel'));
  fireEvent.press(screen.getByText('Confirm and Leave Vessel'));
  fireEvent.press(screen.getByText('Confirm and Leave Vessel'));
  fireEvent.press(screen.getByText('Cancel'));
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Leave your vessel?')).toBeTruthy();
  await act(async () => resolve());
});
