import { registrationErrorMessage } from '../../src/utils/registrationError';

describe('registration connection errors', () => {
  it.each([
    'fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)',
    'Network request failed',
    'Failed to fetch',
    'Request timed out',
  ])('explains uncertain signup without suggesting duplicate registration: %s', (message) => {
    const result = registrationErrorMessage(new Error(message));
    expect(result).toContain('try signing in');
    expect(result).toContain('may already have been created');
    expect(result).not.toContain('Promise.swift');
  });
  it('preserves validation and duplicate-email errors', () => {
    expect(registrationErrorMessage(new Error('Email address already in use'))).toBe(
      'Email address already in use'
    );
    expect(registrationErrorMessage(new Error('Invalid invite code'))).toBe('Invalid invite code');
  });
});
