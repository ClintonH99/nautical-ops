import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { brandPdf } from './pdfBranding';
import { pdfPrintOptions, preparePdfHtml, type PdfOrientation } from './pdfLayout';

let logoPromise: Promise<string> | undefined;
export function getPdfLogoBase64(): Promise<string> {
  if (!logoPromise) {
    logoPromise = (async () => {
      // The approved vessel mark, already cropped: no app-icon tile or gold filter.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const asset = Asset.fromModule(require('../../assets/sea-miles-pdf-logo-source.png'));
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error('Could not load the Nautical Ops PDF logo.');
      return FileSystem.readAsStringAsync(asset.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    })().catch((error) => {
      logoPromise = undefined;
      throw error;
    });
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
  /** Fixed page title, not user-entered content (which stays in the HTML). */
  title: string;
  orientation?: PdfOrientation;
  /** Hours of Rest repeats its compact metadata/brand header inside the table. */
  headerInContent?: boolean;
}): Promise<{ uri: string }> {
  const logo = await getPdfLogoBase64();
  const result = await Print.printToFileAsync({
    html: preparePdfHtml(html, title, orientation, Platform.OS === 'ios', headerInContent),
    ...pdfPrintOptions(orientation, headerInContent),
    base64: true,
  });
  if (!result?.uri) throw new Error('The PDF could not be created on this device.');
  try {
    const source =
      result.base64 ??
      (await FileSystem.readAsStringAsync(result.uri, {
        encoding: FileSystem.EncodingType.Base64,
      }));
    const branded = headerInContent
      ? await brandPdf(source, title, logo, true)
      : await brandPdf(source, title, logo);
    await FileSystem.writeAsStringAsync(result.uri, branded, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri: result.uri };
  } catch (error) {
    // Never share a partially generated or unbranded PDF after a failed render.
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}
