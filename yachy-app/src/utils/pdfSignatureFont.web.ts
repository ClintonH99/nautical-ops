import assets from './pdfEmbeddedAssets.json';

export async function getPdfSignatureFontBase64(): Promise<string> {
  return assets.signatureFont;
}
