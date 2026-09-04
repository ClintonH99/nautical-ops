import { File } from 'expo-file-system';
import { Platform } from 'react-native';

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

function ensureImageSize(size: number): void {
  if (size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error('Selected image must be smaller than 10 MB.');
  }
}

/**
 * Read a picker/asset URI into bytes accepted by Supabase Storage.
 *
 * Native builds must use Expo's native file reader. React Native's
 * fetch(uri).blob() -> new Response(blob).arrayBuffer() chain can remain
 * pending forever for bundled file:// assets. Web keeps fetch because
 * expo-file-system intentionally has no web implementation.
 */
export async function readFileBytesForUpload(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Could not read selected file (${response.status})`);
    }
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength)) ensureImageSize(contentLength);
    const bytes = new Uint8Array(await response.arrayBuffer());
    ensureImageSize(bytes.byteLength);
    return bytes;
  }

  const file = new File(uri);
  if (typeof file.size === 'number') ensureImageSize(file.size);
  const bytes = await file.bytes();
  ensureImageSize(bytes.byteLength);
  return bytes;
}
