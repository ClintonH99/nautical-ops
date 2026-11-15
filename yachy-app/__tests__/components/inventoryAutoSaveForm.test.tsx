import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { InventoryAutoSaveQueue } from '../../src/utils/inventoryAutoSaveQueue';
import { AddEditInventoryItemScreen } from '../../src/screens/AddEditInventoryItemScreen';

let mockQueue: InventoryAutoSaveQueue;
let mockDark = false;
const mockUser = { id: 'u1', vesselId: 'v1', department: 'INTERIOR', name: 'Crew' };
jest.mock('../../src/store', () => ({ useAuthStore: () => ({ user: mockUser }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'stable-id' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    background: mockDark ? '#111' : '#fff',
    surface: mockDark ? '#222' : '#fff',
    textPrimary: mockDark ? '#fff' : '#111',
    textSecondary: mockDark ? '#eee' : '#333',
    border: '#777',
  }),
}));
jest.mock('../../src/services/inventory', () => ({
  __esModule: true,
  default: { getFreshById: jest.fn(), delete: jest.fn(), offlineEnabled: () => false },
}));
jest.mock('../../src/components/ScreenLoading', () => ({ ScreenLoading: () => null }));
jest.mock('../../src/hooks/useInventoryAutoSave', () => ({
  useInventoryAutoSave: () => {
    const { useSyncExternalStore } = require('react');
    return {
      queue: mockQueue,
      state: useSyncExternalStore(
        mockQueue.subscribe,
        mockQueue.getSnapshot,
        mockQueue.getSnapshot
      ),
    };
  },
}));
jest.mock('../../src/components', () => {
  const { TextInput, Text, Pressable } = require('react-native');
  return {
    Input: ({ label, ...props }: { label: string }) => (
      <TextInput accessibilityLabel={label} {...props} />
    ),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    PageHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
    DepartmentSelector: () => null,
    EnterToAddHint: () => null,
  };
});

beforeEach(async () => {
  jest.useFakeTimers();
  mockDark = false;
  mockQueue = new InventoryAutoSaveQueue({
    read: async () => null,
    write: async () => {},
    canSync: () => true,
    save: async (entry, attempt) => ({
      ...attempt.values,
      id: entry.id,
      vesselId: 'v1',
      createdAt: '',
      lastEditedAt: '2026-09-25T00:00:00Z',
    }),
  });
  await mockQueue.load();
});
afterEach(() => jest.useRealTimers());

it.each([false, true])(
  'saves without a publish button and leaves the user in place (night=%s)',
  async (dark) => {
    mockDark = dark;
    const navigation = { goBack: jest.fn() };
    const ui = render(<AddEditInventoryItemScreen navigation={navigation} route={{}} />);
    await act(async () => {});
    expect(ui.getByText('Disable Auto Save')).toBeTruthy();
    fireEvent.changeText(ui.getByLabelText('Title'), 'Deck Supplies');
    fireEvent.changeText(ui.getByPlaceholderText('0'), '12');
    fireEvent.changeText(ui.getByPlaceholderText('Inventory item'), 'Brushes');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
    expect(ui.getByText('Saved')).toBeTruthy();
    expect(mockQueue.getSnapshot().entries['stable-id'].base?.items).toEqual([
      { amount: '12', item: 'Brushes' },
    ]);
    expect(ui.queryByText('Save Changes')).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  }
);

it('offers manual saving when disabled and resumes auto saving when enabled', async () => {
  const ui = render(<AddEditInventoryItemScreen navigation={{ goBack: jest.fn() }} route={{}} />);
  await act(async () => {});
  fireEvent.press(ui.getByText('Disable Auto Save'));
  fireEvent.changeText(ui.getByLabelText('Title'), 'Supplies');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(700);
  });
  expect(mockQueue.getSnapshot().entries['stable-id'].base).toBeNull();
  expect(ui.getByText('Enable Auto Save')).toBeTruthy();
  fireEvent.press(ui.getByText('Enable Auto Save'));
  await act(async () => {});
  expect(ui.getByText('Saved')).toBeTruthy();
});

it('keeps the composer at the top, removes every added row, and can add again', async () => {
  const ui = render(<AddEditInventoryItemScreen navigation={{ goBack: jest.fn() }} route={{}} />);
  await act(async () => {});
  fireEvent.changeText(ui.getByLabelText('Title'), 'Top-entry test');
  fireEvent.changeText(ui.getAllByPlaceholderText('Inventory item')[0], 'Rope');
  fireEvent.press(ui.getByText('Add Item'));
  expect(ui.getAllByPlaceholderText('Inventory item').map((input) => input.props.value)).toEqual([
    '',
    'Rope',
  ]);
  fireEvent.changeText(ui.getAllByPlaceholderText('Inventory item')[0], 'Brush');
  fireEvent.press(ui.getByText('Add Item'));
  expect(ui.getAllByPlaceholderText('Inventory item').map((input) => input.props.value)).toEqual([
    '',
    'Brush',
    'Rope',
  ]);
  fireEvent.press(ui.getByLabelText('Remove item 3'));
  fireEvent.press(ui.getByLabelText('Remove item 2'));
  expect(ui.getAllByPlaceholderText('Inventory item').map((input) => input.props.value)).toEqual([
    '',
  ]);
  fireEvent.changeText(ui.getByPlaceholderText('Inventory item'), 'New rope');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(700);
  });
  expect(mockQueue.getSnapshot().entries['stable-id'].base?.items).toEqual([
    { amount: '', item: 'New rope' },
  ]);
});
