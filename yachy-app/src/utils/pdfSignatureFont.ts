import { readPdfAsset } from './pdfAsset';

export function getPdfSignatureFontBase64(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return readPdfAsset(require('../../assets/fonts/AlexBrush-Regular.ttf'));
}
