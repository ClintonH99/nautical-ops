import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export async function sharePdfFile(
  uri: string,
  filename: string,
  dialogTitle = `Save ${filename}`
): Promise<void> {
  const destination = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: destination });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destination, { mimeType: 'application/pdf', dialogTitle });
  }
}
