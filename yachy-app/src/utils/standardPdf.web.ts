import { supabase } from '../services/supabase';
import { readPdfAsset } from './pdfAsset';
import { brandPdf } from './pdfBranding';
import { preparePdfHtml, type PdfOrientation } from './pdfLayout';
import { toByteArray } from 'base64-js';

let logoPromise: Promise<string> | undefined;
export function getPdfLogoBase64(): Promise<string> {
  if (!logoPromise) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    logoPromise = readPdfAsset(require('../../assets/sea-miles-pdf-logo-source.png')).catch(
      (error) => {
        logoPromise = undefined;
        throw error;
      }
    );
  }
  return logoPromise;
}

export async function printStandardPdf({
  html,
  title,
  orientation = 'portrait',
  headerInContent = false,
}: {
  html: string;
  title: string;
  orientation?: PdfOrientation;
  headerInContent?: boolean;
}): Promise<{ uri: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again before exporting.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const [logo, response] = await Promise.all([
      getPdfLogoBase64(),
      fetch('/api/export-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          html: preparePdfHtml(html, title, orientation, false, headerInContent),
        }),
        signal: controller.signal,
      }),
    ]);
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Please sign in on an authorized device before exporting.'
          : 'The PDF could not be generated. Please try again.'
      );
    }
    if (!response.headers.get('content-type')?.includes('application/pdf')) {
      throw new Error('PDF export is not available on this website deployment yet.');
    }
    const source = new Uint8Array(await response.arrayBuffer());
    const branded = await brandPdf(source, title, logo, headerInContent);
    const bytes = toByteArray(branded);
    return {
      uri: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
