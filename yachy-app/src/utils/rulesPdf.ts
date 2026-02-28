/**
 * PDF export for Rules On-Board
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function generateRulesPdf(title: string, rules: string[], filename: string): Promise<void> {
  const list = (rules || []).filter(Boolean).map((r, i) => `<li>${escapeHtml(r)}</li>`).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @page { size: A4 portrait; margin: 20mm 16mm; }
        body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
        h1 { font-size: 20px; font-weight: 700; color: #1E3A8A; margin-bottom: 4px; }
        .subtitle { font-size: 11px; color: #666; margin-bottom: 20px; }
        ol { margin: 16px 0; padding-left: 24px; }
        li { margin: 8px 0; line-height: 1.5; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title || 'Rules')}</h1>
      <p class="subtitle">General rules for all crew to conform to · Generated ${new Date().toISOString().slice(0, 10)}</p>
      <ol>${list || '<li>No rules defined</li>'}</ol>
    </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const newUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(newUri, { mimeType: 'application/pdf', dialogTitle: `Save ${filename}` });
  }
}
