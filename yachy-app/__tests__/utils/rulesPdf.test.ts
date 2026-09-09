jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));

import { buildRulesPdfHtml } from '../../src/utils/rulesPdf';

describe('Rules On-Board PDF', () => {
  it('combines selected Rules boards into one escaped document', () => {
    const html = buildRulesPdfHtml([
      { title: 'Deck & Exterior', rules: ['Wear PPE', 'Report <damage>'] },
      { title: 'Interior', rules: ['Guests first'] },
    ]);

    expect(html).toContain('Rules On-Board');
    expect(html).toContain('Deck &amp; Exterior');
    expect(html).toContain('Report &lt;damage&gt;');
    expect(html).toContain('Interior');
    expect(html).not.toContain('Report <damage>');
  });
});
