import { File } from 'expo-file-system';
import { Platform } from 'react-native';

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
    return new Uint8Array(await response.arrayBuffer());
  }

  return new File(uri).bytes();
}
