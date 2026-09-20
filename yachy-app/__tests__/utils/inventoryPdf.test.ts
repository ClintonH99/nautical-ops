jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));

import { buildInventoryHtml } from '../../src/utils/inventoryPdf';
import type { InventoryItem } from '../../src/services/inventory';

describe('Inventory PDF layout', () => {
  it('keeps the Item column centered and escapes item content', () => {
    const items: InventoryItem[] = [
      {
        id: 'inventory-1',
        vesselId: 'vessel-1',
        department: 'ENGINEERING',
        title: 'Engine spares',
        location: 'Workshop',
        description: '',
        items: [{ amount: '2', item: 'Filter <large>' }],
        createdAt: '2026-09-21T00:00:00Z',
      },
    ];

    const html = buildInventoryHtml(items);

    expect(html).toContain('table-layout: fixed');
    expect(html).toContain(
      '.items-table th:nth-child(2), .items-table td:nth-child(2) { width: 72%; text-align: center;'
    );
    expect(html).toContain('Filter &lt;large&gt;');
    expect(html).not.toContain('Filter <large>');
  });
});
