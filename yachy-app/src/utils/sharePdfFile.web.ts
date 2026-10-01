/** Download the generated file without relying on a popup or native sharing API. */
export async function sharePdfFile(
  uri: string,
  filename: string,
  _dialogTitle?: string
): Promise<void> {
  if (!uri.startsWith('blob:')) throw new Error('Invalid generated PDF. Please export again.');
  const link = document.createElement('a');
  link.href = uri;
  // Strip path separators and control characters from download filenames.
  // eslint-disable-next-line no-control-regex
  link.download = filename.replace(/[\\/\u0000-\u001f]/g, '_');
  link.style.display = 'none';
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(uri), 60_000);
  }
}
