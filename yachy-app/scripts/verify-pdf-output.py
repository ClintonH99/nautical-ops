"""Validate rendered fixtures (pdfplumber), including page text and content bounds."""
import json
import sys
from pathlib import Path
import pdfplumber

folder = Path(sys.argv[1])
manifest = json.loads((folder / 'manifest.json').read_text())
page_count = 0
for fixture in manifest:
    with pdfplumber.open(folder / (fixture['name'] + '.pdf')) as document:
        all_text = ''
        for number, page in enumerate(document.pages, 1):
            page_count += 1
            text = page.extract_text() or ''
            all_text += text
            assert 'NAUTICAL OPS' in text, (fixture['name'], number, 'missing brand')
            assert fixture['title'] in text, (fixture['name'], number, 'missing title')
            footer = f"Page {number} of {len(document.pages)}"
            if len(document.pages) > 1:
                assert footer in text, (fixture['name'], number, 'wrong numbering')
                words = page.extract_words()
                page_word = [w for w in words if w['text'] == 'Page' and w['top'] > page.height - 32]
                assert page_word and page_word[0]['x0'] > page.width / 2
            else:
                assert 'Page 1 of 1' not in text
            body = [c for c in page.chars if c['top'] > (85 if fixture.get('headerInContent') else 71) and c['bottom'] < page.height - 31]
            assert body, (fixture['name'], number, 'blank body page')
            # Compact shared header ends above 61pt; body begins at 72pt.
            bad = [c for c in page.chars if c['text'].strip() and
                   (c['x0'] < 34 or c['x1'] > page.width - 34 or
                    (not fixture.get('headerInContent') and 61 < c['top'] < 70) or (page.height - 31 < c['bottom'] < page.height - 24))]
            assert not bad, (fixture['name'], number, 'out of bounds', ''.join(c['text'] for c in bad[:50]))
        if fixture['name'] == 'rules-oversized-line':
            assert 'LAST-CONTENT-MARKER' in all_text, 'Long rule was truncated'
        if fixture['name'].startswith('fuel-'):
            for excluded in ['Tank allocation', 'Logged by', 'Total fuel', 'Total cost']:
                assert excluded not in all_text, (fixture['name'], 'unapproved fuel field', excluded)
        if fixture['name'] == 'fuel-approved-short':
            for value in ['LMC', 'Port Louis Marina', '3,558 US gal', '6,200 L', '$28,748.64', '$8,804.00', 'Refuelled before departure.', 'Fuel delivery completed.']:
                assert value in all_text, ('fuel receipt missing field', value)
        if fixture['name'] == 'fuel-oversized-comment':
            assert 'END-FUEL-COMMENT' in ''.join(all_text.split()), 'Fuel comment was truncated'
        if fixture['name'].startswith('rest-month-') or fixture['name'].startswith('rest-limit-'):
            days = int(fixture['name'].split('-')[2]) if fixture['name'].startswith('rest-month-') else 31
            for day in range(1, days + 1):
                assert f'2026/10/{day:02d}' in all_text, (fixture['name'], 'missing day', day)
            assert 'Signature of Master' in all_text and 'Signature of Seafarer' in all_text
        if fixture['name'].endswith('-long') and not fixture['name'].startswith('rest-'):
            # Every test record appears, including the final one, after pagination.
            assert 'ITEM-070' in all_text, (fixture['name'], 'missing last record')
print(f"Verified {len(manifest)} PDFs / {page_count} pages: headers, numbers, no blank bodies, bounds and final records.")
