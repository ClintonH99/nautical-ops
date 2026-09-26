/**
 * PDF export for Rules On-Board.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { printStandardPdf } from './standardPdf';
import * as Sharing from 'expo-sharing';

export interface RulesPdfDocument {
  title: string;
  rules: string[];
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildRulesPdfHtml(
  documents: RulesPdfDocument[],
  documentTitle = documents.length === 1 ? documents[0]?.title || 'Rules' : 'Rules On-Board'
): string {
  const boards = documents
    .map((document, documentIndex) => {
      const rules = document.rules.filter(Boolean);
      const list = rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join('');
      const boardTitle =
        documents.length > 1
          ? `<h2>${escapeHtml(document.title || `Rules ${documentIndex + 1}`)}</h2>`
          : '';
      return `<section class="board">${boardTitle}<ol>${list || '<li>No rules defined</li>'}</ol></section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4 portrait; margin: 20mm 16mm; }
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 20px; font-weight: 700; color: #1E3A8A; margin-bottom: 4px; }
    h2 { font-size: 15px; font-weight: 700; color: #111; margin: 0 0 8px; }
    .subtitle { font-size: 11px; color: #666; margin-bottom: 20px; }
    .board { border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
    ol { margin: 8px 0 0; padding-left: 24px; }
    li { margin: 8px 0; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(documentTitle)}</h1>
  <p class="subtitle">General rules for all crew to conform to · Generated ${new Date().toISOString().slice(0, 10)}</p>
  ${boards}
</body>
</html>`;
}

export async function generateRulesDocumentsPdf(
  documents: RulesPdfDocument[],
  filename: string
): Promise<void> {
  if (documents.length === 0) throw new Error('Select at least one Rules board to export.');
  const html = buildRulesPdfHtml(documents);
  const { uri } = await printStandardPdf({ html, title: 'Rules On-Board' });
  const newUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.moveAsync({ from: uri, to: newUri });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(newUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Save ${filename}`,
    });
  }
}

export async function generateRulesPdf(
  title: string,
  rules: string[],
  filename: string
): Promise<void> {
  await generateRulesDocumentsPdf([{ title, rules }], filename);
}
