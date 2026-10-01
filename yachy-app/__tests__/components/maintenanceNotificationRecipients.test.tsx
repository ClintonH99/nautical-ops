import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MaintenanceNotificationRecipients } from '../../src/components/MaintenanceNotificationRecipients';
import {
  getMaintenanceRecipients,
  setMaintenanceRecipients,
} from '../../src/services/maintenanceNotifications';
let mockDark = false;
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    textPrimary: mockDark ? '#fff' : '#111',
    textSecondary: '#888',
    surface: mockDark ? '#222' : '#fff',
    accent: mockDark ? '#fff' : '#203a84',
    border: '#888',
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/services/maintenanceNotifications', () => ({
  getMaintenanceRecipients: jest.fn(),
  setMaintenanceRecipients: jest.fn(),
}));
const snapshot = {
  crew: [
    { id: 'captain-id', name: 'John Doe' },
    { id: 'deckhand-id', name: 'Alex Smith' },
    { id: 'stew-id', name: 'Jane Brown' },
  ],
  recipientIds: ['captain-id'],
  revision: 7,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockDark = false;
  (getMaintenanceRecipients as jest.Mock).mockResolvedValue(snapshot);
  (setMaintenanceRecipients as jest.Mock).mockResolvedValue(undefined);
});
const open = async () => {
  const ui = render(<MaintenanceNotificationRecipients vesselId="vessel" />);
  expect(getMaintenanceRecipients).not.toHaveBeenCalled(); // no extra page-load fetch
  await act(async () => fireEvent.press(ui.getByLabelText('Maintenance Notifications')));
  return ui;
};
it.each([false, true])('selects named people and saves their IDs (dark=%s)', async (dark) => {
  mockDark = dark;
  const ui = await open();
  expect(ui.getByRole('checkbox', { name: 'John Doe' }).props.accessibilityState.checked).toBe(
    true
  );
  fireEvent.press(ui.getByRole('checkbox', { name: 'Alex Smith' }));
  await act(async () => fireEvent.press(ui.getByText('Save Recipients')));
  expect(setMaintenanceRecipients).toHaveBeenCalledWith('vessel', ['captain-id', 'deckhand-id'], 7);
  expect(ui.getByText('Notification recipients saved.')).toBeTruthy();
});
it('searches by name and Cancel does not save changes', async () => {
  const ui = await open();
  fireEvent.changeText(ui.getByLabelText('Search crew by name'), 'Alex');
  expect(ui.queryByRole('checkbox', { name: 'John Doe' })).toBeNull();
  fireEvent.press(ui.getByRole('checkbox', { name: 'Alex Smith' }));
  fireEvent.press(ui.getByText('Cancel'));
  expect(setMaintenanceRecipients).not.toHaveBeenCalled();
});
it('allows an empty selection and clearly explains that nobody will be notified', async () => {
  const ui = await open();
  fireEvent.press(ui.getByRole('checkbox', { name: 'John Doe' }));
  expect(
    ui.getByText('No recipients selected. No Maintenance Log notifications will be sent.')
  ).toBeTruthy();
  await act(async () => fireEvent.press(ui.getByText('Save Recipients')));
  expect(setMaintenanceRecipients).toHaveBeenCalledWith('vessel', [], 7);
});
it('drops departed crew from the draft and loads fresh data each time', async () => {
  (getMaintenanceRecipients as jest.Mock).mockResolvedValue({
    ...snapshot,
    recipientIds: ['captain-id', 'departed'],
  });
  const ui = await open();
  expect(ui.getByText(/1 crew member selected/)).toBeTruthy();
  fireEvent.press(ui.getByText('Cancel'));
  await act(async () => fireEvent.press(ui.getByLabelText('Maintenance Notifications')));
  expect(getMaintenanceRecipients).toHaveBeenCalledTimes(2);
});
it('keeps the dialog open and requires reload when recipients changed elsewhere', async () => {
  (setMaintenanceRecipients as jest.Mock).mockRejectedValue(
    new Error('Recipients changed. Reload the crew list before saving.')
  );
  const ui = await open();
  await act(async () => fireEvent.press(ui.getByText('Save Recipients')));
  expect(
    ui.getByText('The crew or recipient list has changed. Reload the crew list before saving.')
  ).toBeTruthy();
  expect(ui.queryByText('Notification recipients saved.')).toBeNull();
  await act(async () => fireEvent.press(ui.getByText('Reload crew list')));
  expect(getMaintenanceRecipients).toHaveBeenCalledTimes(2);
});
it('shows a recoverable loading error without pretending an empty list is saved', async () => {
  (getMaintenanceRecipients as jest.Mock).mockRejectedValue(new Error('offline'));
  const ui = await open();
  expect(ui.getByText('Could not load the crew list. Please try again.')).toBeTruthy();
  await act(async () => fireEvent.press(ui.getByText('Save Recipients')));
  expect(setMaintenanceRecipients).not.toHaveBeenCalled();
});
