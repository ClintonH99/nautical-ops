import { PDFDocument, PDFPage } from 'pdf-lib';
import { brandPdf } from '../../src/utils/pdfBranding';
import { PDF_LAYOUT, pdfPrintOptions, preparePdfHtml } from '../../src/utils/pdfLayout';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('shared PDF standard', () => {
  it('only stamps page numbers when Hours of Rest supplies its own repeating header', async () => {
    const source = await PDFDocument.create();
    source.addPage([841.89, 595.28]);
    source.addPage([841.89, 595.28]);
    const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
    const drawImage = jest.spyOn(PDFPage.prototype, 'drawImage');
    try {
      await brandPdf(
        await source.save(),
        'Hours of Work and Rest',
        readFileSync(resolve(__dirname, '../../assets/sea-miles-pdf-logo-source.png')),
        true
      );
      expect(drawImage).not.toHaveBeenCalled();
      expect(drawText.mock.calls.map(([text]) => text)).toEqual(['Page 1 of 2', 'Page 2 of 2']);
    } finally {
      drawText.mockRestore();
      drawImage.mockRestore();
    }
  });
  it.each(['portrait', 'landscape'] as const)(
    'centres the logo, brand and title independently on every %s page',
    async (orientation) => {
      const { width, height } = PDF_LAYOUT[orientation];
      const source = await PDFDocument.create();
      source.addPage([width, height]);
      source.addPage([width, height]);
      const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
      const drawImage = jest.spyOn(PDFPage.prototype, 'drawImage');
      try {
        await brandPdf(
          await source.save(),
          'Shipyard List',
          readFileSync(resolve(__dirname, '../../assets/sea-miles-pdf-logo-source.png'))
        );
        for (const [, options] of drawImage.mock.calls) {
          expect(options!.x! + options!.width! / 2).toBeCloseTo(width / 2, 5);
          expect(options!.y).toBe(height - 40);
        }
        const headings = drawText.mock.calls.filter(([text]) => !text.startsWith('Page '));
        expect(headings).toHaveLength(4);
        for (const [text, options] of headings) {
          const textWidth = options!.font!.widthOfTextAtSize(text, options!.size!);
          expect(options!.x! + textWidth / 2).toBeCloseTo(width / 2, 5);
          expect(options!.y).toBe(height - (text === 'NAUTICAL OPS' ? 56 : 74));
        }
      } finally {
        drawText.mockRestore();
        drawImage.mockRestore();
      }
    }
  );

  it('uses A4 portrait by default and reserves header/footer space once', () => {
    expect(pdfPrintOptions()).toEqual({ ...PDF_LAYOUT.portrait, margins: PDF_LAYOUT.margins });
    const html = '<html><head></head><body><h1>Inventory</h1><p>One item</p></body></html>';
    const native = preparePdfHtml(html, 'Inventory', 'portrait', true);
    const android = preparePdfHtml(html, 'Inventory');
    expect(native).toContain('margin: 0;');
    expect(android).toContain('margin: 90pt 36pt 32pt 36pt;');
    expect(native).not.toContain('<h1>');
    expect(native).toContain('One item');
    expect(native).toContain('height: auto !important');
    expect(native).toContain('break-after: auto !important');
    expect(native).toContain('tfoot { display: table-row-group; }');
  });

  it('preserves user-entered titles as escaped content, not PDF header text', () => {
    const html = '<html><head></head><body><h1>Safety &amp; équipement</h1></body></html>';
    expect(preparePdfHtml(html, 'Safety Equipment')).toContain('<h2>Safety &amp; équipement</h2>');
    expect(
      preparePdfHtml(
        '<html><head></head><body><h1>Muster Station &amp; Duties</h1></body></html>',
        'Muster Station & Duties'
      )
    ).not.toContain('<h2>');
  });

  it.each([1, 2, 5])('brands all %i actual pages without creating extra pages', async (count) => {
    const source = await PDFDocument.create();
    for (let i = 0; i < count; i += 1) source.addPage([595.28, 841.89]);
    const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
    const drawImage = jest.spyOn(PDFPage.prototype, 'drawImage');
    const logo = readFileSync(resolve(__dirname, '../../assets/sea-miles-pdf-logo-source.png'));
    try {
      const output = await brandPdf(await source.save(), 'Inventory', logo);
      const document = await PDFDocument.load(output);
      expect(document.getPageCount()).toBe(count);
      expect(drawImage).toHaveBeenCalledTimes(count);
      const texts = drawText.mock.calls.map(([text]) => text);
      expect(texts.filter((text) => text === 'NAUTICAL OPS')).toHaveLength(count);
      expect(texts.filter((text) => text === 'INVENTORY')).toHaveLength(count);
      expect(texts.filter((text) => text.startsWith('Page '))).toHaveLength(count > 1 ? count : 0);
      if (count > 1) expect(texts).toContain(`Page ${count} of ${count}`);
      expect(document.getPages().every((page) => page.getWidth() < page.getHeight())).toBe(true);
    } finally {
      drawText.mockRestore();
      drawImage.mockRestore();
    }
  });
});
