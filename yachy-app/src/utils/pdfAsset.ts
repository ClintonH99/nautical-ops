import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

export async function readPdfAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Could not load the PDF asset.');
  return FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
}
