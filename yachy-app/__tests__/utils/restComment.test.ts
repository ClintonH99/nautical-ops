import {
  REST_COMMENT_MAX_LENGTH,
  updateRestComment,
  isRestCommentValid,
} from '../../src/utils/restComment';

describe('Hours of Rest comment limit', () => {
  it('uses the measured 20-character limit for typing and paste', () => {
    expect(REST_COMMENT_MAX_LENGTH).toBe(20);
    expect(updateRestComment('W'.repeat(20), '')).toHaveLength(20);
    expect(updateRestComment('W'.repeat(21), '')).toHaveLength(20);
    expect(updateRestComment('W'.repeat(200), '')).toHaveLength(20);
  });
  it('keeps pasted line breaks and tabs from creating extra PDF lines', () => {
    expect(updateRestComment('Night\nwatch\tcheck', '')).toBe('Night watch check');
  });
  it('does not leave a broken emoji at the length boundary', () => {
    expect(updateRestComment('x'.repeat(19) + '😀', '')).toBe('x'.repeat(19));
  });
  it('preserves old comments and permits shortening without silent deletion', () => {
    const previous = 'A historical comment that is longer than the new limit';
    expect(updateRestComment(previous + 'x', previous)).toBe(previous);
    expect(updateRestComment(previous.slice(0, -1), previous)).toBe(previous.slice(0, -1));
    expect(isRestCommentValid(previous, previous)).toBe(true);
    expect(isRestCommentValid(previous.slice(0, -1), previous)).toBe(false);
    expect(isRestCommentValid('Short note', previous)).toBe(true);
  });
});
