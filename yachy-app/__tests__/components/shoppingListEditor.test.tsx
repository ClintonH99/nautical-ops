import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AddEditShoppingListScreen } from '../../src/screens/AddEditShoppingListScreen';
import shoppingListsService from '../../src/services/shoppingLists';
const mockUser = { id: 'u1', vesselId: 'v1', department: 'BRIDGE' };
jest.mock('../../src/store', () => ({ useAuthStore: () => ({ user: mockUser }) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/hooks/useThemeColors', () => ({ useThemeColors: () => ({}) }));
jest.mock('../../src/offline/shoppingService', () => ({
  offlineShopping: { enabled: () => true },
}));
jest.mock('../../src/services/shoppingLists', () => ({
  __esModule: true,
  default: { getByVessel: jest.fn(), create: jest.fn(), update: jest.fn() },
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
    PageHeader: () => null,
    DepartmentSelector: () => null,
    EnterToAddHint: () => null,
    LoadingSpinner: () => null,
    PreviewActionButtons: () => null,
  };
});
const navigation = { goBack: jest.fn(), canGoBack: () => true };
beforeEach(() => jest.clearAllMocks());
it('keeps new entry above added rows and can remove the last saved row then add another', async () => {
  const ui = render(<AddEditShoppingListScreen navigation={navigation} route={{}} />);
  await act(async () => {});
  fireEvent.changeText(ui.getByLabelText('Item name 1'), 'Rope');
  fireEvent.press(ui.getByText('Add Item'));
  expect(ui.getAllByPlaceholderText('Shopping item').map((input) => input.props.value)).toEqual([
    '',
    'Rope',
  ]);
  fireEvent.changeText(ui.getByLabelText('Item name 1'), 'Brush');
  fireEvent.press(ui.getByText('Add Item'));
  expect(ui.getAllByPlaceholderText('Shopping item').map((input) => input.props.value)).toEqual([
    '',
    'Brush',
    'Rope',
  ]);
  fireEvent.press(ui.getByLabelText('Remove item 3'));
  fireEvent.press(ui.getByLabelText('Remove item 2'));
  fireEvent.changeText(ui.getByLabelText('Item name 1'), 'New rope');
  expect(ui.getAllByPlaceholderText('Shopping item').map((input) => input.props.value)).toEqual([
    'New rope',
  ]);
});
it('editing and removing rows preserves existing checkmarks and supplies the original base', async () => {
  const original = {
    id: 's1',
    title: 'Supplies',
    department: 'BRIDGE',
    items: [
      { text: 'Keep', checked: true },
      { text: 'Remove', checked: false },
    ],
    offlineLocalVersion: 3,
  };
  (shoppingListsService.getByVessel as jest.Mock).mockResolvedValue([original]);
  (shoppingListsService.update as jest.Mock).mockImplementation(async (_id, change) => ({
    ...original,
    ...change,
    offlineLocalVersion: 5,
  }));
  const ui = render(
    <AddEditShoppingListScreen navigation={navigation} route={{ params: { listId: 's1' } }} />
  );
  await act(async () => {});
  fireEvent.press(ui.getByLabelText('Remove item 3'));
  await act(async () => {
    fireEvent.press(ui.getByText('Save Changes'));
  });
  expect(shoppingListsService.update).toHaveBeenCalledWith(
    's1',
    { title: 'Supplies', items: [{ text: 'Keep', amount: undefined, checked: true }] },
    3,
    { title: 'Supplies', items: original.items }
  );
});
