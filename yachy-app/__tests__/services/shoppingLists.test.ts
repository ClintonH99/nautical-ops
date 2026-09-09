jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import { normalizeShoppingListItems } from '../../src/services/shoppingLists';

describe('normalizeShoppingListItems', () => {
  it('preserves a saved shopping-item quantity', () => {
    expect(
      normalizeShoppingListItems([{ text: 'Bottles of water', amount: '3', checked: false }])
    ).toEqual([{ text: 'Bottles of water', amount: '3', checked: false }]);
  });

  it('keeps older items without quantities compatible', () => {
    expect(normalizeShoppingListItems([{ text: 'Bread', checked: true }])).toEqual([
      { text: 'Bread', amount: undefined, checked: true },
    ]);
  });
});
