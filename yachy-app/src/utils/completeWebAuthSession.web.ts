import { maybeCompleteAuthSession } from 'expo-web-browser';

/** The OAuth return window must notify its opener on startup, not on another tap. */
export function completeWebAuthSession(): void {
  try {
    maybeCompleteAuthSession();
  } catch {
    // A standalone redirect may have no opener. Supabase still processes its URL.
  }
}
