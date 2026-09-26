/**
 * Landscape PDF comment column: ~171 CSS px usable at 8px Arial.
 * Wide fallback glyphs measure ~8.18px; allow 2px rendering tolerance:
 * floor((171 - 2) / 8.18) = 20. Keep new comments to one text line.
 * Count UTF-16 units consistently with React Native TextInput.maxLength.
 */
export const REST_COMMENT_MAX_LENGTH = 20;

export function updateRestComment(value: string, previous: string): string {
  const singleLine = value.replace(/[\r\n\t\u2028\u2029]/g, ' ');
  // Never silently truncate a historical comment when it is opened or edited.
  if (previous.length > REST_COMMENT_MAX_LENGTH) {
    return singleLine.length <= previous.length ? singleLine : previous;
  }
  const limited = singleLine.slice(0, REST_COMMENT_MAX_LENGTH);
  // A pasted emoji must not leave half a surrogate pair at the boundary.
  return limited.replace(/[\uD800-\uDBFF]$/, '');
}

export function isRestCommentValid(value: string, original: string): boolean {
  // Unchanged historical comments remain saveable; changed comments use the cap.
  return value === original || value.length <= REST_COMMENT_MAX_LENGTH;
}
