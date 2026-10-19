import { supabase } from '../services/supabase';
import assets from './pdfEmbeddedAssets.json';
import { PdfExportError } from './pdfErrors';
import { brandPdf } from './pdfBranding';
import { preparePdfHtml, type PdfOrientation } from './pdfLayout';
import { toByteArray } from 'base64-js';

export async function getPdfLogoBase64(): Promise<string> {
  return assets.logo;
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
  if (!session) throw new PdfExportError('Please sign in again before exporting.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  let readingResponse = true;
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
      throw new PdfExportError(
        response.status === 401 || response.status === 403
          ? 'Please sign in on an authorized device before exporting.'
          : response.status === 429
            ? 'The PDF service is busy. Please wait a few seconds and try again.'
            : 'The PDF service is unavailable. Please try again shortly.'
      );
    }
    if (!response.headers.get('content-type')?.includes('application/pdf')) {
      throw new PdfExportError('PDF export is not available on this website deployment yet.');
    }
    const source = new Uint8Array(await response.arrayBuffer());
    readingResponse = false;
    clearTimeout(timer);
    const branded = await brandPdf(source, title, logo, headerInContent);
    const bytes = toByteArray(branded);
    return {
      uri: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })),
    };
  } catch (error) {
    if (error instanceof PdfExportError) throw error;
    if (controller.signal.aborted) {
      throw new PdfExportError('PDF export took too long. Please try again.');
    }
    if (readingResponse && error instanceof TypeError) {
      throw new PdfExportError(
        'Could not connect to the PDF service. Check your connection and try again. If your browser shows a security warning, do not bypass it.'
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
