/** Only our own public messages may be shown; never expose a raw server response. */
export class PdfExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfExportError';
  }
}

export function getPdfExportErrorMessage(error: unknown): string {
  return error instanceof PdfExportError
    ? error.message
    : 'Could not export PDF. Please try again.';
}
