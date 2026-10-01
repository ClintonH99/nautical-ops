import { Asset } from 'expo-asset';
import { fromByteArray } from 'base64-js';

export async function readPdfAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Could not load the PDF asset.');
  return fromByteArray(new Uint8Array(await response.arrayBuffer()));
}
